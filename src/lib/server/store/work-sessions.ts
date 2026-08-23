/**
 * Every query and mutation over `work_sessions`. The single-`Open_Session` rule and
 * the overlap of two *closed* sessions are database-enforced (`migrations/001_init.sql`);
 * the one thing the database cannot check — a closed session written straight across
 * the running timer — is `sessionsConflictingWith`, called under the advisory lock
 * inside the writing transaction (Requirements 1.15, 1.16).
 */
import { and, asc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import type { Interval, WorkSession } from '$lib/contracts/models';
import { getConfig } from '../core/config';
import { randomUuidV7 } from '../core/uuid';
import { intersect, normalize, overlaps } from '../domain/interval';
import { workSessions } from '../../../db/schema';
import type { Tx } from './tx';

type WorkSessionRow = typeof workSessions.$inferSelect;

function isStale(
	startedAt: Date,
	endedAt: Date | null,
	now: Date,
	maxOpenSessionHours: number
): boolean {
	if (endedAt !== null) return false;
	return now.getTime() - startedAt.getTime() > maxOpenSessionHours * 3_600_000;
}

function toWorkSession(row: WorkSessionRow, now: Date, maxOpenSessionHours: number): WorkSession {
	return {
		id: row.id,
		startedAt: row.startedAt,
		endedAt: row.endedAt,
		stale: isStale(row.startedAt, row.endedAt, now, maxOpenSessionHours),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

/** The effective interval a row contributes to Tracked_Time, capped at the stale
 *  boundary for an Open_Session (Requirement 1.12) — never longer than the row. */
function cappedTrackedInterval(
	row: WorkSessionRow,
	now: Date,
	maxOpenSessionHours: number
): Interval {
	if (row.endedAt !== null) return { start: row.startedAt, end: row.endedAt };
	const cap = new Date(row.startedAt.getTime() + maxOpenSessionHours * 3_600_000);
	const end = now.getTime() < cap.getTime() ? now : cap;
	return { start: row.startedAt, end };
}

/** `started_at < window.end AND (ended_at IS NULL OR ended_at > window.start)`. */
function overlapClause(window: Interval) {
	return and(
		lt(workSessions.startedAt, window.end),
		or(isNull(workSessions.endedAt), gt(workSessions.endedAt, window.start))
	);
}

export async function openSession(tx: Tx, startedAt: Date): Promise<WorkSession> {
	const [row] = await tx
		.insert(workSessions)
		.values({ id: randomUuidV7(), startedAt, endedAt: null })
		.returning();
	const { maxOpenSessionHours } = getConfig();
	return toWorkSession(row, new Date(), maxOpenSessionHours);
}

export async function closeOpenSession(tx: Tx, endedAt: Date): Promise<WorkSession | null> {
	const [row] = await tx
		.update(workSessions)
		.set({ endedAt })
		.where(isNull(workSessions.endedAt))
		.returning();
	if (row === undefined) return null;
	const { maxOpenSessionHours } = getConfig();
	return toWorkSession(row, new Date(), maxOpenSessionHours);
}

export async function currentOpenSession(tx: Tx): Promise<WorkSession | null> {
	const [row] = await tx.select().from(workSessions).where(isNull(workSessions.endedAt)).limit(1);
	if (row === undefined) return null;
	const { maxOpenSessionHours } = getConfig();
	return toWorkSession(row, new Date(), maxOpenSessionHours);
}

/** All Work_Session rows overlapping `window`, ordered by start ascending. */
export async function listSessionsOverlapping(tx: Tx, window: Interval): Promise<WorkSession[]> {
	const rows = await tx
		.select()
		.from(workSessions)
		.where(overlapClause(window))
		.orderBy(asc(workSessions.startedAt));
	const { maxOpenSessionHours } = getConfig();
	const now = new Date();
	return rows.map((row) => toWorkSession(row, now, maxOpenSessionHours));
}

export async function getSession(tx: Tx, id: string): Promise<WorkSession | null> {
	const [row] = await tx.select().from(workSessions).where(eq(workSessions.id, id)).limit(1);
	if (row === undefined) return null;
	const { maxOpenSessionHours } = getConfig();
	return toWorkSession(row, new Date(), maxOpenSessionHours);
}

export async function updateSession(
	tx: Tx,
	id: string,
	patch: { startedAt?: Date; endedAt?: Date | null }
): Promise<WorkSession> {
	const [row] = await tx.update(workSessions).set(patch).where(eq(workSessions.id, id)).returning();
	if (row === undefined) throw new Error(`work_session ${id} not found`);
	const { maxOpenSessionHours } = getConfig();
	return toWorkSession(row, new Date(), maxOpenSessionHours);
}

export async function deleteSession(tx: Tx, id: string): Promise<void> {
	await tx.delete(workSessions).where(eq(workSessions.id, id));
}

export async function insertSessions(tx: Tx, intervals: Interval[]): Promise<WorkSession[]> {
	if (intervals.length === 0) return [];
	const rows = await tx
		.insert(workSessions)
		.values(intervals.map((i) => ({ id: randomUuidV7(), startedAt: i.start, endedAt: i.end })))
		.returning();
	const { maxOpenSessionHours } = getConfig();
	const now = new Date();
	return rows.map((row) => toWorkSession(row, now, maxOpenSessionHours));
}

/**
 * Normalized Tracked_Time within the union of `window`. An Open_Session is treated as
 * running until `now`, but never longer than MAX_OPEN_SESSION_HOURS (Requirement
 * 1.12) — a Stale_Session's tail is excluded from totals so an abandoned timer cannot
 * inflate them. `window` is a list because a caller (re-clipping) may need several
 * disjoint stretches at once.
 */
export async function trackedIntervals(tx: Tx, window: Interval[], now: Date): Promise<Interval[]> {
	if (window.length === 0) return [];
	const normalizedWindow = normalize(window);
	const boundingStart = normalizedWindow[0].start;
	const boundingEnd = normalizedWindow.reduce(
		(latest, w) => (w.end.getTime() > latest.getTime() ? w.end : latest),
		normalizedWindow[0].end
	);
	const rows = await tx
		.select()
		.from(workSessions)
		.where(overlapClause({ start: boundingStart, end: boundingEnd }));
	const { maxOpenSessionHours } = getConfig();
	const capped = rows.map((row) => cappedTrackedInterval(row, now, maxOpenSessionHours));
	return intersect(capped, normalizedWindow);
}

/**
 * Sessions that would overlap `candidate`, INCLUDING the Open_Session read as
 * `[startedAt, now)` — uncapped by MAX_OPEN_SESSION_HOURS, unlike `trackedIntervals`.
 * The database's exclusion constraint is `WHERE (ended_at IS NOT NULL)`, so it never
 * sees the open row; this query, run inside the writing transaction under the
 * advisory lock, is the only thing that does (Requirements 1.15, 1.16).
 */
export async function sessionsConflictingWith(
	tx: Tx,
	candidate: Interval,
	excludeId: string | null,
	now: Date
): Promise<WorkSession[]> {
	const { maxOpenSessionHours } = getConfig();

	// Closed sessions only — the exclusion constraint already covers these, so this
	// query is a safety net for races, not the primary guard. A row with `ended_at
	// IS NULL` fails `gt(ended_at, candidate.start)` (NULL compares to nothing) and so
	// is naturally excluded here; the Open_Session is handled explicitly below, read
	// as [startedAt, now) rather than the unbounded range a NULL end would otherwise
	// have to be compared against.
	const rows = await tx
		.select()
		.from(workSessions)
		.where(
			and(
				lt(workSessions.startedAt, candidate.end),
				gt(workSessions.endedAt, candidate.start),
				excludeId === null ? undefined : ne(workSessions.id, excludeId)
			)
		);
	const results: WorkSession[] = rows.map((row) => toWorkSession(row, now, maxOpenSessionHours));

	// The Open_Session, read UNCAPPED as [startedAt, now) — the one thing the
	// database's exclusion constraint (WHERE ended_at IS NOT NULL) never sees
	// (Requirements 1.15, 1.16).
	const [openRow] = await tx
		.select()
		.from(workSessions)
		.where(
			and(
				isNull(workSessions.endedAt),
				excludeId === null ? undefined : ne(workSessions.id, excludeId)
			)
		)
		.limit(1);
	if (openRow !== undefined) {
		const openInterval: Interval = { start: openRow.startedAt, end: now };
		if (overlaps(openInterval, candidate)) {
			results.push(toWorkSession(openRow, now, maxOpenSessionHours));
		}
	}
	return results;
}
