/**
 * Every query and mutation over `activity_entries` and `activity_segments`. An
 * `Orphaned_Entry` (no `Activity_Segment` rows) is never deleted by reconciliation —
 * every listing here selects it back in by its requested interval, which is the only
 * handle it still has.
 */
import { and, asc, desc, eq, gt, inArray, lt, ne, notExists, or, sql as rawSql } from 'drizzle-orm';
import type {
	ActivityEntry,
	ActivityMode,
	Interval,
	NewActivityEntry
} from '$lib/contracts/models';
import { normalize } from '../domain/interval';
import { randomUuidV7 } from '../core/uuid';
import { activityEntries, activitySegments, projects } from '../../../db/schema';
import type { Tx } from './tx';

type EntryRow = typeof activityEntries.$inferSelect;
type SegmentRow = typeof activitySegments.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

function toSegment(row: SegmentRow) {
	return { id: row.id, entryId: row.entryId, startedAt: row.startedAt, endedAt: row.endedAt };
}

function toEntry(
	row: EntryRow,
	project: Pick<ProjectRow, 'name' | 'colorIndex'>,
	segments: SegmentRow[]
): ActivityEntry {
	return {
		id: row.id,
		projectId: row.projectId,
		projectName: project.name,
		colorIndex: project.colorIndex,
		description: row.description,
		mode: row.mode as ActivityMode,
		requestedStartedAt: row.requestedStartedAt as Date,
		requestedEndedAt: row.requestedEndedAt as Date,
		requestedDurationMinutes: row.requestedDurationMinutes,
		orphaned: segments.length === 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		segments: segments.map(toSegment).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
	};
}

/** `started_at < window.end AND ended_at > window.start` over activity_segments. */
function segmentOverlapClause(window: Interval) {
	return and(
		lt(activitySegments.startedAt, window.end),
		gt(activitySegments.endedAt, window.start)
	);
}

/** `requested_started_at < window.end AND requested_ended_at > window.start`. */
function requestedOverlapClause(window: Interval) {
	return and(
		lt(activityEntries.requestedStartedAt, window.end),
		gt(activityEntries.requestedEndedAt, window.start)
	);
}

function segmentOverlapsAny(windows: Interval[]) {
	const clauses = windows.map((w) => segmentOverlapClause(w));
	return or(...clauses);
}

function requestedOverlapsAny(windows: Interval[]) {
	const clauses = windows.map((w) => requestedOverlapClause(w));
	return or(...clauses);
}

/** Loads and attaches project + segments for a set of entry rows, in one pass each. */
async function hydrate(tx: Tx, entryRows: EntryRow[]): Promise<ActivityEntry[]> {
	if (entryRows.length === 0) return [];
	const ids = entryRows.map((r) => r.id);
	const projectIds = [...new Set(entryRows.map((r) => r.projectId))];

	const [projectRows, segmentRows] = await Promise.all([
		tx.select().from(projects).where(inArray(projects.id, projectIds)),
		tx.select().from(activitySegments).where(inArray(activitySegments.entryId, ids))
	]);

	const projectById = new Map(projectRows.map((p) => [p.id, p]));
	const segmentsByEntry = new Map<string, SegmentRow[]>();
	for (const s of segmentRows) {
		const list = segmentsByEntry.get(s.entryId) ?? [];
		list.push(s);
		segmentsByEntry.set(s.entryId, list);
	}

	return entryRows.map((row) => {
		const project = projectById.get(row.projectId);
		if (project === undefined)
			throw new Error(`project ${row.projectId} not found for entry ${row.id}`);
		return toEntry(row, project, segmentsByEntry.get(row.id) ?? []);
	});
}

export async function createEntry(
	tx: Tx,
	entry: NewActivityEntry,
	segments: Interval[]
): Promise<ActivityEntry> {
	const id = randomUuidV7();
	const [row] = await tx
		.insert(activityEntries)
		.values({
			id,
			projectId: entry.projectId,
			description: entry.description,
			mode: entry.mode,
			requestedStartedAt: entry.requestedStartedAt,
			requestedEndedAt: entry.requestedEndedAt,
			requestedDurationMinutes: entry.requestedDurationMinutes
		})
		.returning();
	if (segments.length > 0) {
		await tx.insert(activitySegments).values(
			segments.map((s) => ({
				id: randomUuidV7(),
				entryId: id,
				startedAt: s.start,
				endedAt: s.end
			}))
		);
	}
	const [hydrated] = await hydrate(tx, [row]);
	return hydrated;
}

