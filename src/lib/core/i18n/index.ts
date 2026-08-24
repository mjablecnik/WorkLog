/**
 * Internationalization barrel for `002`.
 *
 * This module owns only the CURRENT locale as client-side state — never its
 * resolution. `001`'s `hooks.server.ts` resolves the locale (cookie, then
 * `Accept-Language`, then Czech) and puts the answer on `event.locals.locale`;
 * the root layout calls `initLocale(locals.locale)` once, in `onMount`, to
 * seed the rune below, and `switchLocale()` is the only way it changes after
 * that.
 *
 * Message strings are NOT re-exported from here. Call sites import the
 * compiled catalogue directly, exactly as `design.md`'s Internationalization
 * section specifies:
 *
 * ```ts
 * import * as m from '$lib/paraglide/messages';
 *
 * m.timer_start();
 * m.day_heading_meta({ from, to, worked });
 * ```
 */
export { type AppLocale, getCurrentLocale, initLocale, switchLocale } from './state.svelte';
