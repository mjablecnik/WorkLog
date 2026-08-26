import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { DayResponse } from '$lib/contracts/responses';
import { dayDateParam } from '$lib/contracts/schemas';
import { getConfig } from '$lib/server/core/config';
import { errorResponse, parseRequest } from '$lib/server/core/errors';
import {
	buildDayResolver,
	eveningStartFor,
	gaugeWindowFor
} from '$lib/server/services/day-aggregation';
import { NoPlacementAnchorError, resolveAnchor } from '$lib/server/domain/clipping';
import { withReadTx } from '$lib/server/store/tx';
import { daySummaries, coverageForRange } from '$lib/server/store/aggregates';
import { listSessionsOverlapping, trackedIntervals } from '$lib/server/store/work-sessions';
import {
	coveredIntervals,
	entriesOverlapping,
	mostRecentWorkEntry
} from '$lib/server/store/activities';

/** GET /api/days/{date} — Requirements 8.1-8.9, 8.24-8.27, 15.2-15.4 (`quickLog`). */
export const GET: RequestHandler = async (event) => {
	try {
		const date = parseRequest(dayDateParam, event.params.date);
		const config = getConfig();
		const dayResolver = buildDayResolver(config);
		const now = new Date();
		const bounds = dayResolver.bounds(date);
		const isToday = date === dayResolver.dateOf(now);

		const gaugeWindow = gaugeWindowFor(dayResolver, date, config);
		const eveningStart = eveningStartFor(dayResolver, date, bounds, config);

		const response = await withReadTx(async (tx) => {
			const [sessions, entries, coverage, [summary]] = await Promise.all([
				listSessionsOverlapping(tx, bounds),
				entriesOverlapping(tx, bounds),
				coverageForRange(tx, bounds, now, 0),
				daySummaries(tx, [{ date, window: bounds }], {
					gaugeWindows: [gaugeWindow],
					eveningStarts: [eveningStart],
					now
				})
			]);

			const daySegments = await coveredIntervals(tx, bounds);
			const daySessions = await trackedIntervals(tx, [bounds], now);

			let quickLog: DayResponse['quickLog'] = null;
			try {
				const start = resolveAnchor(null, daySegments, daySessions, date);
				const end = isToday ? now : lastSessionEndWithin(daySessions, bounds, now);
				if (start.getTime() < end.getTime()) {
					const source: 'last-segment' | 'first-session' =
						daySegments.length > 0 ? 'last-segment' : 'first-session';
					// Quick_Log requires a Project and a Leisure_Entry has none — this
					// exclusion governs the Project resolution only; the anchor above
					// already consulted `coveredIntervals` unfiltered, so the offered
					// interval never overlaps a Leisure_Entry (Requirement 6.6).
					const workEntries = entries.filter((e) => e.projectId !== null);
					const dayLastEntry = workEntries[workEntries.length - 1] ?? null;
					const projectSource = dayLastEntry ?? (await mostRecentWorkEntry(tx));
					if (projectSource !== null) {
						quickLog = {
							start: start.toISOString(),
							end: end.toISOString(),
							anchorSource: source,
							projectId: projectSource.projectId as string,
							projectName: projectSource.projectName as string,
							colorIndex: projectSource.colorIndex as number
						};
					}
				}
			} catch (err) {
				if (!(err instanceof NoPlacementAnchorError)) throw err;
			}

			const body: DayResponse = {
				date,
				bounds,
				sessions,
				entries,
				coverage,
				totals: {
					trackedSeconds: summary.trackedSeconds,
					coveredSeconds: summary.coveredSeconds,
					uncoveredSeconds: summary.uncoveredSeconds,
					paidSeconds: summary.paidSeconds,
					unpaidSeconds: summary.unpaidSeconds,
					relaxSeconds: summary.relaxSeconds,
					byProject: summary.byProject,
					sessionCount: summary.sessionCount,
					longestBlockSeconds: summary.longestBlockSeconds,
					eveningSeconds: summary.eveningSeconds
				},
				quickLog
			};
			return body;
		});

		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

function lastSessionEndWithin(
	sessions: { start: Date; end: Date }[],
	dayBounds: { start: Date; end: Date },
	now: Date
): Date {
	if (sessions.length === 0) return dayBounds.start;
	const last = sessions.reduce((latest, s) =>
		s.end.getTime() > latest.end.getTime() ? s : latest
	);
	const end = last.end.getTime() < now.getTime() ? last.end : now;
	return end.getTime() < dayBounds.end.getTime() ? end : dayBounds.end;
}
