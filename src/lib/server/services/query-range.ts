/**
 * The `from`/`to` range every ranged GET route (`/api/sessions`, `/api/activities`,
 * `/api/days`, `/api/coverage`) shares: default to the current `Logical_Day` when
 * absent, and reject a span over `MAX_RANGE_DAYS` `Logical_Day` values with
 * `RANGE_TOO_LARGE` (Requirements 2.4, 7.5, 8.10, 9.6).
 */
import type { Interval } from '$lib/contracts/models';
import { MAX_RANGE_DAYS } from '$lib/contracts/constants';
import type { DayResolver } from '../domain/logical-day';
import { apiError } from '../core/errors';

/** A Logical_Day never runs longer than 25 hours (the longest a DST fold can make it). */
const MAX_LOGICAL_DAY_MS = 25 * 3_600_000;

export function resolveQueryRange(
	dayResolver: DayResolver,
	now: Date,
	from: Date | undefined,
	to: Date | undefined
): Interval {
	if (from === undefined || to === undefined) {
		const date = dayResolver.dateOf(now);
		return dayResolver.bounds(date);
	}
	if (from.getTime() >= to.getTime()) {
		throw apiError('INVALID_INTERVAL', 'The interval is invalid.', {
			start: from.toISOString(),
			end: to.toISOString()
		});
	}

	// A cheap lower bound first: no Logical_Day is longer than MAX_LOGICAL_DAY_MS, so
	// covering the requested span needs at least this many of them. When that alone
	// already exceeds MAX_RANGE_DAYS, reject without materialising every day's bounds —
	// `dayResolver.range()` walks day by day, each one a DST-aware calculation, and a
	// multi-year span would otherwise force thousands of them just to be refused.
	const spanMs = to.getTime() - from.getTime();
	const lowerBoundDays = Math.floor(spanMs / MAX_LOGICAL_DAY_MS);
	if (lowerBoundDays > MAX_RANGE_DAYS) {
		throw apiError('RANGE_TOO_LARGE', 'That range is too large.', {
			maxDays: MAX_RANGE_DAYS,
			requestedDays: lowerBoundDays
		});
	}

	const days = dayResolver.range(from, to).length;
	if (days > MAX_RANGE_DAYS) {
		throw apiError('RANGE_TOO_LARGE', 'That range is too large.', {
			maxDays: MAX_RANGE_DAYS,
			requestedDays: days
		});
	}
	return { start: from, end: to };
}
