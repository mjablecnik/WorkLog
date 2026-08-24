import { overwriteGetLocale, overwriteSetLocale, setLocale } from '$lib/paraglide/runtime';

/**
 * The two locales this app supports. Kept as a plain literal union rather than
 * importing Paraglide's generated `Locale` type, which is not declared as an
 * importable TypeScript type in the compiled runtime output.
 */
export type AppLocale = 'cs' | 'en';

const LOCALE_COOKIE_NAME = 'worklog_locale';
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // one year

/**
 * The active locale, held as a rune so every reader re-renders when it changes.
 *
 * This module never resolves a locale itself — no cookie read, no
 * `Accept-Language` negotiation. `001`'s hook does all of that server-side and
 * puts the answer on `event.locals.locale`; `initLocale()` below is the only
 * way this rune is ever seeded, and `switchLocale()` is the only way it ever
 * changes after that (Requirement 13.3).
 */
let locale = $state<AppLocale>('cs');

// Route Paraglide's own getLocale()/setLocale() through the rune above, so
// every `m.*()` call site reads the current value instantly and without a
// reload, per Requirement 13.4.
overwriteGetLocale(() => locale);
overwriteSetLocale((newLocale) => {
	locale = newLocale as AppLocale;
});

/**
 * Seed the rune from the server-resolved locale. Call once, on mount, from
 * the root layout — never anywhere else, and never with anything other than
 * `event.locals.locale`.
 */
export function initLocale(serverLocale: AppLocale): void {
	locale = serverLocale;
}

/**
 * The current locale, for read-only use outside a Svelte template (e.g. in a
 * `.ts` helper). Inside a component, prefer importing `locale` directly so
 * Svelte's reactivity tracks it.
 */
export function getCurrentLocale(): AppLocale {
	return locale;
}

/**
 * Switch the active locale on the client: instantly, without a document
 * reload, without a flash and without losing scroll position.
 *
 * - Writes the `worklog_locale` cookie (a year, `SameSite=Lax`, not
 *   `HttpOnly` — the client reads it too), so the next navigation and `001`'s
 *   hook agree with what is already on screen.
 * - Strips any URL hash first, so a stale in-page anchor does not jump the
 *   scroll position when the surrounding text reflows.
 * - Calls Paraglide's `setLocale()` (now backed by the rune above) with
 *   `reload: false` — this app has no URL locale prefix and does its own
 *   reactive re-render, so a full navigation/reload would be wrong here.
 * - Updates `document.documentElement.lang` for assistive technology.
 */
export function switchLocale(next: AppLocale): void {
	document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;

	if (location.hash) {
		history.replaceState(history.state, '', location.pathname + location.search);
	}

	setLocale(next, { reload: false });
	document.documentElement.lang = next;
}