export async function getEntry(tx: Tx, id: string): Promise<ActivityEntry | null> {
	const [row] = await tx.select().from(activityEntries).where(eq(activityEntries.id, id)).limit(1);
	if (row === undefined) return null;
	const [hydrated] = await hydrate(tx, [row]);
	return hydrated;
}

export async function updateEntryMeta(
	tx: Tx,
	id: string,
	patch: { description?: string; projectId?: string }
): Promise<ActivityEntry> {
	// An empty meta PATCH (`{}`, or `{previewToken}`/`{dryRun}` alone) passes validation
	// but leaves nothing for Drizzle to `.set()` — reread instead of issuing a statement
	// with no columns, the same no-op the project PATCH route takes for the same shape.
	if (patch.description === undefined && patch.projectId === undefined) {
		const [row] = await tx
			.select()
			.from(activityEntries)
			.where(eq(activityEntries.id, id))
			.limit(1);
		if (row === undefined) throw new Error(`activity_entry ${id} not found`);
		const [hydrated] = await hydrate(tx, [row]);
		return hydrated;
	}
	const [row] = await tx
		.update(activityEntries)
		.set(patch)
		.where(eq(activityEntries.id, id))
		.returning();
	if (row === undefined) throw new Error(`activity_entry ${id} not found`);
	const [hydrated] = await hydrate(tx, [row]);
	return hydrated;
}

/**
 * Replaces every requested-interval field of the entry (Requirement 7.17/7.26) and,
 * separately, its segments. The caller supplies both.
 */
export async function updateEntryRequested(
	tx: Tx,
	id: string,
	patch: {
		mode: ActivityMode;
		requestedStartedAt: Date;
		requestedEndedAt: Date;
		requestedDurationMinutes: number | null;
	}
): Promise<ActivityEntry> {
	const [row] = await tx
		.update(activityEntries)
		.set(patch)
		.where(eq(activityEntries.id, id))
		.returning();
	if (row === undefined) throw new Error(`activity_entry ${id} not found`);
	const [hydrated] = await hydrate(tx, [row]);
	return hydrated;
}

export async function replaceSegments(
	tx: Tx,
	entryId: string,
	segments: Interval[]
): Promise<void> {
	await tx.delete(activitySegments).where(eq(activitySegments.entryId, entryId));
	if (segments.length > 0) {
		await tx.insert(activitySegments).values(
			segments.map((s) => ({
				id: randomUuidV7(),
				entryId,
				startedAt: s.start,
				endedAt: s.end
			}))
		);
	}
}

export async function deleteEntry(tx: Tx, id: string): Promise<void> {
	await tx.delete(activityEntries).where(eq(activityEntries.id, id));
}

/**
 * Normalized Covered_Time within `window`, excluding one entry's own segments — used
 * both to test for ACTIVITY_OVERLAP and, with the entry's own id, to re-clip it
 * without it blocking or displacing itself (Requirement 7.10, 7.22).
 */
export async function coveredIntervals(
	tx: Tx,
	window: Interval,
	excludeEntryId?: string
): Promise<Interval[]> {
	const rows = await tx
		.select({ startedAt: activitySegments.startedAt, endedAt: activitySegments.endedAt })
		.from(activitySegments)
		.where(
			and(
				segmentOverlapClause(window),
				excludeEntryId === undefined ? undefined : ne(activitySegments.entryId, excludeEntryId)
			)
		);
	return normalize(rows.map((r) => ({ start: r.startedAt, end: r.endedAt })));
}

/** Raw segment rows overlapping `window` — the ids the Preview_Token fingerprint needs. */
export async function segmentsOverlapping(
	tx: Tx,
	window: Interval
): Promise<{ id: string; startedAt: Date; endedAt: Date }[]> {
	return tx
		.select({
			id: activitySegments.id,
			startedAt: activitySegments.startedAt,
			endedAt: activitySegments.endedAt
		})
		.from(activitySegments)
		.where(segmentOverlapClause(window));
}

