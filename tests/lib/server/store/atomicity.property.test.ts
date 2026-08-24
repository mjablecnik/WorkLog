/**
 * Property 10 (Rejected writes leave no trace) and Property 16 (Every entry stays
 * reachable), against the real database. Runs a smaller `numRuns` than the domain
 * property tests: each iteration re-seeds and truncates the real database, which is
 * orders of magnitude slower than the in-memory properties in `domain/`.
 *
 * Validates: Requirements 2.10, 6.11, 7.2.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { resetDb } from '../../../setup/db';
import { withReadTx } from '../../../../src/lib/server/store/tx';
import { mockEvent, bodyOf } from '../../../api/helpers';
import { POST as projectsPost } from '../../../../src/routes/api/projects/+server';
import { DELETE as projectDelete } from '../../../../src/routes/api/projects/[id]/+server';
import { POST as sessionsPost } from '../../../../src/routes/api/sessions/+server';
import {
	GET as activitiesGet,
	POST as activitiesPost
} from '../../../../src/routes/api/activities/+server';
import { PATCH as activityPatch } from '../../../../src/routes/api/activities/[id]/+server';

const BASE = 'http://localhost';
const TABLES: { name: string; orderBy: string }[] = [
	{ name: 'projects', orderBy: 'id' },
	{ name: 'work_sessions', orderBy: 'id' },
	{ name: 'activity_entries', orderBy: 'id' },
	{ name: 'activity_segments', orderBy: 'id' },
	{ name: 'idempotency_keys', orderBy: 'key' }
];

/** A JSON snapshot of every row in every write-relevant table, ordered by its own key. */
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

type Seed = { projectId: string; entryId: string };

async function seed(): Promise<Seed> {
	const project = await bodyOf(
		await projectsPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Atomicity Seed' } })
		)
	);
	await sessionsPost(
		mockEvent({
			method: 'POST',
			url: `${BASE}/api/sessions`,
			body: { startedAt: '2026-06-01T08:00:00Z', endedAt: '2026-06-01T12:00:00Z' }
		})
	);
	const entry = await bodyOf(
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: project.id,
					description: 'seed entry',
					startedAt: '2026-06-01T09:00:00Z',
					endedAt: '2026-06-01T10:00:00Z'
				}
			})
		)
	);
	return {
		projectId: project.id as string,
		entryId: (entry.entry as Record<string, unknown>).id as string
	};
}

/** A catalogue of requests guaranteed to be rejected with a 4xx status against `seed()`'s state. */
function rejectedOperations(s: Seed): { name: string; run: () => Promise<Response> | Response }[] {
	return [
		{
			name: 'empty project name',
			run: () =>
				projectsPost(mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: '' } }))
		},
		{
			name: 'duplicate project name',
			run: () =>
				projectsPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/projects`,
						body: { name: 'Atomicity Seed' }
					})
				)
		},
		{
			name: 'project in use, delete rejected',
			run: () =>
				projectDelete(
					mockEvent({
						method: 'DELETE',
						url: `${BASE}/api/projects/${s.projectId}`,
						params: { id: s.projectId }
					})
				)
		},
		{
			name: 'ambiguous mode activity',
			run: () =>
				activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId: s.projectId,
							description: 'x',
							startedAt: '2026-06-01T13:00:00Z',
							endedAt: '2026-06-01T14:00:00Z',
							durationMinutes: 30
						}
					})
				)
		},
		{
			name: 'inverted interval activity',
			run: () =>
				activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId: s.projectId,
							description: 'x',
							startedAt: '2026-06-01T14:00:00Z',
							endedAt: '2026-06-01T13:00:00Z'
						}
					})
				)
		},
		{
			name: 'activity for a nonexistent project',
			run: () =>
				activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId: '00000000-0000-7000-8000-000000000000',
							description: 'x',
							startedAt: '2026-06-01T13:00:00Z',
							endedAt: '2026-06-01T14:00:00Z'
						}
					})
				)
		},
		{
			name: 'overlapping session',
			run: () =>
				sessionsPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/sessions`,
						body: { startedAt: '2026-06-01T09:00:00Z', endedAt: '2026-06-01T10:00:00Z' }
					})
				)
		},
		{
			name: 'patch a nonexistent activity',
			run: () =>
				activityPatch(
					mockEvent({
						method: 'PATCH',
						url: `${BASE}/api/activities/00000000-0000-7000-8000-000000000000`,
						params: { id: '00000000-0000-7000-8000-000000000000' },
						body: { description: 'renamed' }
					})
				)
		},
		{
			name: 'activity overlap',
			run: () =>
				activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId: s.projectId,
							description: 'x',
							startedAt: '2026-06-01T09:30:00Z',
							endedAt: '2026-06-01T10:30:00Z'
						}
					})
				)
		}
	];
}

