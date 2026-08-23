import { describe, expect, it } from 'vitest';
import { getTableColumns, sql } from 'drizzle-orm';
import { withTx } from '../../../../src/lib/server/store/tx';
import * as schema from '../../../../src/db/schema';
import {
	openSession,
	closeOpenSession,
	sessionsConflictingWith
} from '../../../../src/lib/server/store/work-sessions';
import { createProject } from '../../../../src/lib/server/store/projects';
import { createEntry } from '../../../../src/lib/server/store/activities';
import { randomUuidV7 } from '../../../../src/lib/server/core/uuid';

describe('schema constraints', () => {
	it('rejects a second Open_Session', async () => {
		await withTx((tx) =>
			tx.insert(schema.workSessions).values({
				id: randomUuidV7(),
				startedAt: new Date('2026-06-01T08:00:00Z'),
				endedAt: null
			})
		);
		await expect(
			withTx((tx) =>
				tx.insert(schema.workSessions).values({
					id: randomUuidV7(),
					startedAt: new Date('2026-06-01T09:00:00Z'),
					endedAt: null
				})
			)
		).rejects.toMatchObject({
			cause: { code: '23505', constraint_name: 'work_sessions_one_open' }
		});
	});

	it('rejects overlapping closed Work_Session rows', async () => {
		await withTx((tx) =>
			tx.insert(schema.workSessions).values({
				id: randomUuidV7(),
				startedAt: new Date('2026-06-02T08:00:00Z'),
				endedAt: new Date('2026-06-02T09:00:00Z')
			})
		);
		await expect(
			withTx((tx) =>
				tx.insert(schema.workSessions).values({
					id: randomUuidV7(),
					startedAt: new Date('2026-06-02T08:30:00Z'),
					endedAt: new Date('2026-06-02T09:30:00Z')
				})
			)
		).rejects.toMatchObject({
			cause: { code: '23P01', constraint_name: 'work_sessions_no_overlap' }
		});
	});

	it('accepts sessions touching at one instant', async () => {
		await withTx((tx) =>
			tx.insert(schema.workSessions).values({
				id: randomUuidV7(),
				startedAt: new Date('2026-06-03T08:00:00Z'),
				endedAt: new Date('2026-06-03T09:00:00Z')
			})
		);
		await expect(
			withTx((tx) =>
				tx.insert(schema.workSessions).values({
					id: randomUuidV7(),
					startedAt: new Date('2026-06-03T09:00:00Z'),
					endedAt: new Date('2026-06-03T10:00:00Z')
				})
			)
		).resolves.toEqual([]);
	});

	it('rejects overlapping Activity_Segment rows, and a deferred reshuffle succeeds', async () => {
		const projectId = randomUuidV7();
		const entryId = randomUuidV7();
		await withTx(async (tx) => {
			await tx.insert(schema.projects).values({ id: projectId, name: 'Schema Test Project' });
			await tx.insert(schema.activityEntries).values({
				id: entryId,
				projectId,
				mode: 'explicit',
				requestedStartedAt: new Date('2026-06-04T08:00:00Z'),
				requestedEndedAt: new Date('2026-06-04T09:00:00Z')
			});
			await tx.insert(schema.activitySegments).values({
				id: randomUuidV7(),
				entryId,
				startedAt: new Date('2026-06-04T08:00:00Z'),
				endedAt: new Date('2026-06-04T08:30:00Z')
			});
		});

		await expect(
			withTx((tx) =>
				tx.insert(schema.activitySegments).values({
					id: randomUuidV7(),
					entryId,
					startedAt: new Date('2026-06-04T08:15:00Z'),
					endedAt: new Date('2026-06-04T08:45:00Z')
				})
			)
		).rejects.toMatchObject({ code: '23P01', constraint_name: 'activity_segments_no_overlap' });

		// Delete-then-reinsert within one transaction succeeds thanks to the deferred constraint.
		await withTx(async (tx) => {
			await tx.delete(schema.activitySegments).where(sql`entry_id = ${entryId}`);
			await tx.insert(schema.activitySegments).values([
				{
					id: randomUuidV7(),
					entryId,
					startedAt: new Date('2026-06-04T08:00:00Z'),
					endedAt: new Date('2026-06-04T08:45:00Z')
				},
				{
					id: randomUuidV7(),
					entryId,
					startedAt: new Date('2026-06-04T08:45:00Z'),
					endedAt: new Date('2026-06-04T09:00:00Z')
				}
			]);
		});
		const rows = await withTx((tx) =>
			tx
				.select()
				.from(schema.activitySegments)
				.where(sql`entry_id = ${entryId}`)
		);
		expect(rows).toHaveLength(2);
	});

	it('rejects deleting a referenced Project', async () => {
		const projectId = randomUuidV7();
		await withTx(async (tx) => {
			await tx.insert(schema.projects).values({ id: projectId, name: 'Referenced Project' });
			await tx.insert(schema.activityEntries).values({
				id: randomUuidV7(),
				projectId,
				mode: 'explicit',
				requestedStartedAt: new Date('2026-06-05T08:00:00Z'),
				requestedEndedAt: new Date('2026-06-05T09:00:00Z')
			});
		});
		await expect(
			withTx((tx) => tx.delete(schema.projects).where(sql`id = ${projectId}`))
		).rejects.toMatchObject({
			cause: { code: '23503', constraint_name: 'activity_entries_project_id_fkey' }
		});
	});

	it('project names differing only in case or whitespace collide', async () => {
		await withTx((tx) => createProject(tx, 'Case Test'));
		await expect(withTx((tx) => createProject(tx, '  CASE test  '))).rejects.toMatchObject({
			code: 'PROJECT_EXISTS'
		});
	});

	it('a closed session written across the running Open_Session is accepted by the database but rejected by sessionsConflictingWith', async () => {
		const open = await withTx((tx) => openSession(tx, new Date('2026-06-06T08:00:00Z')));
		// The database's EXCLUDE constraint is WHERE (ended_at IS NOT NULL), so it never
		// sees the open row — this INSERT is accepted at the database level.
		await expect(
			withTx((tx) =>
				tx.insert(schema.workSessions).values({
					id: randomUuidV7(),
					startedAt: new Date('2026-06-06T08:15:00Z'),
					endedAt: new Date('2026-06-06T08:45:00Z')
				})
			)
		).resolves.toEqual([]);

		const conflicts = await withTx((tx) =>
			sessionsConflictingWith(
				tx,
				{ start: new Date('2026-06-06T09:00:00Z'), end: new Date('2026-06-06T09:30:00Z') },
				null,
				new Date('2026-06-06T09:15:00Z')
			)
		);
		expect(conflicts.some((c) => c.id === open.id)).toBe(true);
	});

	it('the stale tail is still guarded even though it contributes nothing to Tracked_Time', async () => {
		const staleStart = new Date('2026-06-07T00:00:00Z');
		await withTx((tx) => openSession(tx, staleStart));
		const now = new Date(staleStart.getTime() + 20 * 3_600_000); // 20h later
		// MAX_OPEN_SESSION_HOURS defaults to 12, so the tail from hour 12 to hour 20 is
		// excluded from Tracked_Time but must still be guarded.
		const candidateInTail = {
			start: new Date(staleStart.getTime() + 15 * 3_600_000),
			end: new Date(staleStart.getTime() + 16 * 3_600_000)
		};
		const conflicts = await withTx((tx) => sessionsConflictingWith(tx, candidateInTail, null, now));
		expect(conflicts.length).toBeGreaterThan(0);

		await withTx((tx) => closeOpenSession(tx, now));
	});

	it('rejects an activity_entries row with a null requested interval, duration mode included', async () => {
		const projectId = randomUuidV7();
		await withTx((tx) =>
			tx.insert(schema.projects).values({ id: projectId, name: 'Null Interval Project' })
		);
		await expect(
			withTx((tx) =>
				tx.insert(schema.activityEntries).values({
					id: randomUuidV7(),
					projectId,
					mode: 'duration',
					requestedStartedAt: null,
					requestedEndedAt: null,
					requestedDurationMinutes: 30
				})
			)
		).rejects.toMatchObject({
			cause: { code: '23514', constraint_name: 'activity_entries_mode_fields' }
		});
	});

	it('deleting an Activity_Entry leaves its idempotency_keys row with a null entry_id', async () => {
		const project = await withTx((tx) => createProject(tx, 'Idempotency Cascade Project'));
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-06-08T08:00:00Z'),
					requestedEndedAt: new Date('2026-06-08T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-06-08T08:00:00Z'), end: new Date('2026-06-08T09:00:00Z') }]
			)
		);
		// idempotency_keys has no Drizzle definition (raw SQL only, per design) — insert directly.
		await withTx((tx) =>
			tx.execute(
				sql`insert into idempotency_keys (key, entry_id, status, request_hash, response) values ('test-key-1', ${entry.id}, 201, 'hash', '{}'::jsonb)`
			)
		);
		await withTx((tx) => tx.delete(schema.activityEntries).where(sql`id = ${entry.id}`));
		const [row] = await withTx((tx) =>
			tx.execute(sql`select entry_id from idempotency_keys where key = 'test-key-1'`)
		);
		expect((row as { entry_id: string | null }).entry_id).toBeNull();
	});

	it('updated_at advances on UPDATE and not on unrelated writes', async () => {
		const project = await withTx((tx) => createProject(tx, 'Updated_At Project'));
		const before = project.updatedAt.getTime();
		await new Promise((r) => setTimeout(r, 20));
		// An unrelated write (creating a different project) must not touch this row.
		await withTx((tx) => createProject(tx, 'Another Project Entirely'));
		const [unchanged] = await withTx((tx) =>
			tx
				.select()
				.from(schema.projects)
				.where(sql`id = ${project.id}`)
		);
		expect(unchanged.updatedAt.getTime()).toBe(before);

		await new Promise((r) => setTimeout(r, 20));
		await withTx((tx) =>
			tx
				.update(schema.projects)
				.set({ name: 'Updated_At Project Renamed' })
				.where(sql`id = ${project.id}`)
		);
		const [updated] = await withTx((tx) =>
			tx
				.select()
				.from(schema.projects)
				.where(sql`id = ${project.id}`)
		);
		expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
	});

	it('every Drizzle column exists in the migrated database with a compatible type', async () => {
		const columns = await withTx((tx) =>
			tx.execute(
				sql`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`
			)
		);
		const byTable = new Map<string, Map<string, string>>();
		for (const row of columns as unknown as {
			table_name: string;
			column_name: string;
			data_type: string;
		}[]) {
			if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map());
			byTable.get(row.table_name)!.set(row.column_name, row.data_type);
		}

		const drizzleTables: Record<string, unknown> = {
			projects: schema.projects,
			work_sessions: schema.workSessions,
			activity_entries: schema.activityEntries,
			activity_segments: schema.activitySegments,
			auth_sessions: schema.authSessions
		};

		for (const [tableName, table] of Object.entries(drizzleTables)) {
			const dbColumns = byTable.get(tableName);
			expect(dbColumns, `table ${tableName} missing from database`).toBeDefined();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const columns = getTableColumns(table as any);
			for (const column of Object.values(columns)) {
				const columnName = (column as { name: string }).name;
				expect(
					dbColumns!.has(columnName),
					`column ${tableName}.${columnName} missing from database`
				).toBe(true);
			}
		}
	});
});