/**
 * Every Activity_Entry with at least one segment overlapping `window`, UNION every
 * Orphaned_Entry whose requested interval overlaps it (Requirements 7.1, 7.2), joined
 * with project and segments, ordered by (requestedStartedAt, createdAt, id).
 */
export async function entriesOverlapping(tx: Tx, window: Interval): Promise<ActivityEntry[]> {
	const withSegment = tx
		.selectDistinct({ id: activityEntries.id })
		.from(activityEntries)
		.innerJoin(activitySegments, eq(activitySegments.entryId, activityEntries.id))
		.where(segmentOverlapClause(window));

	const orphanedRequested = tx
		.select({ id: activityEntries.id })
		.from(activityEntries)
		.where(
			and(
				requestedOverlapClause(window),
				notExists(
					tx
						.select({ one: rawSql`1` })
						.from(activitySegments)
						.where(eq(activitySegments.entryId, activityEntries.id))
				)
			)
		);

	const ids = new Set<string>();
	for (const r of await withSegment) ids.add(r.id);
	for (const r of await orphanedRequested) ids.add(r.id);
	if (ids.size === 0) return [];

	const rows = await tx
		.select()
		.from(activityEntries)
		.where(inArray(activityEntries.id, [...ids]))
		.orderBy(
			asc(activityEntries.requestedStartedAt),
			asc(activityEntries.createdAt),
			asc(activityEntries.id)
		);
	return hydrate(tx, rows);
}

/**
 * The single most recent `Activity_Entry` by the total order of Requirement 7.1,
 * regardless of day — the fallback source for `quickLog`'s `projectId` when the
 * `Target_Day` itself has none (Requirement: "or of any day when that day has none").
 */
export async function mostRecentEntry(tx: Tx): Promise<ActivityEntry | null> {
	const [row] = await tx
		.select()
		.from(activityEntries)
		.orderBy(
			desc(activityEntries.requestedStartedAt),
			desc(activityEntries.createdAt),
			desc(activityEntries.id)
		)
		.limit(1);
	if (row === undefined) return null;
	const [hydrated] = await hydrate(tx, [row]);
	return hydrated;
}

/** Just the Orphaned_Entry rows whose requested interval overlaps `window`. */
export async function orphanedEntriesOverlapping(
	tx: Tx,
	window: Interval
): Promise<ActivityEntry[]> {
	const rows = await tx
		.select()
		.from(activityEntries)
		.where(
			and(
				requestedOverlapClause(window),
				notExists(
					tx
						.select({ one: rawSql`1` })
						.from(activitySegments)
						.where(eq(activitySegments.entryId, activityEntries.id))
				)
			)
		)
		.orderBy(
			asc(activityEntries.requestedStartedAt),
			asc(activityEntries.createdAt),
			asc(activityEntries.id)
		);
	return hydrate(tx, rows);
}

export type EntryCursor = { requestedStartedAt: Date; createdAt: Date; id: string };

export type EntryListPage = { entries: ActivityEntry[]; hasMore: boolean };

/**
 * The paged listing behind `GET /api/activities`: every Activity_Entry with a segment
 * overlapping `window`, unioned with every Orphaned_Entry selected by requested
 * interval, optionally filtered by project, in the deterministic
 * (requestedStartedAt, createdAt, id) order (or its reverse), continued from `cursor`.
 */
