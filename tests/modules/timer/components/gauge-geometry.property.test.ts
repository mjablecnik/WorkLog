import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGaugeGeometry } from '../../../../src/modules/timer/components/gauge-geometry';

/**
 * Property 1 (design.md "Correctness Properties" § Property 1) and Property 3
 * (§ Property 3) for `gauge-geometry.ts`. See that module's header for why it has
 * no project imports of its own — this test file mirrors that isolation and only
 * imports `createGaugeGeometry`.
 *
 * A fixed reference date and the `UTC` time zone are used throughout. Property 1
 * itself says the calendar date must not matter, and fixing both removes any
 * DST-offset noise from `offsetMinutesAt` (which rounds to the nearest minute) —
 * under `UTC` that offset is always exactly zero, so `angleOf`'s formula reduces to
 * pure linear arithmetic on integer minutes and 0.25 (a power of two, exact in
 * binary floating point). A tiny epsilon is still used on every angle comparison
 * below as a safety margin, not because a failure is expected.
 */

const EPS = 1e-9;

/** Mathematical modulo, always in `[0, m)` — `%` alone returns negative results for negative `n`. */
function mod(n: number, m: number): number {
	return ((n % m) + m) % m;
}

const REF_YEAR = 2026;
const REF_MONTH_INDEX = 5; // June (0-indexed)
const REF_DAY = 15;
const REF_DATE = '2026-06-15';

