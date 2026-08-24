import { describe, expect, it } from 'vitest';
import { createGaugeGeometry } from '../../../../src/modules/timer/components/gauge-geometry';

// Same canonical test timezone as tests/lib/server/domain/logical-day.test.ts.
const TIME_ZONE = 'Europe/Prague';
const DEFAULT_WINDOW = { start: '06:00', end: '00:00' };

/**
 * `n mod m`, always in `[0, m)`. Deliberately duplicated rather than imported —
 * `gauge-geometry.ts` is not allowed to export its internal `euclideanMod`, and this
 * test needs the same wraparound arithmetic to check the module's claims from the
 * outside, independently of its own implementation.
 */
function euclideanMod(n: number, m: number): number {
	return ((n % m) + m) % m;
}

describe('createGaugeGeometry — angleOf', () => {
	it('one hour is exactly 15°', () => {
		const geometry = createGaugeGeometry(DEFAULT_WINDOW, '2026-06-15', TIME_ZONE, 160, 160);
		const t1 = new Date('2026-06-15T10:00:00Z');
		const t2 = new Date('2026-06-15T11:00:00Z'); // exactly one hour later, same UTC offset
		expect(geometry.angleOf(t2) - geometry.angleOf(t1)).toBe(15);
	});

	it('the same wall-clock time gives the same angle on any date', () => {
		const geometry = createGaugeGeometry(DEFAULT_WINDOW, '2026-01-15', TIME_ZONE, 160, 160);
		// 14:30 local time on a January date (CET, UTC+1) and a July date (CEST,
		// UTC+2) — different UTC offsets, same wall clock. If the mapping secretly
		// depended on the calendar date (or drifted with DST) these would differ.
		const january = new Date('2026-01-15T13:30:00Z'); // 14:30 CET
		const july = new Date('2026-07-15T12:30:00Z'); // 14:30 CEST
		const angleJanuary = geometry.angleOf(january);
		const angleJuly = geometry.angleOf(july);
		expect(angleJanuary).toBe(angleJuly);
		expect(angleJanuary).toBe(45 + 14 * 60 * 0.25 + 30 * 0.25); // = 262.5
	});

	it('returns the raw formula value past the window, never clamped to trackStart/trackEnd', () => {
		const geometry = createGaugeGeometry(DEFAULT_WINDOW, '2026-06-15', TIME_ZONE, 160, 160);
		const twoAm = new Date('2026-06-15T00:00:00Z'); // 02:00 CEST — inside the Gauge_Gap
		const angle = geometry.angleOf(twoAm);
		const expected = 45 + 2 * 60 * 0.25; // plain formula: 75
		expect(angle).toBe(expected);
		expect(angle).not.toBe(geometry.trackStart);
		expect(angle).not.toBe(geometry.trackEnd);
	});
});

describe('createGaugeGeometry — default 06:00 → 00:00 window', () => {
	const geometry = createGaugeGeometry(DEFAULT_WINDOW, '2026-06-15', TIME_ZONE, 160, 160);

	it('yields a 270° track', () => {
		// trackStart/trackEnd are not normalized into [0, 360) — the module keeps
		// trackEnd as ANGLE_OFFSET_DEG + endMinutes * DEG_PER_MINUTE with endMinutes
		// already wrapped past midnight, so the difference is taken directly.
		expect(geometry.trackEnd - geometry.trackStart).toBe(270);
	});

	it('centers the 90° gap on 03:00 — verified independently of the implementation', () => {
		// The gap is the complement of the track on the circle: the interval
		// (trackEnd, trackStart + 360) in the same unnormalized representation
		// graduations() itself uses (see gauge-geometry.ts's `canonicalAngle`).
		// Its midpoint, reduced mod 360, is the independent computation; it is
		// compared against angleOf(03:00) rather than assumed equal.
		const gapMidpoint = euclideanMod((geometry.trackEnd + (geometry.trackStart + 360)) / 2, 360);
		const threeAm = new Date('2026-06-15T01:00:00Z'); // 03:00 CEST
		const threeAmAngle = euclideanMod(geometry.angleOf(threeAm), 360);

		expect(gapMidpoint).toBe(90);
		expect(threeAmAngle).toBe(90);
		expect(threeAmAngle).toBe(gapMidpoint);
	});
});

