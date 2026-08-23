/**
 * Converts between calendar dates and the Logical_Day windows they denote. A
 * Logical_Day runs from `startHour` on one calendar date to `startHour` on the next,
 * evaluated in `timezone`, and is not always 24 hours — a DST transition can make it
 * 23 or 25.
 *
 * This module imports nothing from the project but the `Interval` type, no Drizzle
 * and no SvelteKit runtime — enforced by `tests/lib/server/imports.test.ts`. It uses
 * `Intl` (standard library) rather than `@date-fns/tz` for the offset arithmetic,
 * because the same from-scratch, independently-verified technique this project
 * already uses in `core/config.ts` for the startup checks is what this module needs
 * too, and the two must never be able to disagree about what a transition is.
 */
import type { Interval } from '$lib/contracts/models';

const DAY_MS = 24 * 60 * 60_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): { y: number; m: number; d: number } {
	const m = DATE_RE.exec(date);
	if (!m) throw new RangeError(`invalid Logical_Day date: ${JSON.stringify(date)}`);
	return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

function formatDate(y: number, m: number, d: number): string {
	const naive = new Date(Date.UTC(y, m, d));
	const yy = naive.getUTCFullYear().toString().padStart(4, '0');
	const mm = (naive.getUTCMonth() + 1).toString().padStart(2, '0');
	const dd = naive.getUTCDate().toString().padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

/** The calendar date `days` after (or before, if negative) `date`. Pure calendar math. */
function addDays(date: string, days: number): string {
	const { y, m, d } = parseDate(date);
	const shifted = new Date(Date.UTC(y, m, d) + days * DAY_MS);
	return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

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
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
	const hour = get('hour') % 24;
	const asNaiveUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		hour,
		get('minute'),
		get('second')
	);
	// Rounded to the nearest minute for the same reason as core/config.ts: `formatToParts`
	// truncates sub-second components that an arbitrary probed instant still carries.
	return Math.round((asNaiveUtc - instantMs) / 60_000);
}

type NearbyTransition = {
	kind: 'gap' | 'fold';
	/** Naive local wall-clock bounds (half-open), as Date.UTC-style milliseconds. */
	localStartMs: number;
	localEndMs: number;
	/** Offset (minutes) in effect just before / after the transition. */
	beforeOffset: number;
	afterOffset: number;
};

/**
 * Finds the single DST-style transition (if any) within a few days of `naiveUtcMs`.
 * Real timezones change offset at most a handful of times a year and each change
 * affects only an hour or two of wall-clock time, so a narrow window is enough to
 * catch the one transition that could possibly matter to a single wall-clock instant,
 * without re-scanning a whole year on every call.
 */
function findNearbyTransition(naiveUtcMs: number, timeZone: string): NearbyTransition | null {
	const WINDOW_MS = 3 * DAY_MS;
	const loInstant = naiveUtcMs - WINDOW_MS;
	const hiInstant = naiveUtcMs + WINDOW_MS;
	const loOffset = offsetMinutesAt(loInstant, timeZone);
	const hiOffset = offsetMinutesAt(hiInstant, timeZone);
	if (loOffset === hiOffset) return null;

	let lo = loInstant;
	let hi = hiInstant;
	while (hi - lo > 1_000) {
		const mid = Math.floor((lo + hi) / 2);
		const midOffset = offsetMinutesAt(mid, timeZone);
		if (midOffset === loOffset) lo = mid;
		else hi = mid;
	}
	const roundedHi = Math.round(hi / 60_000) * 60_000;
	const localAtLo = roundedHi + loOffset * 60_000;
	const localAtHi = roundedHi + hiOffset * 60_000;
	return {
		kind: hiOffset > loOffset ? 'gap' : 'fold',
		localStartMs: Math.min(localAtLo, localAtHi),
		localEndMs: Math.max(localAtLo, localAtHi),
		beforeOffset: loOffset,
		afterOffset: hiOffset
	};
}

/**
 * Converts a wall-clock reading in `timeZone` to the instant it denotes, applying the
 * fold policy of Requirement 10.14: an ambiguous time (fold) takes the EARLIER
 * offset — the first of its two real occurrences; a non-existent time (gap) moves
 * FORWARD to the first instant that exists.
 */
function wallClockToInstant(
	y: number,
	m: number,
	d: number,
	hour: number,
	timeZone: string,
	minute = 0
): Date {
	const naiveUtcMs = Date.UTC(y, m, d, hour, minute, 0);
	const transition = findNearbyTransition(naiveUtcMs, timeZone);
	if (transition === null) {
		const offset = offsetMinutesAt(naiveUtcMs, timeZone);
		return new Date(naiveUtcMs - offset * 60_000);
	}
	if (naiveUtcMs < transition.localStartMs) {
		return new Date(naiveUtcMs - transition.beforeOffset * 60_000);
	}
	if (naiveUtcMs >= transition.localEndMs) {
		return new Date(naiveUtcMs - transition.afterOffset * 60_000);
	}
	// Inside the affected range.
	if (transition.kind === 'fold') {
		return new Date(naiveUtcMs - transition.beforeOffset * 60_000);
	}
	// Gap: move forward to the first instant that exists — the transition's own end,
	// which by construction is an ordinary (non-ambiguous, non-empty) wall-clock reading.
	return new Date(transition.localEndMs - transition.afterOffset * 60_000);
}

/** True when `hour:00` on some date fails to exist or is ambiguous in `timeZone`. */
function hourIsUnsafeSomewhere(
	hour: number,
	timeZone: string,
	fromYear: number,
	years: number
): boolean {
	// Scan year by year (day-granularity, then binary search within the day it changes on)
	// exactly as core/config.ts does — this only runs once, at resolver construction.
	let prevOffset = offsetMinutesAt(Date.UTC(fromYear, 0, 1), timeZone);
	let prevInstant = Date.UTC(fromYear, 0, 1);
	const endInstant = Date.UTC(fromYear + years, 0, 1);
	for (let t = prevInstant + DAY_MS; t <= endInstant; t += DAY_MS) {
		const offset = offsetMinutesAt(t, timeZone);
		if (offset !== prevOffset) {
			let lo = prevInstant;
			let hi = t;
			const loOffset = prevOffset;
			while (hi - lo > 1_000) {
				const mid = Math.floor((lo + hi) / 2);
				if (offsetMinutesAt(mid, timeZone) === loOffset) lo = mid;
				else hi = mid;
			}
			const roundedHi = Math.round(hi / 60_000) * 60_000;
			const localAtLo = roundedHi + loOffset * 60_000;
			const localAtHi = roundedHi + offset * 60_000;
			const localStartMs = Math.min(localAtLo, localAtHi);
			const localEndMs = Math.max(localAtLo, localAtHi);
			const d = new Date(localStartMs);
			const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0);
			if (candidate >= localStartMs && candidate < localEndMs) return true;
		}
		prevOffset = offset;
	}
	return false;
}

