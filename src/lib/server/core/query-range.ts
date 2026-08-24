/**
 * The `from`/`to` range every ranged GET route (`/api/sessions`, `/api/activities`,
 * `/api/days`, `/api/coverage`) shares: default to the current `Logical_Day` when
 * absent, and reject a span over `MAX_RANGE_DAYS` `Logical_Day` values with
 * `RANGE_TOO_LARGE` (Requirements 2.4, 7.5, 8.10, 9.6).
 */
import type { Interval } from '$lib/contracts/models';
import { MAX_RANGE_DAYS } from '$lib/contracts/constants';
import type { DayResolver } from '../domain/logical-day';
import { apiError } from './errors';

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
	const days = dayResolver.range(from, to).length;
	if (days > MAX_RANGE_DAYS) {
		throw apiError('RANGE_TOO_LARGE', 'That range is too large.', {
			maxDays: MAX_RANGE_DAYS,
			requestedDays: days
		});
	}
	return { start: from, end: to };
}
