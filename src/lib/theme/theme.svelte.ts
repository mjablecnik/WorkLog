/**
 * The theme store — a module-level rune pair (`preference`, its resolved `current`
 * theme) mirrored to two cookies, never `localStorage` (Requirement 17.10: the
 * server cannot read it, and everything that decides the first paint must be
 * something the server can read).
 *
 * Two cookies, two different writers — do not conflate them (design.md § 10):
 *
 * - `worklog_theme` holds the `ThemePreference` the user actually chose. Written
 *   **only** by `setThemePreference()`, i.e. only when the `Theme_Switcher` is
 *   touched. A single cookie could not hold both the preference and the resolved
 *   theme: the moment the client wrote a resolved `light` into it, the `system`
 *   preference would be gone.
 * - `worklog_theme_resolved` holds the last theme resolved from
 *   `prefers-color-scheme`. Written only while the preference is `system` — on
 *   `initTheme()` (to correct the first-paint gap for the *next* visit: `001`'s
 *   hook reads this cookie whenever the preference is `system`) and again every
 *   time the media query changes. Dormant whenever the preference is `light` or
 *   `dark`, since the resolved cookie is irrelevant then.
 *
 * `001`'s hook resolves the server-rendered `%theme%` from these two cookies
 * exactly as `resolveTheme()` resolves them here; this module owns none of that
 * server-side logic, only the client-side reactive state after hydration.
 */

/** What the user chose. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is actually painted. */
export type Theme = 'dark' | 'light';

const THEME_COOKIE_NAME = 'worklog_theme';
const THEME_RESOLVED_COOKIE_NAME = 'worklog_theme_resolved';
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // one year

/**
 * Rendered when neither cookie can answer (a true first visit) and, client-side,
 * whenever the browser reports no `prefers-color-scheme` at all. A server cannot
 * know a system preference the browser has never reported to it — this is the one
 * flash Requirement 17.9 permits.
 */
const DEFAULT_RENDER_THEME: Theme = 'dark';

/**
 * Resolves a `ThemePreference` to the `Theme` that is actually painted.
 *
 * `'light'`/`'dark'` return themselves unconditionally — Requirement 17.4's point
 * that an explicit choice ignores `prefers-color-scheme` entirely. `'system'`
 * reads `matchMedia('(prefers-color-scheme: dark)')`; when the browser expresses
 * no preference at all — neither the dark nor the light media feature matches, or
 * `matchMedia` is unavailable (SSR, a non-browser environment) — it falls back to
 * `DEFAULT_RENDER_THEME` rather than misreading "no answer" as "light".
 */
export function resolveTheme(preference: ThemePreference): Theme {
	if (preference === 'light' || preference === 'dark') {
		return preference;
	}

	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return DEFAULT_RENDER_THEME;
	}

	if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
		return 'dark';
	}
	if (window.matchMedia('(prefers-color-scheme: light)').matches) {
		return 'light';
	}
	return DEFAULT_RENDER_THEME;
}

let preference = $state<ThemePreference>('system');
let current = $state<Theme>(DEFAULT_RENDER_THEME);

/** Read-only view of the theme state, exposed via getters so every reader stays reactive. */
export const theme: { readonly preference: ThemePreference; readonly current: Theme } = {
	get preference() {
		return preference;
	},
	get current() {
		return current;
	}
};

/** Both cookie writers guard `document` exactly like `applyDomTheme` below —
 * `initTheme()` calls `writeResolvedCookie()` unconditionally whenever the
 * preference is `'system'`, and `+layout.svelte` calls `initTheme()` as a
 * top-level statement that also runs during SSR. Without this guard, every
 * visitor whose `worklog_theme` cookie is absent or `'system'` (which is every
 * first-time visitor — `hooks.server.ts` defaults `locals.theme` to `'system'`
 * with no cookie) hits `ReferenceError: document is not defined` on the server,
 * 500ing the entire application. Found live during task 11's E2E pass. */
function writePreferenceCookie(next: ThemePreference): void {
	if (typeof document === 'undefined') return;
	document.cookie = `${THEME_COOKIE_NAME}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function writeResolvedCookie(next: Theme): void {
	if (typeof document === 'undefined') return;
	document.cookie = `${THEME_RESOLVED_COOKIE_NAME}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Writing `data-theme` on `<html>` is the only way a theme is ever applied
 * (task 1.7's own note) — both themes live in `theme.css` as
 * `[data-theme='dark']`/`[data-theme='light']` blocks, so this one attribute
 * write is what switches them, with no reload and no flash.
 */
function applyDomTheme(next: Theme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme = next;
}

let systemListenerRegistered = false;

/**
 * The "separate effect, alive whenever the preference is `system`" design.md
 * describes: a single, idempotently-registered `change` listener on
 * `prefers-color-scheme: dark` that re-resolves and rewrites
 * `worklog_theme_resolved` — but only while `preference` is currently `system`.
 * When the preference is `light`/`dark` the listener stays registered but is a
 * no-op, which is what "dormant" means here: there is nothing to add or remove,
 * since the guard inside the handler is the on/off switch.
 */
function ensureSystemListener(): void {
	if (systemListenerRegistered) return;
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
	systemListenerRegistered = true;

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (preference !== 'system') return;

		const resolved = resolveTheme('system');
		current = resolved;
		writeResolvedCookie(resolved);
		applyDomTheme(resolved);
	});
}

/**
 * Seeds the rune from what the server actually rendered. Call once, on mount,
 * from the root layout — never anywhere else, and never with anything other than
 * the `worklog_theme`/`worklog_theme_resolved` cookie values `locals` already
 * read server-side (mirrors `initLocale()`'s pattern in the sibling i18n module).
 *
 * `serverResolved` is the last-resolved theme `001`'s hook read from
 * `worklog_theme_resolved`, or `null` when that cookie was absent — meaningful
 * only when `serverPreference` is `'system'`.
 *
 * While the preference is `system`, this also registers the always-listening
 * `matchMedia` correction described above and immediately re-resolves once: if
 * the browser's actual `prefers-color-scheme` disagrees with what the server
 * rendered (the first-visit flash, or a stale `worklog_theme_resolved` cookie
 * from a different browser/device), this corrects both the DOM and the cookie
 * so every later visit is correct in the first byte.
 */
export function initTheme(serverPreference: ThemePreference, serverResolved: Theme | null): void {
	preference = serverPreference;
	current =
		serverPreference === 'system' ? (serverResolved ?? resolveTheme('system')) : serverPreference;

	ensureSystemListener();

	if (preference === 'system') {
		const resolved = resolveTheme('system');
		if (resolved !== current) {
			current = resolved;
			applyDomTheme(resolved);
		}
		writeResolvedCookie(resolved);
	}
}

/**
 * Changes the active `Theme_Preference` on the client: instantly, without a
 * reload (Requirement 17.6). Writes `worklog_theme` — the **only** place this
 * file ever writes it — updates the rune, resolves and applies the `Theme`, and
 * never touches `localStorage`.
 */
export function setThemePreference(next: ThemePreference): void {
	writePreferenceCookie(next);
	preference = next;
	current = resolveTheme(next);
	applyDomTheme(current);
	ensureSystemListener();
}
