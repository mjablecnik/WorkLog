/**
 * Pure geometry for the `Day_Gauge` (Requirement 16, design.md section "4. Day Gauge").
 * Twenty-four hours map onto a full circle: one hour is a fixed 15°, and a given
 * clock time always lands at the same angle regardless of which calendar date it
 * falls on — that is what makes the mapping survive a 23-hour or 25-hour
 * `Logical_Day` without moving a single graduation (design.md's "Two Readings of
 * One Day"). `Correctness Property 1` (monotone, uniform, one turn per day) and
 * `Correctness Property 3` (the `Gauge_Gap` is never graduated) are both proved
 * against exactly the functions below.
 *
 * Plain TypeScript, zero DOM access, and deliberately free of every project import —
 * including `$lib/viz/format.ts`, even though it is client-safe. `format.ts`'s own
 * header explains why it duplicates `src/lib/server/domain/logical-day.ts`'s
 * `offsetMinutesAt` instead of importing something that imports `$lib/server/**`:
 * two independent copies of a small, easily-reviewed technique can never silently
 * drift apart by sharing a bug. This module follows the same rule and keeps its own
 * third copy, so it never has to import `format.ts` either.
 *
 * DEVIATION FROM design.md'S SUMMARY TABLE: the one-line signature there —
 * `arc(from: Date, to: Date, radius: number): string` — is contradicted by the
 * design's own prose a few paragraphs later, in the "minimum arc" paragraph:
 * "`arc()` returns the drawn sweep **and** the true seconds, so no caller can
 * accidentally report the floored value." A bare `string` cannot carry both. This
 * implementation follows the prose — the more detailed and evidently deliberate of
 * the two — and returns `GaugeArc`, not `string`. See `GaugeArc` below and the
 * report for task 6.2 for the reconciliation this leaves open for design.md itself.
 */

/** The UTC offset, in minutes, of `timeZone` at `instantMs`: `localTime = instant + offset`. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts = dtf.formatToParts(new Date(instantMs));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
	const hour = get('hour') % 24; // "24" at midnight in some locales
	const asNaiveUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		hour,
		get('minute'),
		get('second')
	);
	// `formatToParts` reports whole seconds, so rounding to the nearest minute is safe —
	// every real timezone offset is a whole number of minutes — and matches the same
	// rounding `logical-day.ts` and `format.ts` apply for the same reason.
	return Math.round((asNaiveUtc - instantMs) / MS_PER_MINUTE);
}

/** `n mod m`, always in `[0, m)` — `%` alone returns a negative result for negative `n`. */
function euclideanMod(n: number, m: number): number {
	return ((n % m) + m) % m;
}

/**
 * Minutes since local midnight in `timeZone`, with sub-minute precision — a pure
 * function of `t`'s wall-clock time-of-day, never of the calendar date it falls on.
 * This is the one place `angleOf` differs from a naive `getHours()`/`getMinutes()`
 * read: it goes through `timeZone` rather than the device's own zone (Requirement
 * 1.12's rule, restated here because this module cannot import `format.ts` to reuse
 * its enforcement of it).
 */
function minutesSinceMidnight(t: Date, timeZone: string): number {
	const instantMs = t.getTime();
	const offset = offsetMinutesAt(instantMs, timeZone);
	const localMs = instantMs + offset * MS_PER_MINUTE;
	return euclideanMod(localMs, MS_PER_DAY) / MS_PER_MINUTE;
}