/** The instant `dayOffset` calendar days after the reference date, at `minuteOfDay` UTC. */
function instantAt(minuteOfDay: number, dayOffset = 0): Date {
	return new Date(Date.UTC(REF_YEAR, REF_MONTH_INDEX, REF_DAY + dayOffset, 0, 0, 0) + minuteOfDay * 60_000);
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/** Minutes since midnight, formatted as the `Gauge_Window` endpoint format `HH:MM`. */
function minutesToHHMM(minuteOfDay: number): string {
	const h = Math.floor(minuteOfDay / 60) % 24;
	const m = minuteOfDay % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

/**
 * A valid `Gauge_Window`, matching the constraint `src/lib/server/core/config.ts`
 * enforces at startup (`GAUGE_START`/`GAUGE_END` describe a window between 1 and 24
 * hours long — `lengthMin` in `[60, 1440]`). Carries the raw `startMin`/`lengthMin`
 * alongside the formatted `{ start, end }` window so tests can check containment in
 * plain minutes as well as in degrees, without re-parsing the strings.
 */
const windowArb = fc
	.tuple(fc.integer({ min: 0, max: 1439 }), fc.integer({ min: 60, max: 1440 }))
	.map(([startMin, lengthMin]) => {
		const endMin = (startMin + lengthMin) % 1440;
		return { window: { start: minutesToHHMM(startMin), end: minutesToHHMM(endMin) }, startMin, lengthMin };
	});

const DEFAULT_WINDOW = { start: '06:00', end: '00:00' }; // the project default (GAUGE_START/GAUGE_END)
const FULL_DAY_WINDOW = { start: '00:00', end: '00:00' }; // 24h, no gap at all
const WRAPPING_WINDOW = { start: '20:00', end: '04:00' }; // crosses midnight, well away from the default

describe('Feature: worklog-ui, Property 1: Gauge mapping', () => {
	it('is uniform and strictly increasing for any pair of instants within one day, under any Gauge_Window', () => {
		fc.assert(
			fc.property(
				windowArb,
				fc.integer({ min: 0, max: 1439 }),
				fc.integer({ min: 0, max: 1439 }),
				({ window }, m1, m2) => {
					fc.pre(m1 !== m2);
					const [aMin, bMin] = m1 < m2 ? [m1, m2] : [m2, m1];

					const geometry = createGaugeGeometry(window, REF_DATE, 'UTC', 160, 160);
					const a = instantAt(aMin);
					const b = instantAt(bMin);

					const diff = geometry.angleOf(b) - geometry.angleOf(a);
					const expected = (bMin - aMin) * 0.25;

					expect(diff).toBeGreaterThan(0);
					expect(Math.abs(diff - expected)).toBeLessThan(EPS);
				}
			),
			{ numRuns: 300 }
		);
	});

	// design.md's literal wording — "angleOf(b) − angleOf(a) ... SHALL equal exactly
	// 360 when b − a is 24 hours" — read as a raw subtraction of the two returned
	// numbers, does NOT hold against the real angleOf(): for any a and a+24h, both
	// instants share the exact same wall-clock time-of-day (no DST under UTC), so by
	// this module's own stated contract ("a given clock time always lands at the same
	// angle regardless of which calendar date it falls on" — see the module header)
	// angleOf(a) === angleOf(a + 24h) EXACTLY, making the raw difference 0, never 360.
	// This is not a bug: angleOf is intentionally periodic (period 1440 minutes /
	// 360°), which is what lets a 23h or 25h Logical_Day keep every graduation in
	// place, and what arc()'s own "split arcs that cross midnight before calling
	// this" contract already assumes. "Completes exactly one turn" is therefore
	// tested here as the mathematically equivalent, implementation-consistent claim —
	// the swept angle returns to the identical dial position after 24h, i.e. the
	// difference is congruent to 0 modulo 360 (0 ≡ 360 mod 360) — rather than as a
	// literal unwrapped 360. Flagged in the task report as a genuine design.md vs.
	// implementation wording mismatch worth a human decision; gauge-geometry.ts was
	// not changed to chase the literal wording.
	it('returns to the exact same angle after any 24-hour span (one full turn, mod 360), for any Gauge_Window', () => {
		fc.assert(
			fc.property(windowArb, fc.integer({ min: 0, max: 1439 }), ({ window }, minuteOfDay) => {
				const geometry = createGaugeGeometry(window, REF_DATE, 'UTC', 160, 160);
				const a = instantAt(minuteOfDay, 0);
				const b = instantAt(minuteOfDay, 1); // exactly 24h later, same wall-clock minute
				const diff = geometry.angleOf(b) - geometry.angleOf(a);
				expect(mod(diff, 360)).toBe(0);
				expect(geometry.angleOf(b)).toBe(geometry.angleOf(a));
			}),
			{ numRuns: 300 }
		);
	});

	it('returns to the exact same angle across a day boundary, explicitly, for a spread of representative windows', () => {
		// Explicit, non-property case per the task: a fixed pair of instants 24h apart,
		// crossing a real day boundary, checked against several concrete windows
		// (default, full-day, and a wrapping one) to make the window-independence claim
		// visible without relying only on the generator above.
		for (const window of [DEFAULT_WINDOW, FULL_DAY_WINDOW, WRAPPING_WINDOW]) {
			const geometry = createGaugeGeometry(window, REF_DATE, 'UTC', 160, 160);
			const a = instantAt(600, 0); // 10:00 on the reference date
			const b = instantAt(600, 1); // 10:00 the following calendar date
			const diff = geometry.angleOf(b) - geometry.angleOf(a);
			expect(mod(diff, 360)).toBe(0);
			expect(geometry.angleOf(b)).toBe(geometry.angleOf(a));
		}
	});
});

describe('Feature: worklog-ui, Property 3: Bare gap', () => {
	it('every graduation lies on the track, by the wraparound-safe containment formula', () => {
		fc.assert(
			fc.property(windowArb, ({ window }) => {
				const geometry = createGaugeGeometry(window, REF_DATE, 'UTC', 160, 160);
				const marks = geometry.graduations();

				// `trackEnd - trackStart` is guaranteed to lie in (0°, 360°] by construction
				// (the Gauge_Window is validated to be between 1 and 24 hours long — see
				// windowArb above and gauge-geometry.ts's own comment on this invariant), so
				// it needs no further reduction: applying a further "mod 360" to it would
				// wrongly collapse the full-circle (24h, no-gap) case from 360 down to 0.
				const trackSpan = geometry.trackEnd - geometry.trackStart;
				expect(trackSpan).toBeGreaterThan(0);
				expect(trackSpan).toBeLessThanOrEqual(360);

				for (const mark of marks) {
					const relativeAngle = mod(mark.angle - geometry.trackStart, 360);
					expect(relativeAngle).toBeLessThanOrEqual(trackSpan + EPS);
				}
			}),
			{ numRuns: 300 }
		);
	});

	it('no graduation falls inside the Gauge_Gap, checked independently in plain minutes', () => {
		fc.assert(
			fc.property(windowArb, ({ window, startMin, lengthMin }) => {
				const geometry = createGaugeGeometry(window, REF_DATE, 'UTC', 160, 160);
				const marks = geometry.graduations();

				for (const mark of marks) {
					// A second, independent check from a different angle than the degree-based
					// containment formula above: reduce the mark's wall-clock hour to minutes
					// since midnight and compare directly against the window's own start/length
					// in minutes, with no trigonometry or angle arithmetic involved at all.
					const markMinute = mark.hour * 60;
					const relativeMinute = mod(markMinute - startMin, 1440);
					expect(relativeMinute).toBeLessThanOrEqual(lengthMin);
				}
			}),
			{ numRuns: 300 }
		);
	});
});
