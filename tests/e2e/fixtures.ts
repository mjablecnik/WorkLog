/**
 * `002-worklog-ui`'s specs import `test`/`expect` from here rather than from
 * `@playwright/test` directly — mainly for the shared E2E login helper
 * (`login()`) and the theme-cookie workaround every spec needs before its very
 * first navigation (see the big comment on `seedNonSystemThemeCookie()` below).
 * `E2E_PASSPHRASE` is the plaintext behind the throwaway `WORKLOG_PASSPHRASE_HASH`
 * task group 11's own run sets for this suite (never the real `.env`'s hash, whose
 * plaintext is not recorded anywhere — see `.agents/ISSUES.md`, "The login
 * passphrase behind the stored hash is not recorded anywhere").
 *
 * The database reset used to live here, as a worker-scoped `auto` fixture — moved
 * to `playwright.config.ts`'s `globalSetup` (`global-setup.ts`) instead, since
 * that fixture turned out to re-run once per TEST FILE, not once for the whole
 * run; see that file's own doc comment for the full story.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { E2E_PASSPHRASE } from './e2e-passphrase';

export { test, expect, E2E_PASSPHRASE };

// E2E_PASSPHRASE itself lives in ./e2e-passphrase (imported above, re-exported
// below) — the plaintext behind the E2E run's throwaway `WORKLOG_PASSPHRASE_HASH`.
// `scripts/test-e2e.sh` mints that hash from the same constant (via a plain `bun
// -e` import of that file, never `@playwright/test`) before starting the app —
// never the committed `.env`'s real hash, whose plaintext nobody recorded.

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
export async function seedLocaleCookie(
	context: BrowserContext,
	locale: 'cs' | 'en' = 'cs'
): Promise<void> {
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
 * Login is rate limited to `LOGIN_ATTEMPT_LIMIT` (5) attempts per address per
 * `LOGIN_ATTEMPT_WINDOW_MINUTES` (15) — deliberately, Requirement 11.13's real
 * brute-force protection, not a bug to route around. This suite's specs are
 * written one `login()` call per test, and `playwright.config.ts` runs every
 * spec against the same running app (one client address throughout), so
 * calling the real `/login` form once per test trips that limiter well before
 * a combined run of every spec file finishes.
 *
 * An in-memory (module-scoped) cache was tried first and was NOT enough:
 * confirmed live (`console.error` tracing an actual run) that the database
 * reset used to be a worker-scoped `auto` fixture here, which turned out to
 * re-run at the start of every TEST FILE rather than once for the whole run
 * (see `global-setup.ts`, which now owns that reset instead) — truncating
 * `auth_sessions` per file invalidated every session a previous file had
 * established, forcing at least one real login per file regardless of any
 * client-side cache. Moving the reset to `globalSetup` fixed the root cause;
 * this file-based cache is what makes a session established by ANY spec
 * reusable by any other afterward, for the same theme/locale combination.
 *
 * Session cookies from a successful login stay valid for as long as the
 * `auth_sessions` row does (`SESSION_DURATION_HOURS` in `.env` is long, and
 * that table is now truncated exactly once, by `global-setup.ts`, before the
 * whole run starts). Cached to a file under the OS temp dir (never inside the
 * repo — this is exactly the "shared storageState/session reuse across specs"
 * pattern `a11y.spec.ts` already uses per-theme via its own `STATE_PATH`,
 * generalized here for every other spec's plain `login()` call), and verified
 * still valid before being trusted: a prior test that logged out invalidates
 * the file, and
 * the next call falls back to a real login and refreshes it.
 */
const SESSION_STATE_DIR = join(tmpdir(), 'worklog-e2e-session-state');

function sessionStatePath(cacheKey: string): string {
	return join(SESSION_STATE_DIR, `${cacheKey.replace(/[^a-z0-9-]/gi, '_')}.json`);
}

async function tryReuseCachedSession(page: Page, cacheKey: string): Promise<boolean> {
	const path = sessionStatePath(cacheKey);
	let cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
	try {
		cookies = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		return false;
	}
	await page.context().addCookies(cookies);
	await page.goto('/');
	if (page.url().includes('/login')) {
		await rm(path, { force: true }).catch(() => {});
		return false;
	}
	return true;
}

/**
 * Logs in through the real `/login` form (passphrase + submit), waiting for the
 * redirect to the timer page — or, when a still-valid cached session exists for
 * this theme/locale combination (see the rate-limit note above), reuses it
 * instead. Seeds the theme-cookie workaround and the locale cookie first, since
 * this is normally a spec's very first navigation. A caller that passes `next`
 * is exercising the login-redirect flow itself, so caching is skipped entirely
 * for that call.
 */
export async function login(
	page: Page,
	options: { theme?: 'dark' | 'light'; locale?: 'cs' | 'en'; next?: string } = {}
): Promise<void> {
	const theme = options.theme ?? 'dark';
	const locale = options.locale ?? 'cs';
	await seedNonSystemThemeCookie(page.context(), theme);
	await seedLocaleCookie(page.context(), locale);

	const cacheKey = `${theme}:${locale}`;
	if (options.next === undefined && (await tryReuseCachedSession(page, cacheKey))) {
		return;
	}

	const target = options.next ? `/login?next=${encodeURIComponent(options.next)}` : '/login';
	await page.goto(target);
	const passphraseLabel = locale === 'en' ? 'Passphrase' : 'Heslo';
	const submitLabel = locale === 'en' ? 'Unlock' : 'Odemknout';
	await page.getByLabel(passphraseLabel).fill(E2E_PASSPHRASE);
	await page.getByRole('button', { name: submitLabel }).click();
	await page.waitForURL(options.next ?? '/');

	if (options.next === undefined) {
		await mkdir(SESSION_STATE_DIR, { recursive: true });
		await writeFile(sessionStatePath(cacheKey), JSON.stringify(await page.context().cookies()));
	}
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
 * Fast setup-data helpers: build a `Work_Session`/`Activity_Entry` directly
 * against the same public REST API real scripts use (README: "Scripts and phone
 * shortcuts use the bearer token against the same endpoints"), through
 * `page.request` so the call rides the already-logged-in browser context's
 * session cookie, rather than driving `SessionDialog`/`ActivityDialog`'s own
 * confirm step through the UI for data a test only needs to already exist. This
 * is setup data, not the behaviour under test — every spec still drives the
 * actual UI for whatever it's actually asserting (the rendered timeline, a
 * dialog's prefill, a rejection's text, a toast, the confirm step itself where a
 * task's requirement is specifically about it).
 *
 * Formerly also a workaround for the STALE_PREVIEW bug (see .agents/ISSUES.md,
 * now fixed — every write's confirm step works through the real UI too), since
 * these calls omit `previewToken` and so never depended on it in the first
 * place; kept as-is purely for setup speed.
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

/**
 * `projectId: null` creates a Leisure_Entry (003-worklog-time-categories, Requirement
 * 2.3) — no `projectId` field is sent at all, exactly as the real dialog's own
 * relax-category draft omits it.
 */
export async function createActivityViaApi(
	page: Page,
	projectId: string | null,
	startedAtIso: string,
	endedAtIso: string,
	description = ''
): Promise<void> {
	const res = await page.request.post('/api/activities', {
		data: {
			...(projectId !== null ? { projectId } : {}),
			startedAt: startedAtIso,
			endedAt: endedAtIso,
			description,
			dryRun: false
		}
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
