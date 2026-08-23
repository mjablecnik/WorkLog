import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import {
	canonicalRequestHash,
	findIdempotencyRecord,
	purgeIdempotencyKeys,
	recordIdempotencyResponse
} from '../../../../src/lib/server/store/idempotency';

describe('idempotency store', () => {
	it('a repeated key replays the original status and body and creates nothing new', async () => {
		const hash = canonicalRequestHash({ projectId: 'p1', description: 'x' });
		// entry_id has a real FK to activity_entries.id — a null entry_id (no entry was
		// created, e.g. a replayed error response) is the case this test exercises;
		// the FK-cascade behaviour itself is covered in schema.test.ts.
		await withTx((tx) =>
			recordIdempotencyResponse(tx, 'replay-key', null, 201, hash, { ok: true })
		);

		const found = await withTx((tx) => findIdempotencyRecord(tx, 'replay-key'));
		expect(found?.status).toBe(201);
		expect(found?.requestHash).toBe(hash);
		expect(found?.response).toEqual({ ok: true });
		expect(found?.entryId).toBeNull();
	});

	it('canonicalRequestHash is stable regardless of key order', () => {
		expect(canonicalRequestHash({ a: 1, b: 2 })).toBe(canonicalRequestHash({ b: 2, a: 1 }));
	});

	it('a different body under the same conceptual request produces a different hash', () => {
		expect(canonicalRequestHash({ a: 1 })).not.toBe(canonicalRequestHash({ a: 2 }));
	});

	it('a missing key resolves to null', async () => {
		expect(await withTx((tx) => findIdempotencyRecord(tx, 'does-not-exist'))).toBeNull();
	});

	it('a key older than the cutoff is purged; a fresh one is not', async () => {
		const hash = canonicalRequestHash({ a: 1 });
		await withTx((tx) => recordIdempotencyResponse(tx, 'fresh-key', null, 200, hash, {}));

		const purgedWithPastCutoff = await withTx((tx) =>
			purgeIdempotencyKeys(tx, new Date(Date.now() - 24 * 3_600_000))
		);
		expect(purgedWithPastCutoff).toBe(0);
		expect(await withTx((tx) => findIdempotencyRecord(tx, 'fresh-key'))).not.toBeNull();

		const purgedWithFutureCutoff = await withTx((tx) =>
			purgeIdempotencyKeys(tx, new Date(Date.now() + 1000))
		);
		expect(purgedWithFutureCutoff).toBeGreaterThanOrEqual(1);
		expect(await withTx((tx) => findIdempotencyRecord(tx, 'fresh-key'))).toBeNull();
	});
});
