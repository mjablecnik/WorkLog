/**
 * The `idempotency_keys` rows (Requirements 12.8, 12.9). Not `core/idempotency.ts`:
 * `idempotency_keys` is a table, and `core` holds no persistence. Has no Drizzle
 * table definition — `EXCLUDE`-free and simple enough that raw SQL through
 * `postgres.js` (via `tx.execute`) is the whole of it, per the design's file list.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';

export type IdempotencyRecord = {
	key: string;
	entryId: string | null;
	status: number;
	requestHash: string;
	response: unknown;
};

export async function findIdempotencyRecord(
	tx: Tx,
	key: string
): Promise<IdempotencyRecord | null> {
	const rows = (await tx.execute(
		sql`select key, entry_id, status, request_hash, response from idempotency_keys where key = ${key}`
	)) as unknown as {
		key: string;
		entry_id: string | null;
		status: number;
		request_hash: string;
		response: unknown;
	}[];
	const row = rows[0];
	if (row === undefined) return null;
	return {
		key: row.key,
		entryId: row.entry_id,
		status: row.status,
		requestHash: row.request_hash,
		response: row.response
	};
}

/** Stores the key inside the same transaction as the write it is protecting. */
export async function recordIdempotencyResponse(
	tx: Tx,
	key: string,
	entryId: string | null,
	status: number,
	requestHash: string,
	response: unknown
): Promise<void> {
	await tx.execute(
		sql`insert into idempotency_keys (key, entry_id, status, request_hash, response)
		    values (${key}, ${entryId}, ${status}, ${requestHash}, ${JSON.stringify(response)}::jsonb)`
	);
}

/** Purges keys older than `olderThan`; returns how many were removed. */
export async function purgeIdempotencyKeys(tx: Tx, olderThan: Date): Promise<number> {
	// `postgres.js` cannot bind a raw `Date` in a hand-written `sql` template the way
	// the Drizzle query builder does for typed columns — pass the ISO string instead.
	const deleted = (await tx.execute(
		sql`delete from idempotency_keys where created_at < ${olderThan.toISOString()} returning key`
	)) as unknown as { key: string }[];
	return deleted.length;
}

/**
 * sha256, lowercase hex, of the CANONICAL request body: the object as Zod parsed it
 * (defaults applied), re-serialised with keys sorted ascending — a retry differing
 * only in whitespace or key order is the same request and must replay.
 */
export function canonicalRequestHash(parsedBody: Record<string, unknown>): string {
	const sorted = Object.keys(parsedBody)
		.sort()
		.reduce<Record<string, unknown>>((acc, k) => {
			acc[k] = parsedBody[k];
			return acc;
		}, {});
	return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