describe('Property 10: Rejected writes leave no trace', () => {
	// Each iteration re-seeds and truncates the real database — far slower than an
	// in-memory property, hence the raised timeout and the reduced numRuns.
	it('every 4xx-rejected request leaves work_sessions, activity_entries, activity_segments, projects and idempotency_keys unchanged', async () => {
		await fc.assert(
			fc.asyncProperty(fc.nat({ max: 8 }), async (opIndex) => {
				await resetDb();
				const s = await seed();
				const ops = rejectedOperations(s);
				const op = ops[opIndex % ops.length];

				const before = await snapshotTables();
				const res = await op.run();
				expect(
					res.status,
					`operation '${op.name}' was expected to be rejected`
				).toBeGreaterThanOrEqual(400);
				expect(res.status).toBeLessThan(500);
				const after = await snapshotTables();

				expect(after, `operation '${op.name}' left a trace`).toBe(before);
			}),
			{ numRuns: 20 }
		);
	}, 60_000);
});

describe('Property 16: Every entry stays reachable', () => {
	it('an entry emptied by reconciliation is still returned by GET /api/activities, selected by its requested interval', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 0, max: 3 * 3600 }),
				fc.integer({ min: 0, max: 3 * 3600 }),
				async (offsetSeconds, shrinkSeconds) => {
					await resetDb();
					const project = await bodyOf(
						await projectsPost(
							mockEvent({
								method: 'POST',
								url: `${BASE}/api/projects`,
								body: { name: 'Reachability Seed' }
							})
						)
					);
					const sessionRes = await bodyOf(
						await sessionsPost(
							mockEvent({
								method: 'POST',
								url: `${BASE}/api/sessions`,
								body: { startedAt: '2026-06-10T08:00:00Z', endedAt: '2026-06-10T12:00:00Z' }
							})
						)
					);
					const sessionId = (sessionRes.session as Record<string, unknown>).id as string;

					const entryStart = new Date(
						new Date('2026-06-10T08:00:00Z').getTime() + offsetSeconds * 1000
					);
					const entryEnd = new Date(entryStart.getTime() + Math.max(shrinkSeconds, 61) * 1000);
					// Keep the requested interval inside the session's own span, so the entry
					// starts out fully covered before the session is deleted underneath it.
					if (entryEnd.getTime() > new Date('2026-06-10T12:00:00Z').getTime()) return;

					const entry = await bodyOf(
						await activitiesPost(
							mockEvent({
								method: 'POST',
								url: `${BASE}/api/activities`,
								body: {
									projectId: project.id,
									description: 'about to be orphaned',
									startedAt: entryStart.toISOString(),
									endedAt: entryEnd.toISOString()
								}
							})
						)
					);
					const entryId = (entry.entry as Record<string, unknown>).id as string;

					// Deleting the session removes all Tracked_Time under the entry, emptying it.
					const { DELETE: sessionDelete } =
						await import('../../../../src/routes/api/sessions/[id]/+server');
					await sessionDelete(
						mockEvent({
							method: 'DELETE',
							url: `${BASE}/api/sessions/${sessionId}`,
							params: { id: sessionId }
						})
					);

					const listed = await bodyOf(
						await activitiesGet(
							mockEvent({
								url: `${BASE}/api/activities?from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z`
							})
						)
					);
					const entries = listed.entries as Record<string, unknown>[];
					const found = entries.find((e) => e.id === entryId);
					expect(
						found,
						`entry ${entryId} was not returned by GET /api/activities after being emptied`
					).toBeDefined();
					expect(found?.orphaned).toBe(true);
				}
			),
			{ numRuns: 15 }
		);
	}, 60_000);
});
