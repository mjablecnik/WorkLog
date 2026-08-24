/**
 * Every query and mutation over `projects`. Colour assignment is the one nontrivial
 * rule here: the lowest index (0..7) not held by a non-archived project, or — once
 * all eight are taken — the index held by the fewest non-archived projects, lowest
 * index winning a tie, so a ninth project is coloured deterministically.
 *
 * Every write below checks its precondition (name uniqueness, entries blocking a
 * delete) BEFORE issuing the statement, rather than catching the resulting
 * constraint violation and querying for detail afterwards: once one statement in a
 * PostgreSQL transaction fails, the whole transaction is aborted and every later
 * statement in it fails too (SQLSTATE 25P02), so a follow-up SELECT to build a rich
 * error can never run. The proactive check has no race to worry about either — every
 * write runs inside `withTx`, which serializes the whole application behind one
 * advisory lock (this is a single-instance app by design), so nothing can insert
 * between the check and the act. `translateConstraintError` stays wired in as a
 * defensive fallback that reports the bare code, in case a genuinely unexpected
 * violation still occurs.
 */
import { and, asc, eq, isNull, ne, sql as rawSql } from 'drizzle-orm';
import type { Project } from '$lib/contracts/models';
import { apiError, ApiError } from '../core/errors';
import { ERROR_DETAIL_SAMPLE_SIZE } from '../core/config';
import { randomUuidV7 } from '../core/uuid';
import { projects } from '../../../db/schema';
import { translateConstraintError, type Tx } from './tx';
import { entriesBlockingProject } from './activities';

type ProjectRow = typeof projects.$inferSelect;

function toProject(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		colorIndex: row.colorIndex,
		archivedAt: row.archivedAt,
		archived: row.archivedAt !== null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

const PALETTE_SIZE = 8;

async function assignColorIndex(tx: Tx): Promise<number> {
	const rows = await tx
		.select({ colorIndex: projects.colorIndex })
		.from(projects)
		.where(isNull(projects.archivedAt));
	const counts = new Array(PALETTE_SIZE).fill(0);
	for (const row of rows) {
		if (row.colorIndex >= 0 && row.colorIndex < PALETTE_SIZE) counts[row.colorIndex]++;
	}
	const freeIndex = counts.findIndex((c) => c === 0);
	if (freeIndex !== -1) return freeIndex;
	// Every index is held — pick the one held by the fewest non-archived projects,
	// lowest index winning a tie (Requirement 3.12).
	let best = 0;
	for (let i = 1; i < PALETTE_SIZE; i++) {
		if (counts[i] < counts[best]) best = i;
	}
	return best;
}

async function findByNormalizedName(
	tx: Tx,
	name: string,
	excludeId?: string
): Promise<ProjectRow | null> {
	const [existing] = await tx
		.select()
		.from(projects)
		.where(
			and(
				rawSql`lower(btrim(${projects.name})) = lower(btrim(${name}))`,
				excludeId === undefined ? undefined : ne(projects.id, excludeId)
			)
		)
		.limit(1);
	return existing ?? null;
}

function projectExistsError(existing: ProjectRow | null): ApiError {
	return apiError('PROJECT_EXISTS', 'A project with that name already exists.', {
		projectId: existing?.id,
		projectName: existing?.name
	});
}

export async function createProject(tx: Tx, name: string): Promise<Project> {
	const existing = await findByNormalizedName(tx, name);
	if (existing !== null) throw projectExistsError(existing);

	const colorIndex = await assignColorIndex(tx);
	try {
		const [row] = await tx
			.insert(projects)
			.values({ id: randomUuidV7(), name, colorIndex })
			.returning();
		return toProject(row);
	} catch (err) {
		const mapped = translateConstraintError(err, 'write-entry');
		if (mapped !== null) throw mapped;
		throw err;
	}
}

export async function listProjects(tx: Tx, includeArchived: boolean): Promise<Project[]> {
	const rows = await tx
		.select()
		.from(projects)
		.where(includeArchived ? undefined : isNull(projects.archivedAt))
		.orderBy(asc(projects.name));
	return rows.map(toProject);
}

export async function getProject(tx: Tx, id: string): Promise<Project | null> {
	const [row] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
	return row === undefined ? null : toProject(row);
}

export async function updateProject(
	tx: Tx,
	id: string,
	patch: { name?: string; archived?: boolean; colorIndex?: number }
): Promise<Project> {
	if (patch.name !== undefined) {
		const existing = await findByNormalizedName(tx, patch.name, id);
		if (existing !== null) throw projectExistsError(existing);
	}

	const set: { name?: string; archivedAt?: Date | null; colorIndex?: number } = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
	if (patch.colorIndex !== undefined) set.colorIndex = patch.colorIndex;

	// An empty `{}` PATCH passes validation (every field is optional) but Drizzle
	// rejects `update(...).set({})` outright — treat it as a no-op read rather than
	// issuing a statement with nothing to set (Requirement — never a 500 for a request
	// that passed validation).
	if (Object.keys(set).length === 0) {
		const [row] = await tx.select().from(projects).where(eq(projects.id, id)).limit(1);
		if (row === undefined) {
			throw apiError('NOT_FOUND', 'That record could not be found.', { resource: 'project', id });
		}
		return toProject(row);
	}

	try {
		const [row] = await tx.update(projects).set(set).where(eq(projects.id, id)).returning();
		if (row === undefined) {
			throw apiError('NOT_FOUND', 'That record could not be found.', { resource: 'project', id });
		}
		return toProject(row);
	} catch (err) {
		if (err instanceof ApiError) throw err;
		const mapped = translateConstraintError(err, 'write-entry');
		if (mapped !== null) throw mapped;
		throw err;
	}
}

/**
 * Deletes a project. When it is still referenced, answers `PROJECT_IN_USE` carrying
 * the blocking entries themselves (Requirement 3.7) — checked BEFORE the delete is
 * attempted, for the transaction-abort reason explained at the top of this file.
 */
export async function deleteProject(tx: Tx, id: string): Promise<void> {
	const blocking = await entriesBlockingProject(tx, id, ERROR_DETAIL_SAMPLE_SIZE);
	if (blocking.count > 0) {
		throw apiError('PROJECT_IN_USE', 'That project is still in use.', {
			entryCount: blocking.count,
			entries: blocking.sample.map((e) => ({
				entryId: e.entryId,
				description: e.description,
				requestedStartedAt: e.requestedStartedAt.toISOString(),
				requestedEndedAt: e.requestedEndedAt.toISOString()
			}))
		});
	}
	try {
		const [row] = await tx.delete(projects).where(eq(projects.id, id)).returning();
		if (row === undefined) {
			throw apiError('NOT_FOUND', 'That record could not be found.', { resource: 'project', id });
		}
	} catch (err) {
		if (err instanceof ApiError) throw err;
		const mapped = translateConstraintError(err, 'delete-project');
		if (mapped !== null) throw mapped;
		throw err;
	}
}
