import { describe, expect, it } from 'vitest';
import {
	applyBaseSecurityHeaders,
	resolveRenderTheme,
	substitutePagePlaceholders
} from '../../../../src/lib/server/core/security-headers';

describe('applyBaseSecurityHeaders', () => {
	it('sets HSTS, nosniff and referrer-policy in production', () => {
		const res = new Response('ok');
		applyBaseSecurityHeaders(res, true);
		expect(res.headers.get('strict-transport-security')).toBe(
			'max-age=31536000; includeSubDomains'
		);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
	});

	it('omits HSTS outside production', () => {
		const res = new Response('ok');
		applyBaseSecurityHeaders(res, false);
		expect(res.headers.get('strict-transport-security')).toBeNull();
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});
});

describe('resolveRenderTheme', () => {
	it('uses the preference directly when it is light or dark', () => {
		expect(resolveRenderTheme('light', undefined)).toBe('light');
		expect(resolveRenderTheme('dark', 'light')).toBe('dark');
	});

	it('falls back to the resolved cookie when the preference is system', () => {
		expect(resolveRenderTheme('system', 'light')).toBe('light');
		expect(resolveRenderTheme('system', 'dark')).toBe('dark');
	});

	it('falls back to DEFAULT_RENDER_THEME when the preference is absent or unrecognised', () => {
		expect(resolveRenderTheme(undefined, undefined)).toBe('dark');
		expect(resolveRenderTheme('nonsense', undefined)).toBe('dark');
		expect(resolveRenderTheme('system', undefined)).toBe('dark');
		expect(resolveRenderTheme('system', 'nonsense')).toBe('dark');
	});

	it('never returns the literal "system"', () => {
		const result = resolveRenderTheme('system', undefined);
		expect(result).not.toBe('system');
	});
});

describe('substitutePagePlaceholders', () => {
	it('replaces %lang% and %theme%', () => {
		const html = '<html lang="%lang%" data-theme="%theme%">';
		expect(substitutePagePlaceholders(html, 'cs', 'dark')).toBe(
			'<html lang="cs" data-theme="dark">'
		);
	});

	it('leaves neither placeholder in the output', () => {
		const html = '<html lang="%lang%" data-theme="%theme%">body%lang%</html>';
		const out = substitutePagePlaceholders(html, 'en', 'light');
		expect(out).not.toContain('%lang%');
		expect(out).not.toContain('%theme%');
	});
});
