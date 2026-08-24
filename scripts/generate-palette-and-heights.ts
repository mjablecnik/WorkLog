/**
 * Generates `src/lib/theme/palette.css` and `src/lib/theme/timeline-heights.css` from
 * `src/lib/viz/palette.ts` and `src/modules/day/components/timeline-geometry.ts` — see
 * `.kiro/specs/002-worklog-ui/design.md`, "Applying Tokens Without Inline Styles" and
 * "1. Colour Palette", and `tasks.md` task 1.5.
 *
 * Run with `bun run generate:css` (or directly: `bun run scripts/generate-palette-and-heights.ts`).
 * `bun run check` runs this same generator and then diffs its output against the
 * committed files — see the `check` script in `package.json`.
 *
 * Both output files are committed rather than built at install time, so a clean
 * checkout renders correctly with no pre-step; they are generated rather than
 * hand-written so the palette hexes and the height ladder each exist in exactly one
 * place (`palette.ts` and `timeline-geometry.ts` respectively). Running this script
 * twice with no source changes MUST produce byte-for-byte identical files — no
 * timestamps, no non-deterministic ordering.
 *
 * Import paths: this script runs outside Vite, directly via `bun run`, not through
 * SvelteKit's dev/build pipeline. Bun's own module resolver reads the `paths` entry
 * SvelteKit writes into `.svelte-kit/tsconfig.json` (extended by the project's
 * `tsconfig.json`), so the `$lib` and `$modules` aliases below resolve correctly even
 * standalone — verified by running a throwaway script under `scripts/` that imports
 * through each alias and logs the result. A relative import was not needed.
 */

import { PROJECT_PALETTE, PALETTE_SIZE } from '$lib/viz/palette';
import { MIN_BLOCK_PX, HEIGHT_STEP_PX, FILL_THRESHOLD_PX } from '$modules/day/components/timeline-geometry';

const OUT_DIR = new URL('../src/lib/theme/', import.meta.url);

const GENERATED_NOTICE = 'GENERATED — do not hand-edit. Run `bun run generate:css` to regenerate.';

// ---------------------------------------------------------------------------------
// palette.css
// ---------------------------------------------------------------------------------

/** Alpha for `--pj-tint` — the lighter ground needs less of it to read at the same weight. */
const TINT_ALPHA = { dark: 0.16, light: 0.13 } as const;

function hexToRgb(hex: string): readonly [number, number, number] {
	const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
	if (!match) throw new Error(`Not a 6-digit hex colour: ${hex}`);
	return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function rgba([r, g, b]: readonly [number, number, number], alpha: number): string {
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildPaletteCss(): string {
	const lines: string[] = [];
	lines.push('/**');
	lines.push(` * ${GENERATED_NOTICE}`);
	lines.push(' * Source: src/lib/viz/palette.ts (PROJECT_PALETTE), by scripts/generate-palette-and-heights.ts');
	lines.push(' *');
	lines.push(' * Eight classes, `.pj-0` … `.pj-7` — one per Palette_Slot — each theme-aware through');
	lines.push(" * the same `:root` / `[data-theme='dark']` / `[data-theme='light']` selector pattern");
	lines.push(' * `theme.css` uses (dark doubles as the `:root` fallback, for anything rendered before');
	lines.push(" * `data-theme` is known). `--pj` is the slot's hex for that theme; `--pj-tint` is the");
	lines.push(` * same colour at ${TINT_ALPHA.dark} alpha in dark and ${TINT_ALPHA.light} in light — computed from each`);
	lines.push(" * theme's own hex, never derived by reusing the dark hex with a different alpha.");
	lines.push(' *');
	lines.push(' * No `.pj-*` class references `--destructive`, and no destructive control references a');
	lines.push(' * `.pj-*` class — the pink slot and the destructive colour sit close together and must');
	lines.push(' * stay separable.');
	lines.push(' */');
	lines.push('');

	for (let i = 0; i < PALETTE_SIZE; i++) {
		const slot = PROJECT_PALETTE[i];
		const darkHex = slot.dark.toLowerCase();
		const lightHex = slot.light.toLowerCase();
		const darkTint = rgba(hexToRgb(slot.dark), TINT_ALPHA.dark);
		const lightTint = rgba(hexToRgb(slot.light), TINT_ALPHA.light);

		lines.push(`:root .pj-${i},`);
		lines.push(`[data-theme='dark'] .pj-${i} {`);
		lines.push(`\t--pj: ${darkHex};`);
		lines.push(`\t--pj-tint: ${darkTint};`);
		lines.push('}');
		lines.push(`[data-theme='light'] .pj-${i} {`);
		lines.push(`\t--pj: ${lightHex};`);
		lines.push(`\t--pj-tint: ${lightTint};`);
		lines.push('}');
		if (i < PALETTE_SIZE - 1) lines.push('');
	}

	lines.push('');
	return lines.join('\n');
}

// ---------------------------------------------------------------------------------
// timeline-heights.css
// ---------------------------------------------------------------------------------

function buildTimelineHeightsCss(): string {
	const floorPx = Math.min(MIN_BLOCK_PX.desktop, MIN_BLOCK_PX.mobile);
	const ceilingPx = FILL_THRESHOLD_PX;

	const ruleCount = Math.floor((ceilingPx - floorPx) / HEIGHT_STEP_PX) + 1;

	const lines: string[] = [];
	lines.push('/**');
	lines.push(` * ${GENERATED_NOTICE}`);
	lines.push(
		' * Source: src/modules/day/components/timeline-geometry.ts (MIN_BLOCK_PX, HEIGHT_STEP_PX,'
	);
	lines.push(' * FILL_THRESHOLD_PX), by scripts/generate-palette-and-heights.ts');
	lines.push(' *');
	lines.push(
		` * A continuous ladder, \`.tl-h-${floorPx}\` … \`.tl-h-${ceilingPx}\` in ${HEIGHT_STEP_PX}px steps (${ruleCount} rules), so`
	);
	lines.push(' * every height `layOutDay` can produce is a member by construction — see design.md,');
	lines.push(' * "Applying Tokens Without Inline Styles". `layOutDay` does the quantising itself and');
	lines.push(' * returns a `heightPx` already on the ladder; the component only picks the matching');
	lines.push(' * class. `.tl-h-fill` (`flex: 1 1 auto`) is for the one segment per block column whose');
	lines.push(" * true height exceeds the ladder's ceiling (`fillsColumn` in `LaidOutSegment`).");
	lines.push(' */');
	lines.push('');

	for (let h = floorPx; h <= ceilingPx; h += HEIGHT_STEP_PX) {
		lines.push(`.tl-h-${h} {`);
		lines.push(`\theight: ${h}px;`);
		lines.push('}');
	}

	lines.push('.tl-h-fill {');
	lines.push('\tflex: 1 1 auto;');
	lines.push('}');
	lines.push('');

	return lines.join('\n');
}

// ---------------------------------------------------------------------------------

async function main(): Promise<void> {
	const paletteCss = buildPaletteCss();
	const timelineHeightsCss = buildTimelineHeightsCss();

	await Bun.write(new URL('palette.css', OUT_DIR), paletteCss);
	await Bun.write(new URL('timeline-heights.css', OUT_DIR), timelineHeightsCss);

	console.log('Wrote src/lib/theme/palette.css and src/lib/theme/timeline-heights.css');
}

await main();
