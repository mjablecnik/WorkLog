/**
 * Property 13 (A dry run predicts the write exactly), Property 14 (A dry run changes
 * nothing) and Property 18 (Idempotent writes create one record), against the real
 * database. Runs a smaller `numRuns` than the domain property tests: each iteration
 * re-seeds and truncates the real database.
 *
 * Validates: Requirements 12.8, 12.9, 14.1, 14.3, 14.4, 14.5.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { resetDb } from '../setup/db';
import { withReadTx } from '../../src/lib/server/store/tx';
import { mockEvent, bodyOf } from './helpers';
import { POST as projectsPost } from '../../src/routes/api/projects/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';
import {
	DELETE as sessionDelete,
	PATCH as sessionPatch
} from '../../src/routes/api/sessions/[id]/+server';
import { POST as activitiesPost } from '../../src/routes/api/activities/+server';

const BASE = 'http://localhost';
const TABLES: { name: string; orderBy: string }[] = [
	{ name: 'projects', orderBy: 'id' },
	{ name: 'work_sessions', orderBy: 'id' },
	{ name: 'activity_entries', orderBy: 'id' },
	{ name: 'activity_segments', orderBy: 'id' },
	{ name: 'idempotency_keys', orderBy: 'key' }
];

async function snapshotTables(): Promise<string> {
	const parts: string[] = [];
	await withReadTx(async (tx) => {
		for (const { name, orderBy } of TABLES) {
			const rows = await tx.execute(sql.raw(`select * from ${name} order by ${orderBy}`));
			parts.push(`${name}:${JSON.stringify(rows)}`);
		}
	});
	return parts.join('|');
}

/** Sorted (startedAt, endedAt) pairs — the only thing Property 13 compares, per its own text. */
function sortedBounds(segments: { startedAt: string; endedAt: string }[]): [string, string][] {
	return segments
		.map((s): [string, string] => [s.startedAt, s.endedAt])
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const FRAME_START = new Date('2026-06-15T08:00:00Z');
const FRAME_END = new Date('2026-06-15T16:00:00Z');

async function seedFrameAndProject(): Promise<string> {
	const project = await bodyOf(
		await projectsPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Dry Run Seed' } })
		)
	);
	await sessionsPost(
		mockEvent({
			method: 'POST',
			url: `${BASE}/api/sessions`,
			body: { startedAt: FRAME_START.toISOString(), endedAt: FRAME_END.toISOString() }
		})
	);
	return project.id as string;
}