/** Parses a `Gauge_Window` endpoint ("HH:MM") into minutes since midnight. */
function parseClockMinutes(hhmm: string): number {
	const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
	if (!m) throw new RangeError(`invalid Gauge_Window clock value: ${JSON.stringify(hhmm)}`);
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (hour > 23 || minute > 59) {
		throw new RangeError(`invalid Gauge_Window clock value: ${JSON.stringify(hhmm)}`);
	}
	return hour * 60 + minute;
}

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/**
 * Rotation constant in `angleOf(t) = ANGLE_OFFSET_DEG + minutesSinceMidnight × DEG_PER_MINUTE`
 * (design.md's formula, copied verbatim). Combined with `pointAt`'s angle convention —
 * standard SVG: 0° = +x (east), 90° = +y (south — SVG's y axis grows downward, so
 * increasing angle turns clockwise, matching time running clockwise around the dial) —
 * this offset lands 03:00 (`minutesSinceMidnight` 180) at exactly 90°, i.e. straight
 * down from `(cx, cy)`. 03:00 is the centre of the `Gauge_Gap` for the default
 * `06:00 → 00:00` window (design.md's "Two Readings of One Day"), so this constant is
 * what satisfies Requirement 16.3, "place the Gauge_Gap at the bottom of the circle" —
 * not an arbitrary choice. Do not change it without re-deriving that: 03:00 →
 * 45 + (3×60)×0.25 = 45 + 45 = 90.
 */
const ANGLE_OFFSET_DEG = 45;

/** 360° over 24h×60min — one hour is exactly 15°, per Requirement 16.1. */
const DEG_PER_MINUTE = 0.25;

/**
 * The smallest arc sweep this module will ever draw, in degrees — six minutes at
 * `DEG_PER_MINUTE` (design.md's "minimum arc" paragraph). `MIN_INTERVAL_SECONDS`
 * defaults to 60 in `001`, so a one-minute segment (a 0.25° sweep) is reachable, not
 * theoretical, and would render as an invisible sliver under a 6-unit round-capped
 * stroke without this floor. Purely cosmetic: `arc()` reports the true, unfloored
 * `trueSeconds` alongside the floored `drawnDegrees`, so no caller can mistake one
 * for the other.
 */
const MIN_ARC_SWEEP_DEG = 1.5;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The result of `arc()` — see the module header for why this is not the bare
 * `string` design.md's summary table shows.
 */
export type GaugeArc = {
	/** SVG `<path>` `d` attribute, `M … A radius radius 0 largeArcFlag sweepFlag …`. */
	path: string;
	/** The sweep actually drawn, in degrees, after the `MIN_ARC_SWEEP_DEG` floor. Cosmetic. */
	drawnDegrees: number;
	/** The true, unfloored duration from `from` to `to`, in seconds. What every caller MUST report. */
	trueSeconds: number;
};

export type GaugeGeometry = {
	/** Angle in degrees for an instant: `ANGLE_OFFSET_DEG + minutesSinceMidnight × DEG_PER_MINUTE`. Absolute — never clamped or rescaled to the window. */
	angleOf(t: Date): number;
	/** SVG path (plus the drawn/true sweep) for an arc between two instants at a given radius. Requires `angleOf(to) >= angleOf(from)` — split arcs that cross midnight before calling this. */
	arc(from: Date, to: Date, radius: number): GaugeArc;
	/** Point on the circle at an angle and radius — for marks, dots and numerals. */
	pointAt(angleDeg: number, radius: number): { x: number; y: number };
	/** Marks inside the `Gauge_Window` only — the `Gauge_Gap` carries none (Correctness Property 3). */
	graduations(): { angle: number; hour: number; level: 1 | 3 | 6; label: string | null }[];
	/** degrees */
	trackStart: number;
	/** degrees */
	trackEnd: number;
};

/**
 * `window`/`date`/`timeZone`/`cx`/`cy` bind one gauge instance. `date` is validated
 * (fail fast on a malformed `Logical_Day` string) but not otherwise used: every angle
 * below is a pure function of wall-clock time-of-day via `timeZone`, independent of
 * the specific calendar date, which is the whole point of the mapping (see the
 * module header). It stays in the signature because it is part of the contract
 * design.md specifies verbatim, and because the factory conceptually belongs to one
 * `Logical_Day` even though nothing here needs to dereference it.
 */
