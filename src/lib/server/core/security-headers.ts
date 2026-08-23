/**
 * Sets only the headers `kit.csp` (svelte.config.js) does not, and performs the two
 * `%lang%`/`%theme%` substitutions on every rendered page. The Content-Security-Policy
 * itself is assembled by SvelteKit, never by hand here — only `kit.csp` can nonce
 * SvelteKit's own inline hydration script, and a hand-assembled strict policy would
 * block hydration in a production build (Requirement 12.13).
 */
import { DEFAULT_RENDER_THEME } from './config';

export type Theme = 'dark' | 'light';

/** Applies the three headers this module owns to any response. */
export function applyBaseSecurityHeaders(response: Response, isProduction: boolean): void {
	if (isProduction) {
		response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
}

/**
 * Resolves the theme actually rendered into `%theme%`: the preference cookie when it
 * is `light` or `dark`; otherwise `worklog_theme_resolved` when it names one; otherwise
 * `DEFAULT_RENDER_THEME`. Never the literal `system` (Requirements 12.31, 12.32).
 */
export function resolveRenderTheme(
	preference: string | undefined,
	resolvedCookie: string | undefined
): Theme {
	if (preference === 'light' || preference === 'dark') return preference;
	if (resolvedCookie === 'light' || resolvedCookie === 'dark') return resolvedCookie;
	return DEFAULT_RENDER_THEME;
}

/** Replaces the `%lang%` and `%theme%` placeholders in a rendered HTML chunk. */
export function substitutePagePlaceholders(html: string, locale: string, theme: Theme): string {
	return html.replace(/%lang%/g, locale).replace(/%theme%/g, theme);
}
