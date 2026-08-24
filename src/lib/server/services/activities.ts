/**
 * The one body of every `Activity_Entry` write: create (Explicit/Duration/Open mode
 * selection), PATCH (meta-only or a full re-clip, including the orphan rescue path),
 * and DELETE. Mode selection, `resolveAnchor`, the fixed `withTx` -> `clip` ->
 * `reclipAffected` order for policy `extend` (Requirement 2.12), `Idempotency-Key`
 * handling, `Preview_Token` verification and the mapping from a domain outcome to
 * `NOTHING_TO_LOG` / `NO_PLACEMENT_ANCHOR` all live here — never in a route.
 */
import type { ActivityEntry, ActivityMode, Interval } from '$lib/contracts/models';
import type { ActivityResponse } from '$lib/contracts/responses';
import { ERROR_DETAIL_SAMPLE_SIZE, FUTURE_TOLERANCE_SECONDS, getConfig } from '../core/config';
import {
	apiError,
	assertNotTooFarInFuture as assertTimestampNotTooFarInFuture
} from '../core/errors';
import { computePreviewToken } from '../core/preview-token';
import { intersect, normalize, subtract, total } from '../domain/interval';
import {
	clip,
	resolveAnchor,
	NoPlacementAnchorError,
	type UntrackedPolicy
} from '../domain/clipping';
import { reclipAffected, type ReclipPorts } from '../domain/reclip';
import { createDayResolver, type DayResolver } from '../domain/logical-day';
import { withTx, type Tx } from '../store/tx';
import * as sessionsStore from '../store/work-sessions';
import * as activitiesStore from '../store/activities';
import * as projectsStore from '../store/projects';
import {
	findIdempotencyRecord,
	recordIdempotencyResponse,
	canonicalRequestHash
} from '../store/idempotency';

/**
 * Bounds of the union of every `Logical_Day` that `[start, end)` touches — the whole
 * span design.md says a `Preview_Token` must fingerprint, not just the day `start`
 * falls in. An interval spanning two Logical_Days left the second day unfingerprinted
 * before this existed, so a change there could not invalidate a stale preview
 * (Requirements 14.7, 14.8).
 */
function spanBounds(dayResolver: DayResolver, start: Date, end: Date): Interval {
	const windows = dayResolver.range(start, end);
	if (windows.length === 0) return dayResolver.bounds(dayResolver.dateOf(start));
	return { start: windows[0].start, end: windows[windows.length - 1].end };
}

function reclipPortsFor(tx: Tx): ReclipPorts {
	return {
		trackedIntervals: (window, now) => sessionsStore.trackedIntervals(tx, window, now),
		entriesAffectedBy: (window) => activitiesStore.entriesAffectedBy(tx, window),
		coveredIntervals: async (window, excludeEntryId) => {
			const parts = await Promise.all(
				window.map((w) => activitiesStore.coveredIntervals(tx, w, excludeEntryId ?? undefined))
			);
			return normalize(parts.flat());
		},
		replaceSegments: (entryId, segments) => activitiesStore.replaceSegments(tx, entryId, segments)
	};
}

async function currentFingerprint(tx: Tx, window: Interval): Promise<string> {
	const sessions = await sessionsStore.listSessionsOverlapping(tx, window);
	const segments = await activitiesStore.segmentsOverlapping(tx, window);
	return computePreviewToken(sessions, segments);
}

function assertFreshPreview(previousToken: string, submittedToken: string | undefined): void {
	if (submittedToken !== undefined && submittedToken !== previousToken) {
		throw apiError('STALE_PREVIEW', 'That preview is no longer valid.', {
			submittedToken,
			currentToken: previousToken
		});
	}
}

async function assertProjectUsable(tx: Tx, projectId: string): Promise<void> {
	const project = await projectsStore.getProject(tx, projectId);
	if (project === null) {
		throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
			fields: { projectId: { reason: 'fields_invalid_id' } }
		});
	}
	if (project.archived) {
		throw apiError('PROJECT_ARCHIVED', 'That project is archived.', {
			projectId: project.id,
			projectName: project.name
		});
	}
}

function assertNotTooFarInFuture(field: 'startedAt' | 'endedAt', value: Date, now: Date): void {
	assertTimestampNotTooFarInFuture(field, value, now, FUTURE_TOLERANCE_SECONDS);
}

