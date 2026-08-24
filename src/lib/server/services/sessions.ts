/**
 * The one body of every `Work_Session` write: start, stop, create (a closed session),
 * PATCH and DELETE. Each opens its own transaction, checks the overlap the database
 * cannot (`sessionsConflictingWith`, guarding the `Open_Session` the `EXCLUDE`
 * constraint never sees), re-clips every affected `Activity_Entry`, and — for
 * `dryRun` — rolls back and returns the preview instead of committing.
 *
 * Never touches a `RequestEvent` and never names an HTTP status: every failure is an
 * `ApiError`, which `core/errors.ts` maps. Timestamp validation (future bound,
 * minimum interval) happens at the route/schema boundary; these functions assume
 * their `Date` arguments already passed that check.
 */
import type { Interval, WorkSession } from '$lib/contracts/models';
import type { SessionChangePreview, SessionWriteResponse } from '$lib/contracts/responses';
import { getConfig } from '../core/config';
import { apiError } from '../core/errors';
import { computePreviewToken } from '../core/preview-token';
import { normalize, subtract, total } from '../domain/interval';
import { reclipAffected, type ReclipPorts } from '../domain/reclip';
import { withTx, type Tx } from '../store/tx';
import * as sessionsStore from '../store/work-sessions';
import * as activitiesStore from '../store/activities';

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

function boundingBox(window: Interval[]): Interval {
	return {
		start: window.reduce(
			(min, w) => (w.start.getTime() < min.getTime() ? w.start : min),
			window[0].start
		),
		end: window.reduce((max, w) => (w.end.getTime() > max.getTime() ? w.end : max), window[0].end)
	};
}

async function currentFingerprint(tx: Tx, window: Interval[]): Promise<string> {
	if (window.length === 0) return computePreviewToken([], []);
	const sessions = await sessionsStore.listSessionsOverlapping(tx, boundingBox(window));
	const segmentLists = await Promise.all(
		window.map((w) => activitiesStore.segmentsOverlapping(tx, w))
	);
	return computePreviewToken(sessions, segmentLists.flat());
}

function assertFreshPreview(previousToken: string, submittedToken: string | undefined): void {
	if (submittedToken !== undefined && submittedToken !== previousToken) {
		throw apiError('STALE_PREVIEW', 'That preview is no longer valid.', {
			submittedToken,
			currentToken: previousToken
		});
	}
}

async function coveredWithinWindow(tx: Tx, window: Interval[]): Promise<Interval[]> {
	if (window.length === 0) return [];
	const parts = await Promise.all(window.map((w) => activitiesStore.coveredIntervals(tx, w)));
	return normalize(parts.flat());
}

function toConflictDetail(session: WorkSession, now: Date) {
	return {
		sessionId: session.id,
		interval: {
			start: session.startedAt.toISOString(),
			end: (session.endedAt ?? now).toISOString()
		},
		open: session.endedAt === null
	};
}

/**
 * The shared tail of every session write: re-clip everything the change affects, and
 * report the consequence — before/after per entry, the total time removed from
 * existing entries, and the Uncovered_Time that simply vanished because it belonged
 * to no entry at all.
 */
async function finishWrite(
	tx: Tx,
	now: Date,
	minIntervalMs: number,
	beforeWindow: Interval[],
	afterWindow: Interval[],
	trackedBefore: Interval[],
	session: WorkSession | null,
	discarded: boolean
): Promise<{ writeResponse: SessionWriteResponse; preview: SessionChangePreview }> {
	const affected = normalize([...beforeWindow, ...afterWindow]);

	const coveredBefore = await coveredWithinWindow(tx, affected);

	const reclipped =
		affected.length > 0
			? await reclipAffected(reclipPortsFor(tx), affected, now, minIntervalMs)
			: [];
	const removedSeconds = Math.round(reclipped.reduce((sum, o) => sum + o.removedMs, 0) / 1000);

	const trackedAfter =
		afterWindow.length > 0 ? await sessionsStore.trackedIntervals(tx, afterWindow, now) : [];
	const removedTrackedRange = subtract(trackedBefore, trackedAfter);
	const lostUncovered = subtract(removedTrackedRange, coveredBefore);
	const lostUncoveredSeconds = Math.round(total(lostUncovered) / 1000);

	const previewToken = await currentFingerprint(tx, affected);

	return {
		writeResponse: { session, discarded },
		preview: {
			session,
			reclipped,
			removedSeconds,
			lostUncoveredSeconds,
			lostUncovered,
			dryRun: true,
			previewToken
		}
	};
}

