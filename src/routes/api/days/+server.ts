import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { DaysRangeResponse } from '$lib/contracts/responses';
import { daysQuery } from '$lib/contracts/schemas';
import { getConfig, MAX_INTERVAL_RANGE_DAYS } from '$lib/server/core/config';
import { errorResponse, parseRequest } from '$lib/server/core/errors';
import {
	buildDayResolver,
	dayWindowsInRange,
	eveningStartFor,
	gaugeWindowFor
} from '$lib/server/core/day-aggregation';
import { resolveQueryRange } from '$lib/server/core/query-range';
import { withReadTx } from '$lib/server/store/tx';
import { daySummaries, dayIntervals, suggestedWindow } from '$lib/server/store/aggregates';

/** GET /api/days — Requirements 8.1-8.27, 9.x day totals, opt-in intervals. */
export const GET: RequestHandler = async (event) => {
	try {
		const query = parseRequest(daysQuery, Object.fromEntries(event.url.searchParams));
		const config = getConfig();
		const dayResolver = buildDayResolver(config);
		const now = new Date();
		const range = resolveQueryRange(dayResolver, now, query.from, query.to);
		const days = dayWindowsInRange(dayResolver, range);

		const gaugeWindows = days.map((d) => gaugeWindowFor(dayResolver, d.date, config));
		const eveningStarts = days.map((d) => eveningStartFor(dayResolver, d.date, d.window, config));

		const wantsIntervals = query.include === 'intervals' && days.length <= MAX_INTERVAL_RANGE_DAYS;

		const response = await withReadTx(async (tx) => {
			const summaries = await daySummaries(tx, days, { gaugeWindows, eveningStarts, now });
			const suggested = await suggestedWindow(tx, days, now);

			if (!wantsIntervals) {
				const body: DaysRangeResponse = {
					days: summaries,
					suggestedWindow: suggested,
					intervalsIncluded: false
				};
				return body;
			}

			const { tracked, covered, uncovered } = await dayIntervals(tx, days, now);
			const body: DaysRangeResponse = {
				days: summaries.map((s, i) => ({
					...s,
					tracked: tracked[i],
					covered: covered[i],
					uncovered: uncovered[i]
				})),
				suggestedWindow: suggested,
				intervalsIncluded: true
			};
			return body;
		});

		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