type NothingToLogReason = 'empty-interval' | 'no-tracked-time' | 'already-covered' | 'all-slivers';

function nothingToLogError(
	reason: NothingToLogReason,
	anchor: { at: string; source: string } | null,
	requested: { start: string; end: string } | null,
	slivers: Interval[]
): never {
	throw apiError('NOTHING_TO_LOG', 'There is nothing left to log.', {
		reason,
		anchor,
		requested,
		...(reason === 'all-slivers' ? { slivers: slivers.map((s) => toIsoInterval(s)) } : {})
	});
}

async function activityOverlapError(tx: Tx, conflicts: Interval[]): Promise<never> {
	const overlappingEntries = await findEntriesOverlapping(tx, conflicts);
	const withInterval: { entryId: string; interval: Interval }[] = [];
	for (const entry of overlappingEntries) {
		for (const seg of entry.segments) {
			const overlap = intersect([{ start: seg.startedAt, end: seg.endedAt }], conflicts);
			for (const iv of overlap) withInterval.push({ entryId: entry.id, interval: iv });
		}
	}
	const byEntry = new Map(overlappingEntries.map((e) => [e.id, e]));
	const sample = withInterval.slice(0, ERROR_DETAIL_SAMPLE_SIZE).map(({ entryId, interval }) => {
		const entry = byEntry.get(entryId) as ActivityEntry;
		return {
			entryId: entry.id,
			projectName: entry.projectName,
			colorIndex: entry.colorIndex,
			description: entry.description,
			interval: toIsoInterval(interval)
		};
	});
	throw apiError('ACTIVITY_OVERLAP', 'That would overlap another activity.', {
		conflictCount: overlappingEntries.length,
		conflicts: sample
	});
}

type ClipOutcome = ReturnType<typeof clip>;

/** `total(intersect([window], tracked))`, used to classify a NOTHING_TO_LOG reason. */
function trackedOverlapMs(window: Interval, tracked: Interval[]): number {
	return total(intersect([window], tracked));
}

function classifyNothingToLog(
	window: Interval,
	tracked: Interval[],
	result: ClipOutcome
): NothingToLogReason {
	if (trackedOverlapMs(window, tracked) === 0) return 'no-tracked-time';
	if (result.slivers.length > 0) return 'all-slivers';
	return 'already-covered';
}

function toIsoInterval(i: Interval): { start: string; end: string } {
	return { start: i.start.toISOString(), end: i.end.toISOString() };
}

async function findEntriesOverlapping(tx: Tx, windows: Interval[]): Promise<ActivityEntry[]> {
	const results = await Promise.all(windows.map((w) => activitiesStore.entriesOverlapping(tx, w)));
	const byId = new Map<string, ActivityEntry>();
	for (const list of results) for (const e of list) byId.set(e.id, e);
	return [...byId.values()];
}

function lastSessionEndWithin(sessions: Interval[], dayBounds: Interval, now: Date): Date {
	const normalized = normalize(sessions);
	if (normalized.length === 0) return dayBounds.start;
	const last = normalized[normalized.length - 1];
	const end = last.end.getTime() < now.getTime() ? last.end : now;
	return end.getTime() < dayBounds.end.getTime() ? end : dayBounds.end;
}

type AnchorInfo = { at: string; source: 'explicit' | 'last-segment' | 'first-session' };

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export type CreateActivityArgs = {
	projectId: string;
	description: string;
	date?: string;
	startedAt?: Date;
	endedAt?: Date;
	durationMinutes?: number;
	untrackedPolicy: UntrackedPolicy;
	dryRun: boolean;
	previewToken?: string;
	idempotencyKey?: string;
	now: Date;
};

function selectCreateMode(args: CreateActivityArgs): ActivityMode {
	if (args.endedAt !== undefined && args.durationMinutes !== undefined) {
		throw apiError('AMBIGUOUS_MODE', 'The request names more than one way to record this.');
	}
	if (args.endedAt !== undefined) {
		if (args.startedAt === undefined) {
			throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
				fields: { startedAt: { reason: 'fields_required' } }
			});
		}
		return 'explicit';
	}
	if (args.durationMinutes !== undefined) return 'duration';
	return 'open';
}