type WriteArgs = { dryRun: boolean; previewToken?: string; now: Date };

async function runWrite(
	args: WriteArgs,
	body: (tx: Tx) => Promise<{ writeResponse: SessionWriteResponse; preview: SessionChangePreview }>
): Promise<SessionWriteResponse | SessionChangePreview> {
	if (!args.dryRun) {
		const result = await withTx((tx) => body(tx));
		return result.writeResponse;
	}
	const result = await withTx((tx) => body(tx), { dryRun: true });
	return result.preview;
}

export async function startSession(
	args: WriteArgs & { startedAt?: Date }
): Promise<SessionWriteResponse | SessionChangePreview> {
	const config = getConfig();
	const startedAt = args.startedAt ?? args.now;

	return runWrite(args, async (tx) => {
		const existingOpen = await sessionsStore.currentOpenSession(tx);
		if (existingOpen !== null) {
			throw apiError('SESSION_ALREADY_RUNNING', 'A session is already running.', {
				sessionId: existingOpen.id,
				startedAt: existingOpen.startedAt.toISOString()
			});
		}
		const candidate: Interval = { start: startedAt, end: args.now };
		const conflicts = await sessionsStore.sessionsConflictingWith(tx, candidate, null, args.now);
		if (conflicts.length > 0) {
			throw apiError('SESSION_OVERLAP', 'That would overlap another session.', {
				conflicts: conflicts.map((c) => toConflictDetail(c, args.now))
			});
		}

		const afterWindow: Interval[] = [candidate];
		const previousToken = await currentFingerprint(tx, afterWindow);
		assertFreshPreview(previousToken, args.previewToken);

		const session = await sessionsStore.openSession(tx, startedAt);
		return finishWrite(
			tx,
			args.now,
			config.minIntervalSeconds * 1000,
			[],
			afterWindow,
			[],
			session,
			false
		);
	});
}

export async function stopSession(
	args: WriteArgs & { endedAt?: Date }
): Promise<SessionWriteResponse | SessionChangePreview> {
	const config = getConfig();
	const endedAt = args.endedAt ?? args.now;

	return runWrite(args, async (tx) => {
		const open = await sessionsStore.currentOpenSession(tx);
		if (open === null) {
			throw apiError('NO_SESSION_RUNNING', 'No session is running.');
		}

		const beforeWindow: Interval[] = [{ start: open.startedAt, end: args.now }]; // the open span, uncapped
		const durationMs = endedAt.getTime() - open.startedAt.getTime();
		// Captured BEFORE the mutation below — trackedIntervals reads the live table,
		// so querying it after closing/deleting the row would already reflect the new
		// state instead of the old one.
		const trackedBefore = await sessionsStore.trackedIntervals(tx, beforeWindow, args.now);

		if (durationMs < config.minIntervalSeconds * 1000) {
			// A timer the user started must always be stoppable — delete rather than
			// store a sub-floor session, and answer success (Requirement 1.18).
			const previousToken = await currentFingerprint(tx, beforeWindow);
			assertFreshPreview(previousToken, args.previewToken);
			await sessionsStore.deleteSession(tx, open.id);
			return finishWrite(
				tx,
				args.now,
				config.minIntervalSeconds * 1000,
				beforeWindow,
				[],
				trackedBefore,
				null,
				true
			);
		}

		const afterWindow: Interval[] = [{ start: open.startedAt, end: endedAt }];
		const previousToken = await currentFingerprint(
			tx,
			normalize([...beforeWindow, ...afterWindow])
		);
		assertFreshPreview(previousToken, args.previewToken);

		// Closing a Stale_Session can turn its uncapped span into one long enough to
		// overlap a closed session that was written while the timer was still running
		// (the timer's own span is checked against new writes, but nothing checked the
		// reverse until now) — proactively, for the same reason every other write here
		// checks before it acts: once `closeOpenSession` fails, the transaction aborts
		// and there is no clean way to build a rich error afterwards.
		const conflicts = await sessionsStore.sessionsConflictingWith(
			tx,
			afterWindow[0],
			open.id,
			args.now
		);
		if (conflicts.length > 0) {
			throw apiError('SESSION_OVERLAP', 'That would overlap another session.', {
				conflicts: conflicts.map((c) => toConflictDetail(c, args.now))
			});
		}

		const session = await sessionsStore.closeOpenSession(tx, endedAt);
		return finishWrite(
			tx,
			args.now,
			config.minIntervalSeconds * 1000,
			beforeWindow,
			afterWindow,
			trackedBefore,
			session,
			false
		);
	});
}

