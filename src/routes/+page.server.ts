/**
 * The timer page's server contact — task 6.7 (design.md "Timer Page"; Requirements
 * 3.1-3.20, 6.12-6.18). Lives at the root path (Requirement 3.4's "opening the
 * application lands on the timer").
 *
 * `load` mirrors `src/routes/day/[date]/+page.server.ts` (task 3.7) almost exactly —
 * same store calls, in the same order, through the same `day-aggregation.ts` helpers
 * — but pinned to `locals.today.date`/`locals.today.bounds` rather than a `[date]`
 * route param, and without that file's own-day/other-day `Quick_Log` branch (this
 * page's Logical_Day is *always* the current one, so `end` is always `now`). Also
 * loads `projects`/`recentEntry`, exactly as the day page does, so this page's own
 * `ActivityDialog` (opened from `QuickLog`'s "open the dialog instead" affordance —
 * Requirements 6.13, 6.18) needs no second round trip either.
 *
 * `currentSession` is recomputed here from THIS load's own `sessions` list rather
 * than trusted from the inherited root-layout value (`+layout.server.ts` reads it in
 * a separate, earlier transaction): returning it under the same key overrides the
 * inherited one in the merged `PageData` object, so the hero readout, the gauge arcs
 * and the day totals are all guaranteed to come from one consistent read rather than
 * two transactions a session-start could land between.
 *
 * Every write here is a real, non-preview commit (`dryRun: false`) — there is no
 * `Change_Preview` step for starting, stopping or one-touch logging (design.md's
 * architecture table: `Quick_Log` posts directly; `start`/`stop` are the one-obvious-
 * action controls Requirement 3.1/3.2 describe, not editing forms).
 */
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import type {
	CurrentSessionResponse,
	DayResponse,
	SessionChangePreview,
	SessionWriteResponse
} from '$lib/contracts/responses';
import type { Interval, Project, WorkSession } from '$lib/contracts/models';
import { startSessionSchema, stopSessionSchema, createActivitySchema } from '$lib/contracts/schemas';
import { getConfig, FUTURE_TOLERANCE_SECONDS } from '$lib/server/core/config';
import { ApiError, assertNotTooFarInFuture, messageKeyFor } from '$lib/server/core/errors';
import {
	buildDayResolver,
	eveningStartFor,
	gaugeWindowFor
} from '$lib/server/services/day-aggregation';
import { NoPlacementAnchorError, resolveAnchor } from '$lib/server/domain/clipping';
import { startSession, stopSession } from '$lib/server/services/sessions';
import { createActivity } from '$lib/server/services/activities';
import {
	createActivityAction,
	patchActivityAction,
	deleteActivityAction
} from '$lib/server/services/activity-form-actions';
import { withReadTx } from '$lib/server/store/tx';
import { daySummaries, coverageForRange } from '$lib/server/store/aggregates';
import { listSessionsOverlapping, trackedIntervals } from '$lib/server/store/work-sessions';
import { coveredIntervals, entriesOverlapping, mostRecentEntry } from '$lib/server/store/activities';
import { listProjects } from '$lib/server/store/projects';
import { offlineRedirectOrRethrow } from '$lib/server/services/offline-redirect';

export type TimerPageData = DayResponse & {
	projects: Project[];
	/** Requirement 6.9's default source — null when the day holds no entry at all. */
	recentEntry: { projectId: string; description: string } | null;
	/** See the module doc's "Also loads…" paragraph — recomputed from THIS load's
	 * own `sessions`, overriding the root layout's inherited value. */
	currentSession: CurrentSessionResponse;
	/** Same reasoning as `day/[date]/+page.server.ts`'s own `now` field — computed
	 * once here so `DayGauge`'s `now` prop never disagrees with what the server just
	 * rendered. */
	now: Date;
};

