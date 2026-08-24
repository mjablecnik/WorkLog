/**
 * Task 1.14. Pins `PROJECT_PALETTE` to the design table's literal hex values (both
 * themes), so a future "simplification" that nudges a colour cannot pass silently —
 * the measured separation numbers in design.md's "Project Palette" section only hold
 * for these exact values. Runs under the `domain` Vitest project (node), per
 * `vitest.config.ts`'s explicit `tests/lib/viz/**` include.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_SIZE, PROJECT_PALETTE, projectColor, projectSlotClass } from '../../../src/lib/viz/palette';

// Transcribed verbatim from .kiro/specs/002-worklog-ui/design.md, "### Project Palette".
const EXPECTED_PALETTE: { dark: string; light: string }[] = [
	{ dark: '#3899EA', light: '#2287D7' }, // 0 blue
	{ dark: '#B7466C', light: '#CC5A7F' }, // 1 pink
	{ dark: '#09AF72', light: '#006640' }, // 2 green
	{ dark: '#A67102', light: '#B27A00' }, // 3 amber
	{ dark: '#7C5CC0', light: '#613FA0' }, // 4 violet
	{ dark: '#019FB5', light: '#0191A6' }, // 5 teal
	{ dark: '#A19201', light: '#7F7302' }, // 6 olive
	{ dark: '#BA4939', light: '#CB5848' } // 7 clay
];

// theme.css's own literals — the destructive token is deliberately never derived from
// a Palette_Slot, but a slot color colliding with it would still be a real defect.
const DESTRUCTIVE_DARK = '#E06A5E';
const DESTRUCTIVE_LIGHT = '#A8321F';

describe('PROJECT_PALETTE', () => {
	it('has exactly eight slots', () => {
		expect(PROJECT_PALETTE.length).toBe(8);
		expect(PALETTE_SIZE).toBe(8);
	});

	it('matches the design table exactly, slot by slot, both themes', () => {
		expect(PROJECT_PALETTE.length).toBe(EXPECTED_PALETTE.length);
		for (let i = 0; i < EXPECTED_PALETTE.length; i++) {
			expect(PROJECT_PALETTE[i].dark).toBe(EXPECTED_PALETTE[i].dark);
			expect(PROJECT_PALETTE[i].light).toBe(EXPECTED_PALETTE[i].light);
		}
	});

	it('never puts the destructive token color in a slot, in either theme', () => {
		for (const slot of PROJECT_PALETTE) {
			expect(slot.dark.toUpperCase()).not.toBe(DESTRUCTIVE_DARK);
			expect(slot.light.toUpperCase()).not.toBe(DESTRUCTIVE_LIGHT);
		}
	});
});

describe('projectSlotClass', () => {
	it('names pj-0 through pj-7 for indices 0-7', () => {
		for (let i = 0; i < 8; i++) {
			expect(projectSlotClass(i)).toBe(`pj-${i}`);
		}
	});

	it('wraps 8 to pj-0 (Requirement 11.9)', () => {
		expect(projectSlotClass(8)).toBe('pj-0');
		expect(projectSlotClass(9)).toBe('pj-1');
		expect(projectSlotClass(16)).toBe('pj-0');
	});

	it('wraps a negative index sensibly, forward from pj-7', () => {
		expect(projectSlotClass(-1)).toBe('pj-7');
		expect(projectSlotClass(-8)).toBe('pj-0');
		expect(projectSlotClass(-9)).toBe('pj-7');
	});
});

describe('projectColor', () => {
	it('resolves the same slot projectSlotClass names, per theme', () => {
		expect(projectColor(0, 'dark')).toBe(PROJECT_PALETTE[0].dark);
		expect(projectColor(0, 'light')).toBe(PROJECT_PALETTE[0].light);
		expect(projectColor(7, 'dark')).toBe(PROJECT_PALETTE[7].dark);
	});

	it('wraps beyond eight exactly like projectSlotClass', () => {
		expect(projectColor(8, 'dark')).toBe(PROJECT_PALETTE[0].dark);
		expect(projectColor(-1, 'light')).toBe(PROJECT_PALETTE[7].light);
	});
});