describe('createGaugeGeometry — graduations() for the default window', () => {
	const geometry = createGaugeGeometry(DEFAULT_WINDOW, '2026-06-15', TIME_ZONE, 160, 160);
	const marks = geometry.graduations();

	it('has one mark per hour inside the window (06:00–23:00 and 00:00), none in the gap', () => {
		const hours = marks.map((m) => m.hour).sort((a, b) => a - b);
		expect(hours).toEqual([0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
		for (const gapHour of [1, 2, 3, 4, 5]) {
			expect(hours).not.toContain(gapHour);
		}
	});

	it('level 6 marks appear at 00, 06, 12, 18', () => {
		const level6Hours = marks
			.filter((m) => m.level === 6)
			.map((m) => m.hour)
			.sort((a, b) => a - b);
		expect(level6Hours).toEqual([0, 6, 12, 18]);
	});

	it('level 3 marks appear at 09, 15, 21', () => {
		const level3Hours = marks
			.filter((m) => m.level === 3)
			.map((m) => m.hour)
			.sort((a, b) => a - b);
		expect(level3Hours).toEqual([9, 15, 21]);
	});

	it('level 1 marks are every other hour inside the window', () => {
		const level1Hours = marks
			.filter((m) => m.level === 1)
			.map((m) => m.hour)
			.sort((a, b) => a - b);
		expect(level1Hours).toEqual([7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23]);
	});

	it('numerals are exact two-digit zero-padded hours, never a bare or minute-bearing string', () => {
		const labeled = marks.filter((m) => m.label !== null);
		expect(labeled.length).toBeGreaterThan(0);
		for (const mark of labeled) {
			expect(mark.label).toMatch(/^\d{2}$/);
			expect(mark.label).toBe(String(mark.hour).padStart(2, '0'));
		}
	});

	it('level 1 marks carry no label', () => {
		for (const mark of marks.filter((m) => m.level === 1)) {
			expect(mark.label).toBeNull();
		}
	});

	it('03 is never labelled, and is not even returned for the default window', () => {
		expect(marks.some((m) => m.label === '03')).toBe(false);
		expect(marks.some((m) => m.hour === 3)).toBe(false);
	});
});

describe('createGaugeGeometry — a full day (a window with no gap) closes the circle', () => {
	// What this pure module actually owns for "a full day closes the circle" is the
	// Gauge_Window itself spanning the full 24 hours — a window whose start and end
	// coincide, per the `graduations()` comment in gauge-geometry.ts: "even at the
	// full 360° (start === end) window ... every canonical angle then satisfies
	// `<= trackEnd`, which is exactly the 'no gap at all' behaviour". Turning a
	// closed-ring *arc* into an SVG `<circle>` (design.md's "a closed ring cannot be
	// drawn as an arc back to its own start point") is DayGauge.svelte's concern, a
	// later task, not this module's — see the note below `arc()`'s periodicity for
	// why calling `arc()` itself with a literal 24h-apart pair is a different,
	// out-of-contract question (`arc()` requires a single-calendar-day span).
	const geometry = createGaugeGeometry({ start: '00:00', end: '00:00' }, '2026-06-15', TIME_ZONE, 160, 160);

	it('yields a full 360° track — no gap at all', () => {
		expect(geometry.trackEnd - geometry.trackStart).toBe(360);
	});

	it('graduations() returns exactly one mark per hour, all 24, without adding an extra closing mark', () => {
		const marks = geometry.graduations();
		const hours = marks.map((m) => m.hour).sort((a, b) => a - b);
		expect(hours).toEqual(Array.from({ length: 24 }, (_, h) => h));
		expect(marks).toHaveLength(24); // not 25 — the seam does not get a duplicate mark
	});

	it('with no Gauge_Gap to hide it in, 03:00 gets its ordinary level-3 numeral', () => {
		// Confirms "03 is never labelled" (tested above) is a consequence of the
		// default window's gap, not a hardcoded special case for hour 3.
		const threeOClock = geometry.graduations().find((m) => m.hour === 3);
		expect(threeOClock).toBeDefined();
		expect(threeOClock?.level).toBe(3);
		expect(threeOClock?.label).toBe('03');
	});
});

describe('createGaugeGeometry — arc() minimum sweep floor', () => {
	const geometry = createGaugeGeometry(DEFAULT_WINDOW, '2026-06-15', TIME_ZONE, 160, 160);

	it('floors a 2-minute arc to 1.5° while still reporting the true 120 seconds', () => {
		const from = new Date('2026-06-15T10:00:00Z');
		const to = new Date('2026-06-15T10:02:00Z');
		const result = geometry.arc(from, to, 118);
		expect(result.drawnDegrees).toBe(1.5);
		expect(result.trueSeconds).toBe(120); // the floor never contaminates the true value
	});

	it('does not floor an arc already at the 1.5° / 6-minute threshold', () => {
		const from = new Date('2026-06-15T10:00:00Z');
		const to = new Date('2026-06-15T10:06:00Z'); // exactly 6 minutes = 1.5°
		const result = geometry.arc(from, to, 118);
		expect(result.drawnDegrees).toBe(1.5);
		expect(result.trueSeconds).toBe(360);
	});
});
