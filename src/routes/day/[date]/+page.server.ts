/**
 * The day page's load — task 3.7 (design.md "Day Page, Desktop"/"Day Page, Mobile";
 * Requirements 5.1-5.6). Reads the store directly, exactly as
 * `src/routes/api/days/[date]/+server.ts`'s `GET` handler does (design.md's "Read and
 * Write Paths": a load function calls the store, it never `fetch`s its own `/api`
 * route) — that route has no single exported "load one day" function to call, so this
 * composes the same store calls in the same order, sharing the smaller helpers
 * (`buildDayResolver`/`gaugeWindowFor`/`eveningStartFor`) `day-aggregation.ts` already
 * exports for exactly this purpose. `stats/+page.server.ts` (task 8.1) follows the
 * identical pattern against the same route family, so this is not a new convention.
 *
 * Also loads the active `Project` list (for `ActivityDialog`'s `Project_Picker`,
 * task 5.4) and `recentEntry` (Requirement 6.9: the dialog's create-mode default,
 * "the most recent Activity_Entry of the displayed day" — the last element of
 * `entries`, since `entriesOverlapping` orders ascending by
 * `(requestedStartedAt, createdAt, id)`), so the page component that opens the dialog
 * never has to compute either itself.
 *
 * Returns the `DayResponse` shape (`$lib/contracts/responses.ts`) verbatim plus those
 * two additions. No wire (de)serialization happens anywhere in this path — the store
 * functions already return real `Date` objects, and SvelteKit's own `devalue`
 * transport (not this project's `json()` helper) carries `Date` instances to the
 * client natively, so nothing here revives strings.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { DayResponse } from '$lib/contracts/responses';
import type { Project } from '$lib/contracts/models';
import { dayDateParam } from '$lib/contracts/schemas';
import { getConfig } from '$lib/server/core/config';
import {
	buildDayResolver,
	eveningStartFor,
	gaugeWindowFor
} from '$lib/server/services/day-aggregation';
import { NoPlacementAnchorError, resolveAnchor } from '$lib/server/domain/clipping';
import { withReadTx } from '$lib/server/store/tx';
import { daySummaries, coverageForRange } from '$lib/server/store/aggregates';
import { listSessionsOverlapping, trackedIntervals } from '$lib/server/store/work-sessions';
import { coveredIntervals, entriesOverlapping, mostRecentEntry } from '$lib/server/store/activities';
import { listProjects } from '$lib/server/store/projects';

export type DayPageData = DayResponse & {
	projects: Project[];
	/** Requirement 6.9's default source — null when the day holds no entry at all. */
	recentEntry: { projectId: string; description: string } | null;
	/**
	 * The instant this load ran, for `DayTimeline`'s `now` prop (running/capped block
	 * state). Computed once here rather than freshly in `+page.svelte` — a client-side
	 * `new Date()` there would disagree with what the server just rendered and risk a
	 * hydration mismatch; SvelteKit's `devalue` transport carries a `Date` to the
	 * client natively, same as every other timestamp on this page.
	 */
	now: Date;
};

/** Mirrors `/api/days/[date]/+server.ts`'s private helper of the same name exactly —
 * duplicated rather than imported because it is route-local, unexported logic there,
 * not a shared service function. */
function lastSessionEndWithin(
	sessions: { start: Date; end: Date }[],
	dayBounds: { start: Date; end: Date },
	now: Date
): Date {
	if (sessions.length === 0) return dayBounds.start;
	const last = sessions.reduce((latest, s) => (s.end.getTime() > latest.end.getTime() ? s : latest));
	const end = last.end.getTime() < now.getTime() ? last.end : now;
	return end.getTime() < dayBounds.end.getTime() ? end : dayBounds.end;
}

export const load: PageServerLoad = async ({ params }) => {
	// Requirement 5.5: an invalid YYYY-MM-DD in the URL shows the error page. The same
	// `dateString` schema `/api/days/{date}` validates against (`dayDateParam`), but
	// via `safeParse` directly rather than `parseRequest` — that helper throws the
	// REST layer's `ApiError`/JSON shape, which has no place in a page `load`.
	const parsed = dayDateParam.safeParse(params.date);
	if (!parsed.success) error(404, 'Not found');
	const date = parsed.data;

	const config = getConfig();
	const dayResolver = buildDayResolver(config);
	const now = new Date();
	const bounds = dayResolver.bounds(date);
	const isToday = date === dayResolver.dateOf(now);

	const gaugeWindow = gaugeWindowFor(dayResolver, date, config);
	const eveningStart = eveningStartFor(dayResolver, date, bounds, config);

	const data = await withReadTx(async (tx) => {
		const [sessions, entries, coverage, [summary], projects] = await Promise.all([
			listSessionsOverlapping(tx, bounds),
			entriesOverlapping(tx, bounds),
			coverageForRange(tx, bounds, now, 0),
			daySummaries(tx, [{ date, window: bounds }], {
				gaugeWindows: [gaugeWindow],
				eveningStarts: [eveningStart],
				now
			}),
			listProjects(tx, false)
		]);

		const daySegments = await coveredIntervals(tx, bounds);
		const daySessions = await trackedIntervals(tx, [bounds], now);

		let quickLog: DayResponse['quickLog'] = null;
		try {
			const start = resolveAnchor(null, daySegments, daySessions, date);
			const end = isToday ? now : lastSessionEndWithin(daySessions, bounds, now);
			if (start.getTime() < end.getTime()) {
				const source: 'last-segment' | 'first-session' = daySegments.length > 0 ? 'last-segment' : 'first-session';
				const dayLastEntry = entries[entries.length - 1] ?? null;
				const projectSource = dayLastEntry ?? (await mostRecentEntry(tx));
				if (projectSource !== null) {
					quickLog = {
						start: start.toISOString(),
						end: end.toISOString(),
						anchorSource: source,
						projectId: projectSource.projectId,
						projectName: projectSource.projectName,
						colorIndex: projectSource.colorIndex
					};
				}
			}
		} catch (err) {
			if (!(err instanceof NoPlacementAnchorError)) throw err;
		}

		const dayLastEntry = entries[entries.length - 1] ?? null;
		const recentEntry =
			dayLastEntry === null
				? null
				: { projectId: dayLastEntry.projectId, description: dayLastEntry.description };

		const body: DayPageData = {
			date,
			bounds,
			sessions,
			entries,
			coverage,
			totals: {
				trackedSeconds: summary.trackedSeconds,
				coveredSeconds: summary.coveredSeconds,
				uncoveredSeconds: summary.uncoveredSeconds,
				byProject: summary.byProject,
				sessionCount: summary.sessionCount,
				longestBlockSeconds: summary.longestBlockSeconds,
				eveningSeconds: summary.eveningSeconds
			},
			quickLog,
			projects,
			recentEntry,
			now
		};
		return body;
	});

	return data;
};