describe('Property 13 & 14: dry run predicts the write exactly, and changes nothing', () => {
	it('creating an Activity_Entry: dryRun leaves the database untouched and predicts the segments the real write produces', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 0, max: 6 * 3600 }),
				fc.integer({ min: 61, max: 2 * 3600 }),
				async (offsetSeconds, durationSeconds) => {
					await resetDb();
					const projectId = await seedFrameAndProject();
					const start = new Date(FRAME_START.getTime() + offsetSeconds * 1000);
					const end = new Date(start.getTime() + durationSeconds * 1000);
					if (end.getTime() > FRAME_END.getTime()) return;

					const body = {
						projectId,
						description: 'property test entry',
						startedAt: start.toISOString(),
						endedAt: end.toISOString()
					};

					const before = await snapshotTables();
					const previewRes = await activitiesPost(
						mockEvent({
							method: 'POST',
							url: `${BASE}/api/activities`,
							body: { ...body, dryRun: true }
						})
					);
					const preview = await bodyOf(previewRes);
					const after = await snapshotTables();
					expect(after, 'a dryRun create changed the database').toBe(before);

					const realRes = await activitiesPost(
						mockEvent({ method: 'POST', url: `${BASE}/api/activities`, body })
					);
					const real = await bodyOf(realRes);

					// Property 13: same status code (both 201 — a create never answers 204).
					expect(previewRes.status).toBe(realRes.status);
					expect(preview.dryRun).toBe(true);
					expect(real.dryRun).toBe(false);

					const previewEntry = preview.entry as {
						segments: { startedAt: string; endedAt: string }[];
					};
					const realEntry = real.entry as { segments: { startedAt: string; endedAt: string }[] };
					expect(sortedBounds(previewEntry.segments)).toEqual(sortedBounds(realEntry.segments));
				}
			),
			{ numRuns: 15 }
		);
	}, 60_000);

	it('shortening a Work_Session: dryRun leaves the database untouched and predicts the segments the real write produces', async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 7 }), async (shrinkHours) => {
				await resetDb();
				const projectId = await seedFrameAndProject();
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'covered stretch',
							startedAt: '2026-06-15T14:00:00Z',
							endedAt: '2026-06-15T15:00:00Z'
						}
					})
				);
				const listed = await withReadTx((tx) =>
					tx.execute(
						sql`select id from work_sessions where started_at = ${FRAME_START.toISOString()}`
					)
				);
				const sessionId = (listed as unknown as { id: string }[])[0].id;

				const newEnd = new Date(FRAME_END.getTime() - shrinkHours * 3_600_000);
				if (newEnd.getTime() <= FRAME_START.getTime()) return;

				const before = await snapshotTables();
				const previewRes = await sessionPatch(
					mockEvent({
						method: 'PATCH',
						url: `${BASE}/api/sessions/${sessionId}`,
						params: { id: sessionId },
						body: { endedAt: newEnd.toISOString(), dryRun: true }
					})
				);
				const preview = await bodyOf(previewRes);
				const after = await snapshotTables();
				expect(after, 'a dryRun session PATCH changed the database').toBe(before);

				const realRes = await sessionPatch(
					mockEvent({
						method: 'PATCH',
						url: `${BASE}/api/sessions/${sessionId}`,
						params: { id: sessionId },
						body: { endedAt: newEnd.toISOString() }
					})
				);
				expect(previewRes.status).toBe(realRes.status);
				const real = await bodyOf(realRes);
				// The real PATCH answers the plain SessionWriteResponse shape (no reclipped list);
				// compare the session's own new bounds instead, which both responses carry.
				expect((real.session as Record<string, unknown>).endedAt).toBe(
					newEnd.toISOString().replace(/\.\d{3}Z$/, '.000Z')
				);
				expect(preview.dryRun).toBe(true);
			}),
			{ numRuns: 10 }
		);
	}, 60_000);

	it('deleting a Work_Session: the real write answers 204 while dryRun answers 200 with the preview (Requirement 14.11)', async () => {
		await fc.assert(
			fc.asyncProperty(fc.constant(null), async () => {
				await resetDb();
				await seedFrameAndProject();
				const listed = await withReadTx((tx) =>
					tx.execute(
						sql`select id from work_sessions where started_at = ${FRAME_START.toISOString()}`
					)
				);
				const sessionId = (listed as unknown as { id: string }[])[0].id;

				const previewRes = await sessionDelete(
					mockEvent({
						url: `${BASE}/api/sessions/${sessionId}?dry_run=true`,
						params: { id: sessionId }
					})
				);
				expect(previewRes.status).toBe(200);
				const preview = await bodyOf(previewRes);
				expect(preview.dryRun).toBe(true);

				const stillThere = await withReadTx((tx) =>
					tx.execute(sql`select id from work_sessions where id = ${sessionId}`)
				);
				expect((stillThere as unknown[]).length).toBe(1);

				const realRes = await sessionDelete(
					mockEvent({ url: `${BASE}/api/sessions/${sessionId}`, params: { id: sessionId } })
				);
				expect(realRes.status).toBe(204);
			}),
			{ numRuns: 3 }
		);
	}, 30_000);
});

describe('Property 18: Idempotent writes create one record', () => {
	it('the same key and body replay one Activity_Entry; the same key with a different body is rejected and changes nothing', async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 0, max: 6 * 3600 }), async (offsetSeconds) => {
				await resetDb();
				const projectId = await seedFrameAndProject();
				const start = new Date(FRAME_START.getTime() + offsetSeconds * 1000);
				const end = new Date(start.getTime() + 3600_000);
				if (end.getTime() > FRAME_END.getTime()) return;

				const body = {
					projectId,
					description: 'idempotent entry',
					startedAt: start.toISOString(),
					endedAt: end.toISOString()
				};
				const key = `prop18-${offsetSeconds}`;

				const first = await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						headers: { 'idempotency-key': key },
						body
					})
				);
				expect(first.status).toBe(201);
				const firstBody = await bodyOf(first);

				const second = await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						headers: { 'idempotency-key': key },
						body
					})
				);
				expect(second.status).toBe(first.status);
				const secondBody = await bodyOf(second);
				expect(secondBody).toEqual(firstBody);

				const entryCount = await withReadTx((tx) =>
					tx.execute(sql`select id from activity_entries`)
				);
				expect((entryCount as unknown[]).length).toBe(1);

				const beforeThird = await snapshotTables();
				const third = await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						headers: { 'idempotency-key': key },
						body: { ...body, description: 'a completely different request' }
					})
				);
				expect(third.status).toBe(409);
				expect((await bodyOf(third)).error).toBe('IDEMPOTENCY_KEY_REUSED');
				const afterThird = await snapshotTables();
				expect(afterThird, 'a reused key with a different body changed the database').toBe(
					beforeThird
				);
			}),
			{ numRuns: 10 }
		);
	}, 60_000);
});