async function loadTimerData(date: string, bounds: Interval): Promise<TimerPageData> {
	const config = getConfig();
	const dayResolver = buildDayResolver(config);
	const now = new Date();

	const gaugeWindow = gaugeWindowFor(dayResolver, date, config);
	const eveningStart = eveningStartFor(dayResolver, date, bounds, config);

	return withReadTx(async (tx) => {
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

		// This page's Logical_Day is always the current one, so the Quick_Log window
		// always ends at `now` — unlike day/[date]'s load, there is no "a day in the
		// past ends at its last session" branch to consider here.
		let quickLog: DayResponse['quickLog'] = null;
		try {
			const start = resolveAnchor(null, daySegments, daySessions, date);
			if (start.getTime() < now.getTime()) {
				const source: 'last-segment' | 'first-session' =
					daySegments.length > 0 ? 'last-segment' : 'first-session';
				const dayLastEntry = entries[entries.length - 1] ?? null;
				const projectSource = dayLastEntry ?? (await mostRecentEntry(tx));
				if (projectSource !== null) {
					quickLog = {
						start: start.toISOString(),
						end: now.toISOString(),
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

		const openSession = sessions.find((s) => s.endedAt === null) ?? null;
		const currentSession: CurrentSessionResponse = {
			session: openSession,
			elapsedSeconds:
				openSession === null
					? 0
					: Math.round((now.getTime() - openSession.startedAt.getTime()) / 1000),
			stale: openSession?.stale ?? false
		};

		const body: TimerPageData = {
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
			currentSession,
			now
		};
		return body;
	});
}

export const load: PageServerLoad = async ({ locals, url }) => {
	// Requirement 1.14 / design.md's Error Handling table: a transient
	// `SERVICE_UNAVAILABLE` from the store (a dropped connection or a statement
	// timeout mid-request, `tx.ts`'s `translateOrRethrow`) redirects to
	// `/offline?next=<path>` instead of falling through to SvelteKit's generic error
	// boundary — the connection error page task 1.10 already built.
	try {
		return await loadTimerData(locals.today.date, locals.today.bounds);
	} catch (err) {
		offlineRedirectOrRethrow(err, url);
	}
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Every session write here always commits (`dryRun: false`), so the service's
 * `SessionWriteResponse | SessionChangePreview` union is always the first half in
 * practice — `SessionChangePreview` always carries `dryRun: true`, `SessionWriteResponse`
 * never carries a `dryRun` field at all, which is what this narrows on. */
function isSessionWriteResponse(
	result: SessionWriteResponse | SessionChangePreview
): result is SessionWriteResponse {
	return !('dryRun' in result);
}

/** The `CurrentSessionResponse`-equivalent shape `elapsed.svelte.ts`'s `sync()` wants,
 * built from a session write's own result — exactly `/api/sessions/current`'s own
 * computation (`src/routes/api/sessions/current/+server.ts`), so the client needs no
 * extra round trip after a successful start/stop/stopAt (per this task's brief). */
function toCurrentSessionResponse(session: WorkSession | null, now: Date): CurrentSessionResponse {
	return {
		session,
		elapsedSeconds:
			session === null ? 0 : Math.round((now.getTime() - session.startedAt.getTime()) / 1000),
		stale: session?.stale ?? false
	};
}

/** A session-write failure's shared shape: `code` for `+page.svelte`'s own
 * "which session is in the way" interpolation (Requirement 3.17), `messageKey` for
 * anything that only needs the plain catalogue text, `details` carrying whatever the
 * `ApiError` attached (conflicting session bounds, etc). */
function sessionFailure(err: ApiError) {
	return { code: err.code, messageKey: messageKeyFor(err.code), details: err.details };
}

async function runSessionWrite<T extends SessionWriteResponse | SessionChangePreview>(
	now: Date,
	body: () => Promise<T>
) {
	try {
		const result = await body();
		if (!isSessionWriteResponse(result)) {
			// Unreachable in practice — every call site below always passes `dryRun: false`.
			throw new Error('unexpected dry-run result from a non-dry-run session write');
		}
		return {
			current: toCurrentSessionResponse(result.session, now),
			discarded: result.discarded
		};
	} catch (err) {
		if (err instanceof ApiError) {
			return fail(err.status, sessionFailure(err));
		}
		throw err;
	}
}

/** `stopSessionSchema.shape.endedAt` unwrapped to a required field — a stale-stop
 * (Requirement 3.16) always names the instant to stop at; unlike the plain `stop`
 * action, "stop now" is never what this control means. Same `.unwrap()` pattern
 * `src/routes/projects/+page.server.ts` already uses for a row-scoped subset of a
 * shared schema. */
const stopAtSchema = z.object({ endedAt: stopSessionSchema.shape.endedAt.unwrap() }).strict();

const NOTHING_TO_LOG_FLAVORS = new Set([
	'errors_nothing_to_log_empty_interval',
	'errors_nothing_to_log_no_tracked_time',
	'errors_nothing_to_log_already_covered',
	'errors_nothing_to_log_all_slivers'
]);

export const actions: Actions = {
	/** Requirements 3.1, 3.10, 3.13, 3.17. `TimerControl`'s own form when idle — no
	 * fields; the server always starts from `now`. */
	start: async (event) => {
		const formData = await event.request.formData();
		const parsed = startSessionSchema.safeParse({
			startedAt: formData.get('startedAt') || undefined
		});
		if (!parsed.success) return fail(400, { code: 'VALIDATION_ERROR' as const, messageKey: 'errors_validation_error' });

		const now = new Date();
		return runSessionWrite(now, () =>
			startSession({ startedAt: parsed.data.startedAt, dryRun: false, now })
		);
	},

	/** Requirements 3.2, 3.10, 3.13, 15.6. `TimerControl`'s own form when running — no
	 * fields; the server always stops at `now`. A sub-`MIN_INTERVAL_SECONDS` timer is
	 * deleted rather than stored (Requirement 1.18) and answers `discarded: true`,
	 * which `+page.svelte` surfaces as a qualified success rather than a plain one. */
	stop: async () => {
		const now = new Date();
		return runSessionWrite(now, () => stopSession({ dryRun: false, now }));
	},

	/** Requirement 3.16 — the Stale_Session notice's one action. `endedAt` is the
	 * instant the notice's `TimeInput` holds (prefilled with `startedAt +
	 * MAX_OPEN_SESSION_HOURS`, editable), converted to an RFC 3339 instant client-side
	 * before submission (the field itself is a bare `HH:MM`, which `isoOffset` cannot
	 * parse on its own). */
	stopAt: async (event) => {
		const formData = await event.request.formData();
		const parsed = stopAtSchema.safeParse({ endedAt: formData.get('endedAt') });
		if (!parsed.success) return fail(400, { code: 'VALIDATION_ERROR' as const, messageKey: 'errors_validation_error' });

		const now = new Date();
		return runSessionWrite(now, async () => {
			assertNotTooFarInFuture('endedAt', parsed.data.endedAt, now, FUTURE_TOLERANCE_SECONDS);
			return stopSession({ endedAt: parsed.data.endedAt, dryRun: false, now });
		});
	},

	/**
	 * `QuickLog.svelte`'s own documented contract (task 5.8's doc comment, "THE
	 * WRITE" section): read `projectId`/`date` from the submitted form, call the same
	 * write path `POST /api/activities` uses (`createActivity`) with `dryRun: false`
	 * and no interval fields (Open_Mode — the server resolves the interval from the
	 * Placement_Anchor and now), return `{ entry }` on success — exactly the shape
	 * `QuickLog.svelte`'s own `result.data.entry` read already expects — and a
	 * `fail(...)` carrying a `messageKey` on rejection, flavored to
	 * `errors_nothing_to_log_{reason}` when the server named one (Requirement 6.18's
	 * `NOTHING_TO_LOG`/`NO_PLACEMENT_ANCHOR` explanations).
	 */
	quickLog: async (event) => {
		const formData = await event.request.formData();
		const parsed = createActivitySchema.safeParse({
			projectId: formData.get('projectId'),
			date: formData.get('date') || undefined
		});
		if (!parsed.success) {
			return fail(400, { messageKey: 'errors_validation_error' });
		}

		const now = new Date();
		try {
			const result = await createActivity({
				projectId: parsed.data.projectId,
				description: parsed.data.description,
				date: parsed.data.date,
				untrackedPolicy: parsed.data.untrackedPolicy,
				dryRun: false,
				now
			});
			return { entry: result.entry };
		} catch (err) {
			if (err instanceof ApiError) {
				if (err.code === 'NOTHING_TO_LOG') {
					const reason = (err.details as { reason?: string } | undefined)?.reason ?? '';
					const flavored = `errors_nothing_to_log_${reason.replace(/-/g, '_')}`;
					return fail(err.status, {
						messageKey: NOTHING_TO_LOG_FLAVORS.has(flavored) ? flavored : messageKeyFor(err.code),
						details: err.details
					});
				}
				return fail(err.status, { messageKey: messageKeyFor(err.code), details: err.details });
			}
			throw err;
		}
	},

	// `ActivityDialog`'s own three write actions — this page mounts it too
	// (Requirement 6.18's Quick_Log "open the dialog instead" fallback), and a
	// SvelteKit form action resolves relative to whichever route rendered the form.
	// See `$lib/server/services/activity-form-actions.ts`'s doc comment for why this
	// logic is shared rather than duplicated from `day/[date]/+page.server.ts`.
	createActivity: createActivityAction,
	patchActivity: patchActivityAction,
	deleteActivity: deleteActivityAction
};