export async function createSession(
	args: WriteArgs & { startedAt: Date; endedAt: Date }
): Promise<SessionWriteResponse | SessionChangePreview> {
	const config = getConfig();
	const candidate: Interval = { start: args.startedAt, end: args.endedAt };

	return runWrite(args, async (tx) => {
		const conflicts = await sessionsStore.sessionsConflictingWith(tx, candidate, null, args.now);
		if (conflicts.length > 0) {
			throw apiError('SESSION_OVERLAP', 'That would overlap another session.', {
				conflicts: conflicts.map((c) => toConflictDetail(c, args.now))
			});
		}

		const afterWindow: Interval[] = [candidate];
		const previousToken = await currentFingerprint(tx, afterWindow);
		assertFreshPreview(previousToken, args.previewToken);

		const [session] = await sessionsStore.insertSessions(tx, [candidate]);
		return finishWrite(
			tx,
			args.now,
			config.minIntervalSeconds * 1000,
			[],
			afterWindow,
			[],
			session,
			false
		);
	});
}

export async function patchSession(
	args: WriteArgs & { id: string; startedAt?: Date; endedAt?: Date | null }
): Promise<SessionWriteResponse | SessionChangePreview> {
	const config = getConfig();

	return runWrite(args, async (tx) => {
		const existing = await sessionsStore.getSession(tx, args.id);
		if (existing === null) {
			throw apiError('NOT_FOUND', 'That record could not be found.', {
				resource: 'session',
				id: args.id
			});
		}

		const beforeWindow: Interval[] = [
			{ start: existing.startedAt, end: existing.endedAt ?? args.now }
		];
		const newStart = args.startedAt ?? existing.startedAt;
		const newEnd = args.endedAt === null ? null : (args.endedAt ?? existing.endedAt);
		if (newEnd !== null && newStart.getTime() >= newEnd.getTime()) {
			throw apiError('INVALID_INTERVAL', 'The interval is invalid.', {
				start: newStart.toISOString(),
				end: newEnd.toISOString()
			});
		}

		const candidate: Interval = { start: newStart, end: newEnd ?? args.now };
		const conflicts = await sessionsStore.sessionsConflictingWith(tx, candidate, args.id, args.now);
		if (conflicts.length > 0) {
			throw apiError('SESSION_OVERLAP', 'That would overlap another session.', {
				conflicts: conflicts.map((c) => toConflictDetail(c, args.now))
			});
		}

		const afterWindow: Interval[] = [candidate];
		const previousToken = await currentFingerprint(
			tx,
			normalize([...beforeWindow, ...afterWindow])
		);
		assertFreshPreview(previousToken, args.previewToken);

		// Captured BEFORE the mutation below, for the same reason as stopSession.
		const trackedBefore = await sessionsStore.trackedIntervals(tx, beforeWindow, args.now);
		const session = await sessionsStore.updateSession(tx, args.id, {
			startedAt: newStart,
			endedAt: newEnd
		});
		return finishWrite(
			tx,
			args.now,
			config.minIntervalSeconds * 1000,
			beforeWindow,
			afterWindow,
			trackedBefore,
			session,
			false
		);
	});
}

export async function deleteSession(
	args: WriteArgs & { id: string }
): Promise<SessionWriteResponse | SessionChangePreview> {
	const config = getConfig();

	return runWrite(args, async (tx) => {
		const existing = await sessionsStore.getSession(tx, args.id);
		if (existing === null) {
			throw apiError('NOT_FOUND', 'That record could not be found.', {
				resource: 'session',
				id: args.id
			});
		}

		const beforeWindow: Interval[] = [
			{ start: existing.startedAt, end: existing.endedAt ?? args.now }
		];
		const previousToken = await currentFingerprint(tx, beforeWindow);
		assertFreshPreview(previousToken, args.previewToken);

		// Captured BEFORE the mutation below, for the same reason as stopSession.
		const trackedBefore = await sessionsStore.trackedIntervals(tx, beforeWindow, args.now);
		await sessionsStore.deleteSession(tx, args.id);
		return finishWrite(
			tx,
			args.now,
			config.minIntervalSeconds * 1000,
			beforeWindow,
			[],
			trackedBefore,
			null,
			false
		);
	});
}