/** Resolves the placement window (requested interval, or anchor + dayBounds for duration mode). Read-only. */
async function resolveCreateWindow(
	tx: Tx,
	dayResolver: DayResolver,
	mode: ActivityMode,
	args: CreateActivityArgs
): Promise<{
	requested: Interval | null;
	anchorInfo: AnchorInfo | null;
	dayBounds: Interval | null;
}> {
	if (mode === 'explicit') {
		const requested: Interval = { start: args.startedAt as Date, end: args.endedAt as Date };
		if (requested.start.getTime() >= requested.end.getTime()) {
			throw apiError('INVALID_INTERVAL', 'The interval is invalid.', toIsoInterval(requested));
		}
		assertNotTooFarInFuture('startedAt', requested.start, args.now);
		assertNotTooFarInFuture('endedAt', requested.end, args.now);
		return { requested, anchorInfo: null, dayBounds: null };
	}

	const targetDate = args.date ?? dayResolver.dateOf(args.now);
	const dayBounds = dayResolver.bounds(targetDate);
	const isCurrentDay = targetDate === dayResolver.dateOf(args.now);
	if (!isCurrentDay && dayBounds.start.getTime() > args.now.getTime()) {
		throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
			fields: { date: { reason: 'fields_invalid_date' } }
		});
	}

	const daySegments = await activitiesStore.coveredIntervals(tx, dayBounds);
	const daySessions = await sessionsStore.trackedIntervals(tx, [dayBounds], args.now);
	let anchor: Date;
	try {
		anchor = resolveAnchor(args.startedAt ?? null, daySegments, daySessions, targetDate);
	} catch (err) {
		if (err instanceof NoPlacementAnchorError) {
			throw apiError('NO_PLACEMENT_ANCHOR', 'There is nothing to place this against on that day.', {
				date: err.date,
				dayBounds: toIsoInterval(dayBounds)
			});
		}
		throw err;
	}
	const source: 'explicit' | 'last-segment' | 'first-session' =
		args.startedAt !== undefined
			? 'explicit'
			: daySegments.length > 0
				? 'last-segment'
				: 'first-session';
	const anchorInfo: AnchorInfo = { at: anchor.toISOString(), source };

	if (mode === 'open') {
		const end = isCurrentDay ? args.now : lastSessionEndWithin(daySessions, dayBounds, args.now);
		const requested: Interval = { start: anchor, end };
		if (requested.start.getTime() >= requested.end.getTime()) {
			nothingToLogError('empty-interval', anchorInfo, toIsoInterval(requested), []);
		}
		return { requested, anchorInfo, dayBounds };
	}

	// duration: no single "requested" interval yet — the walk resolves it.
	return { requested: null, anchorInfo, dayBounds };
}

/** Shared by create and patch: runs `clip`, and under `extend` the fixed insert -> reclip -> re-clip order (Req 2.12). */
async function clipAndRescue(
	tx: Tx,
	now: Date,
	minIntervalMs: number,
	window: Interval,
	first: ClipOutcome,
	mode: ActivityMode,
	rerunInput: (tracked: Interval[], covered: Interval[]) => ClipOutcome
): Promise<{
	result: ClipOutcome;
	extendedSessions: Awaited<ReturnType<typeof sessionsStore.insertSessions>>;
	removedFromRescueMs: number;
}> {
	if (first.extend.length === 0) {
		return { result: first, extendedSessions: [], removedFromRescueMs: 0 };
	}
	const extendedSessions = await sessionsStore.insertSessions(tx, first.extend);
	const affected = normalize(first.extend);
	const reclipped = await reclipAffected(reclipPortsFor(tx), affected, now, minIntervalMs);
	const removedFromRescueMs = reclipped.reduce((sum, o) => sum + o.removedMs, 0);

	const freshTracked = await sessionsStore.trackedIntervals(tx, [window], now);
	const freshCovered = await activitiesStore.coveredIntervals(tx, window);
	const rerun = rerunInput(freshTracked, freshCovered);

	// A rescued Orphaned_Entry reclaiming part of the newly-extended time is not an
	// error (Requirement 2.12): subtract it from the new segments and report the
	// difference as discarded, rather than raising ACTIVITY_OVERLAP.
	if (mode !== 'duration' && rerun.conflicts.length > 0) {
		const segments = subtract(rerun.segments, rerun.conflicts);
		const discarded = normalize([...rerun.discarded, ...rerun.conflicts]);
		return {
			result: { ...rerun, segments, discarded, extend: first.extend },
			extendedSessions,
			removedFromRescueMs
		};
	}
	return { result: { ...rerun, extend: first.extend }, extendedSessions, removedFromRescueMs };
}

