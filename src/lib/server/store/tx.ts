/**
 * The transaction helper every write and every read goes through. `withTx` takes the
 * exclusive advisory lock as its first statement and either commits or rolls back;
 * `withReadTx` never takes the lock and runs at REPEATABLE READ. `Dry_Run` is
 * implemented here by throwing a private rollback signal after the caller's function
 * resolves — the database sees an ordinary rollback, and the real write and the
 * preview cannot drift because they are the same code path.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as rawSql } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import * as schema from '../../../db/schema';
import { loadConfig, WORKLOG_ADVISORY_LOCK, SHUTDOWN_GRACE_SECONDS } from '../core/config';
import { apiError, ApiError } from '../core/errors';
import { logger } from '../core/logger';

type Schema = typeof schema;

export type Tx = PostgresJsTransaction<Schema, ExtractTablesWithRelations<Schema>>;

let sqlClient: postgres.Sql | null = null;
let dbInstance: PostgresJsDatabase<Schema> | null = null;
let shutdownHandlerRegistered = false;

/**
 * Lazily builds the singleton `postgres.js` client and Drizzle instance from the
 * current environment. Lazy rather than built at import time so that a test's
 * `DATABASE_URL` override (set by `tests/setup/db.ts` before any store function
 * actually runs) is what gets picked up, regardless of module import order.
 */
function getDb(): { client: postgres.Sql; db: PostgresJsDatabase<Schema> } {
	if (sqlClient === null || dbInstance === null) {
		const config = loadConfig();
		sqlClient = postgres(config.databaseUrl, {
			max: config.dbPoolMax,
			// Enforced on the connection itself (`statement_timeout`), not as a
			// JavaScript timer — a timer abandons the client while the database keeps
			// executing. A cancellation surfaces as SQLSTATE 57014.
			connection: { statement_timeout: config.dbQueryTimeoutMs }
		});
		dbInstance = drizzle(sqlClient, { schema });

		if (!shutdownHandlerRegistered && typeof process !== 'undefined') {
			shutdownHandlerRegistered = true;
			process.on('sveltekit:shutdown', () => {
				void closeDb();
			});
		}
	}
	return { client: sqlClient, db: dbInstance };
}

/** Closes the pool. Used on graceful shutdown (Requirement 13.5) and by tests. */
export async function closeDb(): Promise<void> {
	if (sqlClient !== null) {
		await sqlClient.end({ timeout: SHUTDOWN_GRACE_SECONDS });
		sqlClient = null;
		dbInstance = null;
	}
}

/** Forces the next call to reconnect — used by tests that switch DATABASE_URL. */
export function resetDbConnection(): void {
	sqlClient = null;
	dbInstance = null;
}

/** Private signal used to implement Dry_Run: `fn` succeeded, but must not commit. */
class RollbackSignal<T> {
	constructor(readonly value: T) {}
}

/**
 * Opens a transaction, takes the exclusive advisory lock as its first statement, runs
 * `fn`, then commits — or rolls back when `dryRun` is true, or when `fn` throws.
 *
 * When `dryRun` is set, issues `SET CONSTRAINTS ALL IMMEDIATE` immediately after `fn`
 * resolves and before the rollback: `activity_segments_no_overlap` is `DEFERRABLE
 * INITIALLY DEFERRED`, so without this statement it is never evaluated in a
 * transaction that never commits, and a dry run would report success for a write
 * that fails for real.
 *
 * For writes only. Reads use `withReadTx`.
 */
export async function withTx<T>(
	fn: (tx: Tx) => Promise<T>,
	opts?: { dryRun?: boolean }
): Promise<T> {
	const { db } = getDb();
	const dryRun = opts?.dryRun ?? false;
	try {
		return await db.transaction(async (tx) => {
			await tx.execute(rawSql`select pg_advisory_xact_lock(${WORKLOG_ADVISORY_LOCK})`);
			const result = await fn(tx);
			if (dryRun) {
				await tx.execute(rawSql`SET CONSTRAINTS ALL IMMEDIATE`);
				throw new RollbackSignal(result);
			}
			return result;
		});
	} catch (err) {
		if (err instanceof RollbackSignal) return (err as RollbackSignal<T>).value;
		throw translateOrRethrow(err);
	}
}

/**
 * A transaction WITHOUT the exclusive lock, for every read-only path — every GET
 * route, the interface's load functions, and the session lookup the Auth_Hook
 * performs on every single request. Runs at REPEATABLE READ so a multi-statement
 * response (sessions, segments, aggregates) sees one consistent snapshot.
 *
 * Callers must not write through this handle.
 */
export async function withReadTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
	const { db } = getDb();
	try {
		return await db.transaction(async (tx) => fn(tx), { isolationLevel: 'repeatable read' });
	} catch (err) {
		throw translateOrRethrow(err);
	}
}

type ConstraintOp = 'write-entry' | 'delete-project' | 'write-session';

type PostgresError = {
	code?: string;
	constraint_name?: string;
};

/**
 * Maps PostgreSQL constraint violations to `ApiError` codes. `op` disambiguates
 * `activity_entries_project_id_fkey`, which is raised both when a project being
 * deleted is still referenced (409 PROJECT_IN_USE) and when an entry names a project
 * that does not exist (400 VALIDATION_ERROR).
 */
export function translateConstraintError(err: unknown, op: ConstraintOp): ApiError | null {
	if (typeof err !== 'object' || err === null) return null;
	const pgErr = err as PostgresError;
	const code = pgErr.code;
	const constraint = pgErr.constraint_name;

	if (code === '23P01' && constraint === 'work_sessions_no_overlap') {
		return apiError('SESSION_OVERLAP', 'That would overlap another session.');
	}
	if (code === '23P01' && constraint === 'activity_segments_no_overlap') {
		return apiError('ACTIVITY_OVERLAP', 'That would overlap another activity.');
	}
	if (code === '23505' && constraint === 'work_sessions_one_open') {
		return apiError('SESSION_ALREADY_RUNNING', 'A session is already running.');
	}
	if (code === '23505' && constraint === 'projects_name_unique') {
		return apiError('PROJECT_EXISTS', 'A project with that name already exists.');
	}
	if (code === '23503' && constraint === 'activity_entries_project_id_fkey') {
		if (op === 'delete-project') {
			return apiError('PROJECT_IN_USE', 'That project is still in use.');
		}
		return apiError('VALIDATION_ERROR', 'The request could not be validated.', {
			fields: { projectId: { reason: 'fields_invalid_id' } }
		});
	}
	return null;
}

/**
 * Cancellation from `statement_timeout` (SQLSTATE 57014) and connection failures both
 * become 503 SERVICE_UNAVAILABLE, so a caller can tell a transient failure from a
 * defect and retry (Requirement 13.6, 13.14). Anything else passes through
 * unchanged — the application checks the same conditions before writing, so
 * `translateConstraintError` is a safety net for races, not the primary path, and it
 * is applied by the caller that knows the `op`, not blindly here.
 */
function translateOrRethrow(err: unknown): unknown {
	const code = (err as PostgresError | undefined)?.code;
	if (code === '57014') {
		logger.warn('database statement timeout', { code });
		return apiError('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.', {
			retryAfterSeconds: 5
		});
	}
	if (code === 'ECONNREFUSED' || code === 'CONNECTION_ENDED' || code === 'CONNECT_TIMEOUT') {
		logger.warn('database unreachable', { code });
		return apiError('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.', {
			retryAfterSeconds: 5
		});
	}
	return err;
}
