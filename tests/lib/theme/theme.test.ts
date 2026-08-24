/**
 * Task 1.14. `theme.svelte.ts`'s `resolveTheme()` reads `window.matchMedia` when the
 * preference is `system`, so this file needs a real `window` — it is deliberately
 * placed under `tests/lib/theme/`, which `vitest.config.ts`'s `components` project
 * already routes to jsdom (`include: ['tests/lib/theme/**\/*.test.ts', ...]`). No
 * per-file `// @vitest-environment` override is needed as a result; this comment
 * documents that decision rather than leaving it implicit.
 *
 * `theme.css`'s token tables are parsed from the raw source text via a small local
 * regex extractor (there is no CSS-in-JS harness wired into this project, and one
 * is not needed for a table this shaped) rather than duplicated by hand, so this
 * test cannot itself drift from the file it is checking.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTheme } from '../../../src/lib/theme/theme.svelte';

const THEME_CSS_PATH = resolve(__dirname, '../../../src/lib/theme/theme.css');
const THEME_CSS = readFileSync(THEME_CSS_PATH, 'utf8');

/** Extracts the `{ ... }` body that immediately follows the first occurrence of
 * `selector` in `css`. `theme.css` has exactly one `[data-theme='dark']` block and
 * one `[data-theme='light']` block, each a flat run of custom-property declarations
 * with no nested braces, so "first `{` after the selector, up to the matching `}`"
 * is exact here — it does not need a general CSS parser. */
function extractBlock(css: string, selector: string): string {
	const selectorAt = css.indexOf(selector);
	if (selectorAt === -1) throw new Error(`selector not found in theme.css: ${selector}`);
	const braceStart = css.indexOf('{', selectorAt);
	const braceEnd = css.indexOf('}', braceStart);
	if (braceStart === -1 || braceEnd === -1) {
		throw new Error(`could not find a { ... } body for selector: ${selector}`);
	}
	return css.slice(braceStart + 1, braceEnd);
}

/** Pulls every `--token-name: value;` pair out of a block. */
function extractTokens(block: string): Record<string, string> {
	const tokens: Record<string, string> = {};
	const re = /--([a-z0-9-]+):\s*([^;]+);/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(block))) {
		tokens[`--${match[1]}`] = match[2].trim();
	}
	return tokens;
}

/** Pulls the alpha channel out of an `rgba(r, g, b, a)` literal. */
function alphaOf(rgba: string): number {
	const match = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(rgba);
	if (!match) throw new Error(`not an rgba(...) value: ${rgba}`);
	return Number(match[1]);
}

const darkTokens = extractTokens(extractBlock(THEME_CSS, "[data-theme='dark']"));
const lightTokens = extractTokens(extractBlock(THEME_CSS, "[data-theme='light']"));

describe('theme.css token tables', () => {
	it('define a non-trivial, matching set of tokens', () => {
		expect(Object.keys(darkTokens).length).toBeGreaterThan(10);
		expect(Object.keys(lightTokens).length).toBeGreaterThan(10);
	});

	it('define exactly the same token names in both themes — no key missing either way', () => {
		const darkNames = Object.keys(darkTokens).sort();
		const lightNames = Object.keys(lightTokens).sort();
		const missingFromLight = darkNames.filter((n) => !lightTokens[n]);
		const missingFromDark = lightNames.filter((n) => !darkTokens[n]);
		expect(missingFromLight, 'tokens present in dark but missing from light').toEqual([]);
		expect(missingFromDark, 'tokens present in light but missing from dark').toEqual([]);
		expect(darkNames).toEqual(lightNames);
	});

	it('sets dark dim/faint alpha to 0.62 / 0.56 exactly', () => {
		expect(alphaOf(darkTokens['--text-dim'])).toBe(0.62);
		expect(alphaOf(darkTokens['--text-faint'])).toBe(0.56);
	});

	it('sets light dim/faint alpha to 0.78 / 0.70 exactly', () => {
		expect(alphaOf(lightTokens['--text-dim'])).toBe(0.78);
		expect(alphaOf(lightTokens['--text-faint'])).toBe(0.7);
	});

	it("does not copy one theme's dim/faint pair onto the other", () => {
		expect(darkTokens['--text-dim']).not.toBe(lightTokens['--text-dim']);
		expect(darkTokens['--text-faint']).not.toBe(lightTokens['--text-faint']);
		expect(alphaOf(darkTokens['--text-dim'])).not.toBe(alphaOf(lightTokens['--text-dim']));
		expect(alphaOf(darkTokens['--text-faint'])).not.toBe(alphaOf(lightTokens['--text-faint']));
	});
});

describe('resolveTheme', () => {
	type MatchMediaStub = (query: string) => MediaQueryList;

	function stubMatchMedia(preference: 'dark' | 'light' | 'none'): void {
		const stub: MatchMediaStub = (query: string) =>
			({
				matches: preference === 'none' ? false : query.includes(preference),
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false
			}) as MediaQueryList;
		window.matchMedia = stub as typeof window.matchMedia;
	}

	const originalMatchMedia = window.matchMedia;
	afterEach(() => {
		window.matchMedia = originalMatchMedia;
	});

	it('"system" follows prefers-color-scheme: dark', () => {
		stubMatchMedia('dark');
		expect(resolveTheme('system')).toBe('dark');
	});

	it('"system" follows prefers-color-scheme: light', () => {
		stubMatchMedia('light');
		expect(resolveTheme('system')).toBe('light');
	});

	it('"system" falls back to dark when the browser reports no preference at all', () => {
		stubMatchMedia('none');
		expect(resolveTheme('system')).toBe('dark');
	});

	it('"light" ignores prefers-color-scheme entirely, even when it says dark', () => {
		stubMatchMedia('dark');
		expect(resolveTheme('light')).toBe('light');
	});

	it('"dark" ignores prefers-color-scheme entirely, even when it says light', () => {
		stubMatchMedia('light');
		expect(resolveTheme('dark')).toBe('dark');
	});
});