export type DayResolver = {
	/** Window of the Logical_Day named by a "YYYY-MM-DD" string. */
	bounds(date: string): Interval;
	/** Name of the Logical_Day containing `t`; instants before startHour belong to the previous date. */
	dateOf(t: Date): string;
	/**
	 * One window per Logical_Day whose bounds intersect the half-open instant range
	 * `[from, to)` — Requirement 10.15. `from >= to` yields an empty array.
	 */
	range(from: Date, to: Date): Interval[];
};

/**
 * Throws when `timezone` is not loadable, when `startHour` is outside 0..23, or when
 * the hour it names fails to exist or is ambiguous on some date in that zone
 * (Requirement 10.13).
 */
export function createDayResolver(timezone: string, startHour: number): DayResolver {
	if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
		throw new RangeError(`startHour must be an integer between 0 and 23, got ${startHour}`);
	}
	try {
		new Intl.DateTimeFormat(undefined, { timeZone: timezone });
	} catch {
		throw new RangeError(`timezone ${JSON.stringify(timezone)} is not loadable`);
	}
	const nowYear = new Date().getUTCFullYear();
	if (hourIsUnsafeSomewhere(startHour, timezone, nowYear - 2, 6)) {
		throw new RangeError(
			`startHour ${startHour} names an hour that does not exist or is ambiguous in ${timezone}`
		);
	}

	function bounds(date: string): Interval {
		const { y, m, d } = parseDate(date);
		const start = wallClockToInstant(y, m, d, startHour, timezone);
		const nextDate = addDays(date, 1);
		const { y: ny, m: nm, d: nd } = parseDate(nextDate);
		const end = wallClockToInstant(ny, nm, nd, startHour, timezone);
		return { start, end };
	}

	function dateOf(t: Date): string {
		const dtf = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit'
		});
		const parts = dtf.formatToParts(t);
		const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
		const y = get('year');
		const m = get('month') - 1;
		const d = get('day');
		const hour = get('hour') % 24;
		const today = formatDate(y, m, d);
		return hour < startHour ? addDays(today, -1) : today;
	}

	function range(from: Date, to: Date): Interval[] {
		if (from.getTime() >= to.getTime()) return [];
		const out: Interval[] = [];
		let date = dateOf(from);
		let window = bounds(date);
		while (window.start.getTime() < to.getTime()) {
			if (window.end.getTime() > from.getTime()) out.push(window);
			date = addDays(date, 1);
			window = bounds(date);
		}
		return out;
	}

	return { bounds, dateOf, range };
}

/**
 * The instant `HH:MM` denotes on `date` in `timezone`, applying the same fold policy
 * as `DayResolver` (Requirement 10.14). Used to materialise the Gauge_Window and the
 * Evening_Hour on a specific Logical_Day's calendar date — the same wall-clock-to-
 * instant machinery `bounds()` uses for the day boundary itself, so the two can never
 * disagree about what a given clock reading means on a given date.
 */
export function materializeWallClock(
	date: string,
	hour: number,
	minute: number,
	timezone: string
): Date {
	const { y, m, d } = parseDate(date);
	return wallClockToInstant(y, m, d, hour, timezone, minute);
}

/** The wall-clock minute of the day (0..1439) `t` falls on in `timezone`. */
export function minuteOfDay(t: Date, timezone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hourCycle: 'h23',
		hour: '2-digit',
		minute: '2-digit'
	});
	const parts = dtf.formatToParts(t);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
	return (get('hour') % 24) * 60 + get('minute');
}
