/**
 * Task 1.14. The check that would have caught dark faint at 3.38:1 (design.md's own
 * history, and `theme.css`'s comment on `--text-dim`/`--text-faint`): compute the
 * REAL WCAG contrast ratio of `--text-dim`/`--text-faint` against `--bg`, in both
 * themes, from `theme.css`'s own literals — not from the alpha numbers alone, since
 * alpha in isolation says nothing about the resulting contrast without compositing
 * over the ground colour first.
 *
 * Runs under the `components` (jsdom) Vitest project by location
 * (`tests/lib/theme/**`), same as theme.test.ts — harmless here since this file only
 * uses `fs` and arithmetic, no DOM.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const THEME_CSS_PATH = resolve(__dirname, '../../../src/lib/theme/theme.css');
const THEME_CSS = readFileSync(THEME_CSS_PATH, 'utf8');

// --- Local CSS token extraction (deliberately small and self-contained here rather
// than shared with theme.test.ts — see task instructions) --------------------------

function extractBlock(css: string, selector: string): string {
	const selectorAt = css.indexOf(selector);
	if (selectorAt === -1) throw new Error(`selector not found in theme.css: ${selector}`);
	const braceStart = css.indexOf('{', selectorAt);
	const braceEnd = css.indexOf('}', braceStart);
	return css.slice(braceStart + 1, braceEnd);
}

function extractVar(block: string, name: string): string {
	const re = new RegExp(`--${name}:\\s*([^;]+);`);
	const match = re.exec(block);
	if (!match) throw new Error(`token not found: --${name}`);
	return match[1].trim();
}

// --- Colour math --------------------------------------------------------------------

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
	if (!match) throw new Error(`not a #rrggbb hex colour: ${hex}`);
	return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function parseRgba(value: string): Rgb & { a: number } {
	const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(
		value
	);
	if (!match) throw new Error(`not an rgb(a)(...) value: ${value}`);
	return {
		r: Number(match[1]),
		g: Number(match[2]),
		b: Number(match[3]),
		a: match[4] === undefined ? 1 : Number(match[4])
	};
}

/** Alpha-composites `fg` (with its own alpha) over the opaque `bg`, per channel:
 * `result = fg*alpha + bg*(1-alpha)`. */
function compositeOver(fg: Rgb & { a: number }, bg: Rgb): Rgb {
	return {
		r: fg.r * fg.a + bg.r * (1 - fg.a),
		g: fg.g * fg.a + bg.g * (1 - fg.a),
		b: fg.b * fg.a + bg.b * (1 - fg.a)
	};
}

/** WCAG relative luminance: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function relativeLuminance({ r, g, b }: Rgb): number {
	const channel = (c: number) => {
		const cs = c / 255;
		return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio: (L1 + 0.05) / (L2 + 0.05), with L1 the lighter of the two. */
function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

/** The ratio `theme.css` would actually render: `token` (an rgba(...) ink) composited
 * over `bgHex`, then measured against that same `bgHex`. */
function measuredContrastAgainstBg(tokenRgba: string, bgHex: string): number {
	const bg = hexToRgb(bgHex);
	const composited = compositeOver(parseRgba(tokenRgba), bg);
	return contrastRatio(composited, bg);
}

// --- Extracted theme.css literals ----------------------------------------------------

const darkBlock = extractBlock(THEME_CSS, "[data-theme='dark']");
const lightBlock = extractBlock(THEME_CSS, "[data-theme='light']");

const DARK_BG = extractVar(darkBlock, 'bg');
const DARK_TEXT_DIM = extractVar(darkBlock, 'text-dim');
const DARK_TEXT_FAINT = extractVar(darkBlock, 'text-faint');

const LIGHT_BG = extractVar(lightBlock, 'bg');
const LIGHT_TEXT_DIM = extractVar(lightBlock, 'text-dim');
const LIGHT_TEXT_FAINT = extractVar(lightBlock, 'text-faint');

// WCAG AA floor for normal-size text (Requirement 14.10).
const WCAG_AA_NORMAL_TEXT = 4.5;

describe('measured contrast of --text-dim / --text-faint against --bg', () => {
	it('dark --text-dim clears 4.5:1 (design.md states ~6.44:1)', () => {
		const ratio = measuredContrastAgainstBg(DARK_TEXT_DIM, DARK_BG);
		expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
		expect(Math.abs(ratio - 6.44)).toBeLessThan(0.2);
	});

	it('dark --text-faint clears 4.5:1 (design.md states ~5.47:1) — the exact check that would have caught 3.38:1', () => {
		const ratio = measuredContrastAgainstBg(DARK_TEXT_FAINT, DARK_BG);
		expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
		expect(Math.abs(ratio - 5.47)).toBeLessThan(0.2);
	});

	it('light --text-dim clears 4.5:1 (design.md states ~6.84:1)', () => {
		const ratio = measuredContrastAgainstBg(LIGHT_TEXT_DIM, LIGHT_BG);
		expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
		expect(Math.abs(ratio - 6.84)).toBeLessThan(0.2);
	});

	it('light --text-faint clears 4.5:1 (design.md states ~5.31:1)', () => {
		const ratio = measuredContrastAgainstBg(LIGHT_TEXT_FAINT, LIGHT_BG);
		expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
		expect(Math.abs(ratio - 5.31)).toBeLessThan(0.2);
	});
});
