/**
 * The eight Palette_Slot values (Design_Contract, .design/DESIGN.md § Project Palette),
 * both themes, exactly as measured. Overridable per project via `colorIndex`
 * (Requirement 11.10) but never derived from anything else in the interface.
 *
 * `colorIndex` always comes from the server — `ActivityEntry.colorIndex`,
 * `ProjectTotal.colorIndex`, `ProjectInterval.colorIndex` — and is never resolved by
 * joining the projects list in the browser (Requirement 11.9): a join would be wrong
 * for an archived project missing from that list, and stale for one recoloured in
 * another tab.
 *
 * There is no `projectColorVar` (it would write an inline custom property, which the
 * production CSP forbids — Requirement 17.13) and no `labelInkOn` (no text is ever
 * placed on a filled Palette_Slot, so the question it would answer never arises).
 */

export type PaletteSlot = { readonly dark: string; readonly light: string };

export const PROJECT_PALETTE: readonly PaletteSlot[] = [
	{ dark: '#3899EA', light: '#2287D7' }, // 0 blue
	{ dark: '#B7466C', light: '#CC5A7F' }, // 1 pink
	{ dark: '#09AF72', light: '#006640' }, // 2 green
	{ dark: '#A67102', light: '#B27A00' }, // 3 amber
	{ dark: '#7C5CC0', light: '#613FA0' }, // 4 violet
	{ dark: '#019FB5', light: '#0191A6' }, // 5 teal
	{ dark: '#A19201', light: '#7F7302' }, // 6 olive
	{ dark: '#BA4939', light: '#CB5848' } // 7 clay
] as const;

export const PALETTE_SIZE = PROJECT_PALETTE.length; // 8

/**
 * `pj-0` … `pj-7`, wrapping at eight (Requirement 11.9's "beyond eight projects
 * color_index wraps"). The class itself is precompiled in `palette.css` (task 1.5) —
 * this function only names it.
 */
export function projectSlotClass(colorIndex: number): string {
	const index = ((colorIndex % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
	return `pj-${index}`;
}

/**
 * The slot a color_index resolves to, for the Day_Gauge, which writes SVG
 * presentation attributes directly (Requirement 17.13 § 3 — SVG is unaffected by the
 * no-inline-style rule, so the gauge may compute `stroke="…"` per render).
 */
export function projectColor(colorIndex: number, theme: 'dark' | 'light'): string {
	const index = ((colorIndex % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
	return PROJECT_PALETTE[index][theme];
}
