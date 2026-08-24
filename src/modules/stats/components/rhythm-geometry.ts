/**
 * Pure geometry for `DayRhythm`'s linear day-strip mapping (Requirement 12.6, 12.7;
 * tasks.md 8.3). A `Logical_Day`'s x-axis spans `dayStartHour` (as a fraction through
 * the day, wrapping at midnight) to `dayStartHour` the *following* day — a full 24-hour
 * span starting at `dayStartHour`, never a hard-coded `03:00`/`08:00`.
 *
 * This is deliberately NOT `../../timer/components/gauge-geometry.ts`'s `angleOf`: that
 * is a 360° circular mapping with a 45° rotation offset for the `Day_Gauge`'s dial. This
 * module is a plain 0-100% *linear* mapping with a `dayStartHour` offset for a
 * horizontal strip, and the two must not be confused or share an import — so, exactly
 * like `gauge-geometry.ts`'s own header explains for its relationship with
 * `src/lib/viz/format.ts`, this module keeps its own small, independently-reviewed copy
 * of `offsetMinutesAt`/`minutesSinceMidnight` rather than importing either sibling.
 */

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

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
	const asNaiveUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
	return Math.round((asNaiveUtc - instantMs) / MS_PER_MINUTE);
}

/** `n mod m`, always in `[0, m)` — `%` alone returns a negative result for negative `n`. */
function euclideanMod(n: number, m: number): number {
	return ((n % m) + m) % m;
}

/** Minutes since local midnight in `timeZone`, with sub-minute precision. */
function minutesSinceMidnight(t: Date, timeZone: string): number {
	const instantMs = t.getTime();
	const offset = offsetMinutesAt(instantMs, timeZone);
	const localMs = instantMs + offset * MS_PER_MINUTE;
	return euclideanMod(localMs, MINUTES_PER_DAY * MS_PER_MINUTE) / MS_PER_MINUTE;
}

/**
 * The horizontal position of instant `t` along the strip, as a 0-100 percentage:
 * `((minutesSinceMidnight(t) - dayStartHour*60 + 1440) % 1440) / 1440 * 100` — the exact
 * formula design.md's mapping describes, wrapping at midnight so the strip's origin is
 * always `dayStartHour`, never a literal hour.
 */
export function positionPercent(t: Date, dayStartHour: number, timeZone: string): number {
	const minutes = minutesSinceMidnight(t, timeZone);
	return (euclideanMod(minutes - dayStartHour * 60, MINUTES_PER_DAY) / MINUTES_PER_DAY) * 100;
}

/**
 * The width, as a 0-100 percentage of the 24-hour strip, spanned by `[start, end)`.
 * Computed from the raw millisecond duration rather than `positionPercent(end) -
 * positionPercent(start)`, so an interval touching the strip's far edge (ending exactly
 * at the next day's `dayStartHour`) never wraps back to a near-zero width — every
 * `covered`/`uncovered` interval the server returns is already clipped to lie within
 * this one `Logical_Day`, so a plain duration-based width is always correct here.
 */
export function widthPercent(start: Date, end: Date): number {
	const minutes = (end.getTime() - start.getTime()) / MS_PER_MINUTE;
	return (minutes / MINUTES_PER_DAY) * 100;
}