export function createGaugeGeometry(
	window: { start: string; end: string },
	date: string,
	timeZone: string,
	cx: number,
	cy: number
): GaugeGeometry {
	if (!DATE_RE.test(date)) {
		throw new RangeError(`invalid Logical_Day date: ${JSON.stringify(date)}`);
	}

	const startMinutes = parseClockMinutes(window.start);
	let endMinutes = parseClockMinutes(window.end);
	// Requirement 13.13 (001): GAUGE_END at or before GAUGE_START wraps to the following
	// calendar date — the default 06:00→00:00 must describe eighteen hours, not zero.
	// Duplicated from `dayStartIsInGaugeGap` in `src/lib/server/core/config.ts` for the
	// same reason as `offsetMinutesAt` above: this module cannot import server code.
	if (endMinutes <= startMinutes) endMinutes += 24 * 60;

	const trackStart = ANGLE_OFFSET_DEG + startMinutes * DEG_PER_MINUTE;
	const trackEnd = ANGLE_OFFSET_DEG + endMinutes * DEG_PER_MINUTE;

	function angleOf(t: Date): number {
		return ANGLE_OFFSET_DEG + minutesSinceMidnight(t, timeZone) * DEG_PER_MINUTE;
	}

	function pointAt(angleDeg: number, radius: number): { x: number; y: number } {
		const rad = toRadians(angleDeg);
		return {
			x: cx + radius * Math.cos(rad),
			y: cy + radius * Math.sin(rad)
		};
	}

	function arc(from: Date, to: Date, radius: number): GaugeArc {
		const trueSeconds = (to.getTime() - from.getTime()) / 1000;
		const fromAngle = angleOf(from);
		const toAngle = angleOf(to);
		const trueSweep = toAngle - fromAngle;
		if (trueSweep < 0) {
			throw new RangeError(
				`arc() requires angleOf(to) >= angleOf(from) (got a ${trueSweep}° sweep) — ` +
					`split arcs that cross midnight before calling arc()`
			);
		}

		const floored = trueSweep < MIN_ARC_SWEEP_DEG;
		const drawnDegrees = floored ? MIN_ARC_SWEEP_DEG : trueSweep;
		let drawFromAngle = fromAngle;
		let drawToAngle = toAngle;
		if (floored) {
			// Under six minutes: draw the floor centred on the true midpoint rather than
			// growing from `from`, so a two-minute segment does not silently shift its
			// visible position (design.md's "minimum arc" paragraph).
			const midAngle = (fromAngle + toAngle) / 2;
			drawFromAngle = midAngle - MIN_ARC_SWEEP_DEG / 2;
			drawToAngle = midAngle + MIN_ARC_SWEEP_DEG / 2;
		}

		const p1 = pointAt(drawFromAngle, radius);
		const p2 = pointAt(drawToAngle, radius);
		const largeArcFlag = drawnDegrees > 180 ? 1 : 0;
		const sweepFlag = 1; // angle always increases here, i.e. clockwise in this module's SVG convention
		const path = `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${p2.x} ${p2.y}`;

		return { path, drawnDegrees, trueSeconds };
	}

	function graduations(): { angle: number; hour: number; level: 1 | 3 | 6; label: string | null }[] {
		const marks: { angle: number; hour: number; level: 1 | 3 | 6; label: string | null }[] = [];
		for (let hour = 0; hour < 24; hour++) {
			const rawAngle = ANGLE_OFFSET_DEG + hour * 60 * DEG_PER_MINUTE;
			// Shift into [trackStart, trackStart + 360) before comparing against trackEnd —
			// Correctness Property 3's wraparound-safe test. `trackEnd - trackStart` is
			// always in (0, 360] by construction (the server only ever reports a window
			// between 1 and 24 hours long), so a canonical angle strictly below
			// `trackStart + 360` needs no further special-casing even at the full 360°
			// (start === end) window: every canonical angle then satisfies `<= trackEnd`,
			// which is exactly the "no gap at all" behaviour that configuration means.
			const canonicalAngle = trackStart + euclideanMod(rawAngle - trackStart, 360);
			if (canonicalAngle > trackEnd) continue; // falls in the Gauge_Gap

			const level: 1 | 3 | 6 = hour % 6 === 0 ? 6 : hour % 3 === 0 ? 3 : 1;
			const label = level === 1 ? null : String(hour).padStart(2, '0');
			marks.push({ angle: canonicalAngle, hour, level, label });
		}
		return marks;
	}

	return { angleOf, arc, pointAt, graduations, trackStart, trackEnd };
}
