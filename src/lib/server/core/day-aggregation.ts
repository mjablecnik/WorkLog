/**
 * The per-day windows `/api/days` and `/api/days/{date}` both need: the list of
 * `Logical_Day` windows a range spans, and the `Gauge_Window`/`Evening_Hour` instants
 * materialised on each one's calendar dates. Shared so the two routes can never
 * disagree about what a given day's gauge window or evening start is.
 */
import type { Interval } from '$lib/contracts/models';
import type { DayWindow } from '../store/aggregates';
import { createDayResolver, materializeWallClock, type DayResolver } from '../domain/logical-day';
import type { Config } from './config';

/** Every `Logical_Day` window intersecting `[range.start, range.end)`, with its date. */
export function dayWindowsInRange(dayResolver: DayResolver, range: Interval): DayWindow[] {
	return dayResolver
		.range(range.start, range.end)
		.map((window) => ({ date: dayResolver.dateOf(window.start), window }));
}

function parseHHMM(value: string): { hour: number; minute: number } {
	const [hour, minute] = value.split(':').map(Number);
	return { hour, minute };
}

/** The calendar date immediately after `date`, via the day resolver itself (no separate date-math needed). */
function nextCalendarDate(dayResolver: DayResolver, date: string): string {
	return dayResolver.dateOf(dayResolver.bounds(date).end);
}

/**
 * `[GAUGE_START, GAUGE_END)` materialised on `date`'s dates in `timezone`, with the end
 * on the following calendar date when `GAUGE_END <= GAUGE_START` (Requirement 13.13).
 */
export function gaugeWindowFor(
	dayResolver: DayResolver,
	date: string,
	config: Pick<Config, 'gaugeStart' | 'gaugeEnd' | 'timezone'>
): Interval {
	const s = parseHHMM(config.gaugeStart);
	const e = parseHHMM(config.gaugeEnd);
	const start = materializeWallClock(date, s.hour, s.minute, config.timezone);
	const wraps = e.hour * 60 + e.minute <= s.hour * 60 + s.minute;
	const endDate = wraps ? nextCalendarDate(dayResolver, date) : date;
	const end = materializeWallClock(endDate, e.hour, e.minute, config.timezone);
	return { start, end };
}

/**
 * The first occurrence of `EVENING_HOUR` at or after `date`'s `Logical_Day` start
 * (Requirement: "the Evening_Hour instant of a day is the first occurrence of that
 * wall-clock hour at or after the day's start") — on the following calendar date when
 * `EVENING_HOUR` would otherwise fall before `DAY_START_HOUR`.
 */
export function eveningStartFor(
	dayResolver: DayResolver,
	date: string,
	dayBounds: Interval,
	config: Pick<Config, 'eveningHour' | 'timezone'>
): Date {
	const candidate = materializeWallClock(date, config.eveningHour, 0, config.timezone);
	if (candidate.getTime() >= dayBounds.start.getTime()) return candidate;
	const nextDate = nextCalendarDate(dayResolver, date);
	return materializeWallClock(nextDate, config.eveningHour, 0, config.timezone);
}

export function buildDayResolver(config: Pick<Config, 'timezone' | 'dayStartHour'>): DayResolver {
	return createDayResolver(config.timezone, config.dayStartHour);
}