export async function listEntriesOverlapping(
	tx: Tx,
	window: Interval,
	opts: { projectId?: string; cursor?: EntryCursor | null; limit: number; order: 'asc' | 'desc' }
): Promise<EntryListPage> {
	const withSegment = tx
		.selectDistinct({ id: activityEntries.id })
		.from(activityEntries)
		.innerJoin(activitySegments, eq(activitySegments.entryId, activityEntries.id))
		.where(segmentOverlapClause(window));

	const orphanedRequested = tx
		.select({ id: activityEntries.id })
		.from(activityEntries)
		.where(
			and(
				requestedOverlapClause(window),
				notExists(
					tx
						.select({ one: rawSql`1` })
						.from(activitySegments)
						.where(eq(activitySegments.entryId, activityEntries.id))
				)
			)
		);

	const ids = new Set<string>();
	for (const r of await withSegment) ids.add(r.id);
	for (const r of await orphanedRequested) ids.add(r.id);
	if (ids.size === 0) return { entries: [], hasMore: false };

	const cmp = opts.order === 'asc' ? gt : lt;
	const cursorClause =
		opts.cursor === null || opts.cursor === undefined
			? undefined
			: or(
					cmp(activityEntries.requestedStartedAt, opts.cursor.requestedStartedAt),
					and(
						eq(activityEntries.requestedStartedAt, opts.cursor.requestedStartedAt),
						cmp(activityEntries.createdAt, opts.cursor.createdAt)
					),
					and(
						eq(activityEntries.requestedStartedAt, opts.cursor.requestedStartedAt),
						eq(activityEntries.createdAt, opts.cursor.createdAt),
						cmp(activityEntries.id, opts.cursor.id)
					)
				);

	const order =
		opts.order === 'asc'
			? [
					asc(activityEntries.requestedStartedAt),
					asc(activityEntries.createdAt),
					asc(activityEntries.id)
				]
			: [
					desc(activityEntries.requestedStartedAt),
					desc(activityEntries.createdAt),
					desc(activityEntries.id)
				];

	const rows = await tx
		.select()
		.from(activityEntries)
		.where(
			and(
				inArray(activityEntries.id, [...ids]),
				opts.projectId === undefined ? undefined : eq(activityEntries.projectId, opts.projectId),
				cursorClause
			)
		)
		.orderBy(...order)
		.limit(opts.limit + 1);

	const hasMore = rows.length > opts.limit;
	const page = hasMore ? rows.slice(0, opts.limit) : rows;
	return { entries: await hydrate(tx, page), hasMore };
}

/**
 * The entries blocking a project delete (Requirement 3.7): the total count, plus up
 * to `limit` of them carrying the description and requested interval the error
 * promises.
 */
export async function entriesBlockingProject(
	tx: Tx,
	projectId: string,
	limit: number
): Promise<{
	count: number;
	sample: {
		entryId: string;
		description: string;
		requestedStartedAt: Date;
		requestedEndedAt: Date;
	}[];
}> {
	const [{ count }] = await tx
		.select({ count: rawSql<number>`count(*)::int` })
		.from(activityEntries)
		.where(eq(activityEntries.projectId, projectId));

	const sampleRows = await tx
		.select()
		.from(activityEntries)
		.where(eq(activityEntries.projectId, projectId))
		.orderBy(asc(activityEntries.requestedStartedAt))
		.limit(limit);

	return {
		count,
		sample: sampleRows.map((r) => ({
			entryId: r.id,
			description: r.description,
			requestedStartedAt: r.requestedStartedAt as Date,
			requestedEndedAt: r.requestedEndedAt as Date
		}))
	};
}

/** Every Activity_Entry id referencing `projectId`. */
export async function entryIdsForProject(tx: Tx, projectId: string): Promise<string[]> {
	const rows = await tx
		.select({ id: activityEntries.id })
		.from(activityEntries)
		.where(eq(activityEntries.projectId, projectId));
	return rows.map((r) => r.id);
}

/**
 * The entries `reclipAffected` must reconsider: a segment intersects `windows` OR the
 * entry's requested interval does (Requirement 2.9) — no orphan restriction, unlike
 * the listing queries above, because an entry an earlier change emptied owns no
 * segment and this is the only way it is ever found again. Ordered deterministically.
 */
export async function entriesAffectedBy(tx: Tx, windows: Interval[]): Promise<ActivityEntry[]> {
	if (windows.length === 0) return [];
	const bySegment = tx
		.selectDistinct({ id: activityEntries.id })
		.from(activityEntries)
		.innerJoin(activitySegments, eq(activitySegments.entryId, activityEntries.id))
		.where(segmentOverlapsAny(windows));
	const byRequested = tx
		.select({ id: activityEntries.id })
		.from(activityEntries)
		.where(requestedOverlapsAny(windows));

	const ids = new Set<string>();
	for (const r of await bySegment) ids.add(r.id);
	for (const r of await byRequested) ids.add(r.id);
	if (ids.size === 0) return [];

	const rows = await tx
		.select()
		.from(activityEntries)
		.where(inArray(activityEntries.id, [...ids]))
		.orderBy(
			asc(activityEntries.requestedStartedAt),
			asc(activityEntries.createdAt),
			asc(activityEntries.id)
		);
	return hydrate(tx, rows);
}