export async function createActivity(
	args: CreateActivityArgs
): Promise<ActivityResponse & { dryRun: boolean }> {
	const config = getConfig();
	const mode = selectCreateMode(args);
	const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
	const minIntervalMs = config.minIntervalSeconds * 1000;

	const run = async (tx: Tx): Promise<ActivityResponse & { dryRun: boolean }> => {
		await assertProjectUsable(tx, args.projectId);

		// A Dry_Run never creates anything, so it neither consults nor claims an
		// Idempotency-Key: a client that previews with a key and then confirms with the
		// same key must reach a genuine first write, not a replay of the preview.
		let canonicalHash: string | null = null;
		if (args.idempotencyKey !== undefined && !args.dryRun) {
			canonicalHash = canonicalRequestHash({
				projectId: args.projectId,
				description: args.description,
				date: args.date ?? null,
				startedAt: args.startedAt?.toISOString() ?? null,
				endedAt: args.endedAt?.toISOString() ?? null,
				durationMinutes: args.durationMinutes ?? null,
				untrackedPolicy: args.untrackedPolicy
			});
			const existing = await findIdempotencyRecord(tx, args.idempotencyKey);
			if (existing !== null) {
				if (existing.requestHash !== canonicalHash) {
					throw apiError(
						'IDEMPOTENCY_KEY_REUSED',
						'That idempotency key was already used for a different request.',
						{ key: args.idempotencyKey }
					);
				}
				return existing.response as ActivityResponse & { dryRun: boolean };
			}
		}

		const { requested, anchorInfo, dayBounds } = await resolveCreateWindow(
			tx,
			dayResolver,
			mode,
			args
		);

		// Fingerprint the pre-write state over the window this write will touch, and
		// verify it against the Preview_Token BEFORE any mutation happens.
		const fingerprintWindow: Interval =
			mode === 'duration'
				? (dayBounds as Interval)
				: spanBounds(dayResolver, (requested as Interval).start, (requested as Interval).end);
		const previousToken = await currentFingerprint(tx, fingerprintWindow);
		assertFreshPreview(previousToken, args.previewToken);

		const window: Interval =
			mode === 'duration' ? (dayBounds as Interval) : (requested as Interval);
		const tracked = await sessionsStore.trackedIntervals(tx, [window], args.now);
		const covered = await activitiesStore.coveredIntervals(tx, window);
		const openSession = await sessionsStore.currentOpenSession(tx);
		const openSessionSpan: Interval | undefined =
			openSession !== null ? { start: openSession.startedAt, end: args.now } : undefined;

		const runClip = (t: Interval[], c: Interval[]): ClipOutcome =>
			mode === 'duration'
				? clip({
						mode: 'duration',
						anchor: new Date(anchorInfo!.at),
						durationMs: (args.durationMinutes as number) * 60_000,
						dayBounds: dayBounds as Interval,
						tracked: t,
						covered: c,
						openSessionSpan,
						policy: args.untrackedPolicy,
						minIntervalMs,
						now: args.now
					})
				: clip({
						mode: mode === 'open' ? 'open' : 'explicit',
						requested: requested as Interval,
						tracked: t,
						covered: c,
						openSessionSpan,
						policy: args.untrackedPolicy,
						minIntervalMs,
						now: args.now
					});

		const first = runClip(tracked, covered);

		if (mode !== 'duration' && args.untrackedPolicy === 'reject' && first.discarded.length > 0) {
			throw apiError('OUTSIDE_TRACKED_TIME', 'That falls outside tracked time.', {
				outside: first.discarded.map((d) => toIsoInterval(d)),
				outsideSeconds: Math.round(total(first.discarded) / 1000)
			});
		}
		if (mode !== 'duration' && first.conflicts.length > 0) {
			await activityOverlapError(tx, first.conflicts);
		}

		const rerunClip = (t: Interval[], c: Interval[]): ClipOutcome =>
			mode === 'duration'
				? clip({
						mode: 'duration',
						anchor: new Date(anchorInfo!.at),
						durationMs: (args.durationMinutes as number) * 60_000,
						dayBounds: dayBounds as Interval,
						tracked: t,
						covered: c,
						policy: 'clip',
						minIntervalMs,
						now: args.now
					})
				: clip({
						mode: mode === 'open' ? 'open' : 'explicit',
						requested: requested as Interval,
						tracked: t,
						covered: c,
						policy: 'clip',
						minIntervalMs,
						now: args.now
					});

		const {
			result: finalResult,
			extendedSessions,
			removedFromRescueMs
		} = args.untrackedPolicy === 'extend'
			? await clipAndRescue(tx, args.now, minIntervalMs, window, first, mode, rerunClip)
			: { result: first, extendedSessions: [], removedFromRescueMs: 0 };

		if (finalResult.segments.length === 0) {
			const reason = classifyNothingToLog(window, tracked, finalResult);
			nothingToLogError(
				reason,
				anchorInfo,
				mode === 'duration' ? null : toIsoInterval(requested as Interval),
				finalResult.slivers
			);
		}

		const requestedInterval: Interval =
			mode === 'duration'
				? {
						start: finalResult.segments[0].start,
						end: finalResult.segments[finalResult.segments.length - 1].end
					}
				: (requested as Interval);

		const entry = await activitiesStore.createEntry(
			tx,
			{
				projectId: args.projectId,
				description: args.description,
				mode,
				requestedStartedAt: requestedInterval.start,
				requestedEndedAt: requestedInterval.end,
				requestedDurationMinutes: mode === 'duration' ? (args.durationMinutes as number) : null
			},
			finalResult.segments
		);

		const previewToken = await currentFingerprint(tx, fingerprintWindow);
		const unplacedMinutes = mode === 'duration' ? Math.ceil(finalResult.unplacedMs / 60_000) : 0;

		const response: ActivityResponse & { dryRun: boolean } = {
			entry,
			discarded: mode === 'duration' ? [] : finalResult.discarded,
			extendedSessions,
			unplacedMinutes,
			removedSeconds: Math.round(removedFromRescueMs / 1000),
			slivers: finalResult.slivers,
			anchor: anchorInfo,
			dryRun: args.dryRun,
			previewToken
		};

		if (args.idempotencyKey !== undefined && canonicalHash !== null) {
			await recordIdempotencyResponse(
				tx,
				args.idempotencyKey,
				entry.id,
				201,
				canonicalHash,
				response
			);
		}

		return response;
	};

	if (!args.dryRun) return withTx((tx) => run(tx));
	return withTx((tx) => run(tx), { dryRun: true });
}

