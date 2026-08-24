/**
 * Extends Playwright's `test` with a worker-scoped auto fixture that resets the
 * database before the first test in each worker runs — the same `resetDb()` the
 * integration suites use (`tests/setup/db.ts`), so an E2E run starts from an empty
 * database exactly as they do. `002-worklog-ui`'s specs import `test`/`expect` from
 * here rather than from `@playwright/test` directly.
 *
 * Also exports the shared E2E login helper (`login()`) and the theme-cookie
 * workaround every spec needs before its very first navigation — see the big
 * comment on `seedNonSystemThemeCookie()` below for why that workaround exists.
 * `E2E_PASSPHRASE` is the plaintext behind the throwaway `WORKLOG_PASSPHRASE_HASH`
 * task group 11's own run sets for this suite (never the real `.env`'s hash, whose
 * plaintext is not recorded anywhere — see `.agents/ISSUES.md`, "The login
 * passphrase behind the stored hash is not recorded anywhere").
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { resetDb } from '../setup/db';

export const test = base.extend<object, { resetOnce: void }>({
	resetOnce: [
		async ({}, use) => {
			await resetDb();
			await use();
		},
		{ scope: 'worker', auto: true }
	]
});

export { expect };

/**
 * The plaintext behind the E2E run's throwaway `WORKLOG_PASSPHRASE_HASH`. Only
 * valid when the suite is started through the scratchpad `run-e2e.sh` wrapper (or
 * an equivalent env setup) that mints this exact hash — never the committed
 * `.env`'s real hash, whose plaintext nobody recorded.
 */
export const E2E_PASSPHRASE = 'e2e-test-passphrase-9182';

/**
 * KNOWN BUG WORKAROUND — see `.agents/ISSUES.md`, "Every fresh visit (system theme
 * preference) 500s on the server". `src/lib/theme/theme.svelte.ts`'s
 * `writeResolvedCookie()` calls `document.cookie = ...` with no
 * `typeof document === 'undefined'` guard (unlike its sibling `applyDomTheme()`,
 * which has one), and `initTheme()` calls it unconditionally whenever the resolved
 * `Theme_Preference` is `'system'` — which is the default for a browser with no
 * `worklog_theme` cookie, i.e. every fresh Playwright browser context. The result:
 * every SSR render — including `GET /login` itself — throws
 * `ReferenceError: document is not defined` and 500s, for any request made before
 * this cookie is set to something other than `'system'`.
 *
 * Pre-seeding a `dark`/`light` `worklog_theme` cookie before the first navigation
 * sidesteps the crashing branch entirely (`initTheme` only reaches
 * `writeResolvedCookie` when `preference === 'system'`), without touching
 * production source. Call this before the FIRST `page.goto()` of every test — every
 * helper below already does.
 *
 * Specs that need to exercise the `system` preference itself do so through the
 * `Settings_Menu` (client-side, no navigation) and never follow it with a
 * `page.reload()`/`page.goto()`, which is exactly the combination that would hit
 * this bug — see `settings.spec.ts`.
 */
export async function seedNonSystemThemeCookie(
	context: BrowserContext,
	theme: 'dark' | 'light' = 'dark'
): Promise<void> {
	await context.addCookies([
		{
			name: 'worklog_theme',
			value: theme,
			domain: 'localhost',
			path: '/',
			sameSite: 'Lax'
		}
	]);
}

/**
 * Every spec in this suite is written against the Czech strings (the project's
 * own fallback locale — design.md, requirements.md: "Czech is the fallback in all
 * three places"). Without an explicit `worklog_locale` cookie, `001`'s hook falls
 * back to the request's `Accept-Language` header BEFORE Czech — and headless
 * Chromium's default is `en-US`, not absent — so a fresh context renders English
 * and every Czech text assertion in this suite would fail on a technicality
 * unrelated to what's being tested. Seeding the cookie makes the locale explicit
 * and deterministic regardless of the browser's own `Accept-Language`.
 * `locale.spec.ts` is the one spec that deliberately switches away from this.
 */
export async function seedLocaleCookie(context: BrowserContext, locale: 'cs' | 'en' = 'cs'): Promise<void> {
	await context.addCookies([
		{
			name: 'worklog_locale',
			value: locale,
			domain: 'localhost',
			path: '/',
			sameSite: 'Lax'
		}
	]);
}

/**
 * Logs in through the real `/login` form (passphrase + submit), waiting for the
 * redirect to the timer page. Seeds the theme-cookie workaround and the locale
 * cookie first, since this is normally a spec's very first navigation.
 */
export async function login(
	page: Page,
	options: { theme?: 'dark' | 'light'; locale?: 'cs' | 'en'; next?: string } = {}
): Promise<void> {
	await seedNonSystemThemeCookie(page.context(), options.theme ?? 'dark');
	await seedLocaleCookie(page.context(), options.locale ?? 'cs');
	const target = options.next ? `/login?next=${encodeURIComponent(options.next)}` : '/login';
	await page.goto(target);
	const passphraseLabel = (options.locale ?? 'cs') === 'en' ? 'Passphrase' : 'Heslo';
	const submitLabel = (options.locale ?? 'cs') === 'en' ? 'Unlock' : 'Odemknout';
	await page.getByLabel(passphraseLabel).fill(E2E_PASSPHRASE);
	await page.getByRole('button', { name: submitLabel }).click();
	await page.waitForURL(options.next ?? '/');
}

/**
 * Creates a `Project` through the real `/projects` page form. Scoped to
 * `.projects-page__create` — the empty-day/empty-project state renders a SECOND
 * "Nový projekt" button (`EmptyState`'s own action), so an unscoped role query is
 * ambiguous the first time this runs in a fresh worker.
 */
export async function createProject(page: Page, name: string): Promise<void> {
	await page.goto('/projects');
	const form = page.locator('.projects-page__create');
	await form.getByLabel('Název projektu').fill(name);
	await form.getByRole('button', { name: 'Nový projekt' }).click();
	await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

/**
 * KNOWN BUG WORKAROUND — see `.agents/ISSUES.md`, "Every CREATE that carries a
 * Preview_Token always answers STALE_PREVIEW". Creating a `Work_Session` or an
 * `Activity_Entry` through `SessionDialog`/`ActivityDialog`'s own confirm step is
 * currently impossible — the token the dry run hands back can never match what a
 * real write recomputes, for any create, at any speed (confirmed with immediate
 * `curl` round trips against a real database, no browser involved at all).
 *
 * These two helpers build setup data directly against the same public REST API
 * real scripts use (README: "Scripts and phone shortcuts use the bearer token
 * against the same endpoints"), through `page.request` so the call rides the
 * already-logged-in browser context's session cookie — and omit `previewToken`
 * entirely, which is the one shape of request the bug does not affect (confirmed
 * live: a create with no token attached succeeds immediately). This is setup
 * data, not the behaviour under test — every spec still drives the actual UI for
 * whatever it's actually asserting (the rendered timeline, a dialog's prefill, a
 * rejection's text, a toast). Where a task's requirement is specifically about
 * the CREATE-confirm UI flow itself, the spec that needs it says so at the exact
 * point it falls back to one of these instead, rather than leaving it implicit.
 */
export async function createSessionViaApi(
	page: Page,
	startedAtIso: string,
	endedAtIso: string
): Promise<void> {
	const res = await page.request.post('/api/sessions', {
		data: { startedAt: startedAtIso, endedAt: endedAtIso, dryRun: false }
	});
	if (!res.ok()) {
		throw new Error(`createSessionViaApi failed: ${res.status()} ${await res.text()}`);
	}
}

export async function createActivityViaApi(
	page: Page,
	projectId: string,
	startedAtIso: string,
	endedAtIso: string,
	description = ''
): Promise<void> {
	const res = await page.request.post('/api/activities', {
		data: { projectId, startedAt: startedAtIso, endedAt: endedAtIso, description, dryRun: false }
	});
	if (!res.ok()) {
		throw new Error(`createActivityViaApi failed: ${res.status()} ${await res.text()}`);
	}
}

/** Reads a `Project`'s id from `/api/projects` (a plain array response), for
 * API-seeding helpers that need it. */
export async function findProjectId(page: Page, name: string): Promise<string> {
	const res = await page.request.get('/api/projects');
	const projects = (await res.json()) as { id: string; name: string }[];
	const found = projects.find((p) => p.name === name);
	if (!found) throw new Error(`findProjectId: no project named ${name}`);
	return found.id;
}