// ---------------------------------------------------------------------------
// patch
// ---------------------------------------------------------------------------

export type PatchActivityArgs = {
	id: string;
	description?: string;
	projectId?: string;
	date?: string;
	startedAt?: Date;
	endedAt?: Date;
	durationMinutes?: number;
	untrackedPolicy?: UntrackedPolicy;
	dryRun: boolean;
	previewToken?: string;
	now: Date;
};

function selectPatchMode(args: PatchActivityArgs): 'meta' | ActivityMode {
	if (args.endedAt !== undefined && args.durationMinutes !== undefined) {
		throw apiError('AMBIGUOUS_MODE', 'The request names more than one way to record this.');
	}
	const hasStart = args.startedAt !== undefined;
	const hasEnd = args.endedAt !== undefined;
	if (hasStart !== hasEnd) {
		throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
			fields: { [hasStart ? 'endedAt' : 'startedAt']: { reason: 'fields_required' } }
		});
	}
	if (hasStart && hasEnd) return 'explicit';
	if (args.durationMinutes !== undefined) {
		if (args.date === undefined) {
			throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
				fields: { date: { reason: 'fields_required' } }
			});
		}
		return 'duration';
	}
	return 'meta';
}

export async function patchActivity(
	args: PatchActivityArgs
): Promise<ActivityResponse & { dryRun: boolean }> {
	const config = getConfig();
	const kind = selectPatchMode(args);
	const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
	const minIntervalMs = config.minIntervalSeconds * 1000;

	const run = async (tx: Tx): Promise<ActivityResponse & { dryRun: boolean }> => {
		const existing = await activitiesStore.getEntry(tx, args.id);
		if (existing === null) {
			throw apiError('NOT_FOUND', 'That record could not be found.', {
				resource: 'activity',
				id: args.id
			});
		}
		if (args.projectId !== undefined) await assertProjectUsable(tx, args.projectId);

		if (kind === 'meta') {
			const fingerprintWindow = spanBounds(
				dayResolver,
				existing.requestedStartedAt,
				existing.requestedEndedAt
			);
			const previousToken = await currentFingerprint(tx, fingerprintWindow);
			assertFreshPreview(previousToken, args.previewToken);

			const updated = await activitiesStore.updateEntryMeta(tx, args.id, {
				description: args.description,
				projectId: args.projectId
			});
			const previewToken = await currentFingerprint(tx, fingerprintWindow);
			return {
				entry: updated,
				discarded: [],
				extendedSessions: [],
				unplacedMinutes: 0,
				removedSeconds: 0,
				slivers: [],
				anchor: null,
				dryRun: args.dryRun,
				previewToken
			};
		}

		const policy = args.untrackedPolicy ?? 'clip';
		let requested: Interval | null = null;
		let anchorInfo: AnchorInfo | null = null;
		let dayBounds: Interval | null = null;

		if (kind === 'explicit') {
			requested = { start: args.startedAt as Date, end: args.endedAt as Date };
			if (requested.start.getTime() >= requested.end.getTime()) {
				throw apiError('INVALID_INTERVAL', 'The interval is invalid.', toIsoInterval(requested));
			}
			assertNotTooFarInFuture('startedAt', requested.start, args.now);
			assertNotTooFarInFuture('endedAt', requested.end, args.now);
		} else {
			const targetDate = args.date as string;
			dayBounds = dayResolver.bounds(targetDate);
			// Ignore the entry's own segments when resolving the anchor and testing for
			// overlap (Requirement 7.22).
			const daySegments = await activitiesStore.coveredIntervals(tx, dayBounds, args.id);
			const daySessions = await sessionsStore.trackedIntervals(tx, [dayBounds], args.now);
			let anchor: Date;
			try {
				anchor = resolveAnchor(null, daySegments, daySessions, targetDate);
			} catch (err) {
				if (err instanceof NoPlacementAnchorError) {
					throw apiError(
						'NO_PLACEMENT_ANCHOR',
						'There is nothing to place this against on that day.',
						{
							date: err.date,
							dayBounds: toIsoInterval(dayBounds)
						}
					);
				}
				throw err;
			}
			anchorInfo = {
				at: anchor.toISOString(),
				source: daySegments.length > 0 ? 'last-segment' : 'first-session'
			};
		}

		const window: Interval =
			kind === 'duration' ? (dayBounds as Interval) : (requested as Interval);
		const fingerprintWindow =
			kind === 'duration' ? (dayBounds as Interval) : spanBounds(dayResolver, window.start, window.end);
		const previousToken = await currentFingerprint(tx, fingerprintWindow);
		assertFreshPreview(previousToken, args.previewToken);

		const tracked = await sessionsStore.trackedIntervals(tx, [window], args.now);
		const covered = await activitiesStore.coveredIntervals(tx, window, args.id);
		const openSession = await sessionsStore.currentOpenSession(tx);
		const openSessionSpan: Interval | undefined =
			openSession !== null ? { start: openSession.startedAt, end: args.now } : undefined;

		const runClip = (t: Interval[], c: Interval[]): ClipOutcome =>
			kind === 'duration'
				? clip({
						mode: 'duration',
						anchor: new Date(anchorInfo!.at),
						durationMs: (args.durationMinutes as number) * 60_000,
						dayBounds: dayBounds as Interval,
						tracked: t,
						covered: c,
						openSessionSpan,
						policy,
						minIntervalMs,
						now: args.now
					})
				: clip({
						mode: 'explicit',
						requested: requested as Interval,
						tracked: t,
						covered: c,
						openSessionSpan,
						policy,
						minIntervalMs,
						now: args.now
					});

		const first = runClip(tracked, covered);

		if (kind !== 'duration' && policy === 'reject' && first.discarded.length > 0) {
			throw apiError('OUTSIDE_TRACKED_TIME', 'That falls outside tracked time.', {
				outside: first.discarded.map((d) => toIsoInterval(d)),
				outsideSeconds: Math.round(total(first.discarded) / 1000)
			});
		}
		if (kind !== 'duration' && first.conflicts.length > 0) {
			await activityOverlapError(tx, first.conflicts);
		}

		const rerunClip = (t: Interval[], c: Interval[]): ClipOutcome =>
			kind === 'duration'
				? clip({
						mode: 'duration',
						anchor: new Date(anchorInfo!.at),
						durationMs: (args.durationMinutes as number) * 60_000,
						dayBounds: dayBounds as Interval,
						tracked: t,
						covered: c,
						policy: 'clip',
						minIntervalMs,
						now: args.now
					})
				: clip({
						mode: 'explicit',
						requested: requested as Interval,
						tracked: t,
						covered: c,
						policy: 'clip',
						minIntervalMs,
						now: args.now
					});

		const {
			result: finalResult,
			extendedSessions,
			removedFromRescueMs
		} = policy === 'extend'
			? await clipAndRescue(tx, args.now, minIntervalMs, window, first, kind, rerunClip)
			: { result: first, extendedSessions: [], removedFromRescueMs: 0 };

		if (finalResult.segments.length === 0) {
			// A failed rescue attempt must leave the entry exactly as it was (Requirement 7.19) —
			// nothing has been written yet at this point, so simply not writing is enough.
			const reason = classifyNothingToLog(window, tracked, finalResult);
			nothingToLogError(
				reason,
				anchorInfo,
				kind === 'duration' ? null : toIsoInterval(requested as Interval),
				finalResult.slivers
			);
		}

		const requestedInterval: Interval =
			kind === 'duration'
				? {
						start: finalResult.segments[0].start,
						end: finalResult.segments[finalResult.segments.length - 1].end
					}
				: (requested as Interval);

		if (args.description !== undefined || args.projectId !== undefined) {
			await activitiesStore.updateEntryMeta(tx, args.id, {
				description: args.description,
				projectId: args.projectId
			});
		}
		await activitiesStore.updateEntryRequested(tx, args.id, {
			mode: kind,
			requestedStartedAt: requestedInterval.start,
			requestedEndedAt: requestedInterval.end,
			requestedDurationMinutes: kind === 'duration' ? (args.durationMinutes as number) : null
		});
		await activitiesStore.replaceSegments(tx, args.id, finalResult.segments);

		const refetched = await activitiesStore.getEntry(tx, args.id);
		const previewToken = await currentFingerprint(tx, fingerprintWindow);
		const unplacedMinutes = kind === 'duration' ? Math.ceil(finalResult.unplacedMs / 60_000) : 0;

		return {
			entry: refetched as ActivityEntry,
			discarded: kind === 'duration' ? [] : finalResult.discarded,
			extendedSessions,
			unplacedMinutes,
			removedSeconds: Math.round(removedFromRescueMs / 1000),
			slivers: finalResult.slivers,
			anchor: anchorInfo,
			dryRun: args.dryRun,
			previewToken
		};
	};

	if (!args.dryRun) return withTx((tx) => run(tx));
	return withTx((tx) => run(tx), { dryRun: true });
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

export type DeleteActivityArgs = {
	id: string;
	dryRun: boolean;
	previewToken?: string;
};

export type DeleteActivityPreview = {
	entry: ActivityEntry;
	dryRun: true;
	previewToken: string;
};

export async function deleteActivity(
	args: DeleteActivityArgs
): Promise<DeleteActivityPreview | null> {
	const run = async (tx: Tx): Promise<DeleteActivityPreview | null> => {
		const existing = await activitiesStore.getEntry(tx, args.id);
		if (existing === null) {
			throw apiError('NOT_FOUND', 'That record could not be found.', {
				resource: 'activity',
				id: args.id
			});
		}

		const config = getConfig();
		const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
		const fingerprintWindow = spanBounds(
			dayResolver,
			existing.requestedStartedAt,
			existing.requestedEndedAt
		);
		const previousToken = await currentFingerprint(tx, fingerprintWindow);
		assertFreshPreview(previousToken, args.previewToken);

		await activitiesStore.deleteEntry(tx, args.id);

		if (args.dryRun) {
			const previewToken = await currentFingerprint(tx, fingerprintWindow);
			return { entry: existing, dryRun: true, previewToken };
		}
		return null;
	};

	if (!args.dryRun) {
		await withTx((tx) => run(tx));
		return null;
	}
	return withTx((tx) => run(tx), { dryRun: true });
}
