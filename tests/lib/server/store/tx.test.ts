import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { translateConstraintError, withReadTx, withTx } from '../../../../src/lib/server/store/tx';
import * as schema from '../../../../src/db/schema';
import { randomUuidV7 } from '../../../../src/lib/server/core/uuid';

describe('tx', () => {
	it('commits on success', async () => {
		const id = randomUuidV7();
		await withTx((tx) => tx.insert(schema.projects).values({ id, name: 'Tx Commit Project' }));
		const [row] = await withReadTx((tx) =>
			tx
				.select()
				.from(schema.projects)
				.where(sql`id = ${id}`)
		);
		expect(row).toBeDefined();
	});

	it('rolls back on throw', async () => {
		const id = randomUuidV7();
		await expect(
			withTx(async (tx) => {
				await tx.insert(schema.projects).values({ id, name: 'Tx Rollback Project' });
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		const [row] = await withReadTx((tx) =>
			tx
				.select()
				.from(schema.projects)
				.where(sql`id = ${id}`)
		);
		expect(row).toBeUndefined();
	});

	it('rolls back on dryRun while returning the value', async () => {
		const id = randomUuidV7();
		const result = await withTx(
			async (tx) => {
				await tx.insert(schema.projects).values({ id, name: 'Tx DryRun Project' });
				return 'the-value';
			},
			{ dryRun: true }
		);
		expect(result).toBe('the-value');
		const [row] = await withReadTx((tx) =>
			tx
				.select()
				.from(schema.projects)
				.where(sql`id = ${id}`)
		);
		expect(row).toBeUndefined();
	});

	it('a dryRun surfaces a deferred-constraint violation exactly as a committed write would', async () => {
		const projectId = randomUuidV7();
		const entryId = randomUuidV7();
		await withTx(async (tx) => {
			await tx.insert(schema.projects).values({ id: projectId, name: 'Tx Deferred Project' });
			await tx.insert(schema.activityEntries).values({
				id: entryId,
				projectId,
				mode: 'explicit',
				requestedStartedAt: new Date('2026-07-12T08:00:00Z'),
				requestedEndedAt: new Date('2026-07-12T09:00:00Z')
			});
		});

		await expect(
			withTx(
				async (tx) => {
					await tx.insert(schema.activitySegments).values([
						{
							id: randomUuidV7(),
							entryId,
							startedAt: new Date('2026-07-12T08:00:00Z'),
							endedAt: new Date('2026-07-12T08:30:00Z')
						},
						{
							id: randomUuidV7(),
							entryId,
							startedAt: new Date('2026-07-12T08:15:00Z'),
							endedAt: new Date('2026-07-12T08:45:00Z')
						}
					]);
				},
				{ dryRun: true }
			)
		).rejects.toBeDefined();
	});

	it('withReadTx does not take the exclusive lock', async () => {
		let sawLockDuringWrite: boolean;
		const writeP = withTx(async () => {
			await new Promise((r) => setTimeout(r, 200));
		});
		await new Promise((r) => setTimeout(r, 50));
		const [row] = await withReadTx((tx) =>
			tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`)
		);
		sawLockDuringWrite = (row as { n: number }).n > 0;
		await writeP;
		expect(sawLockDuringWrite).toBe(true);

		let sawLockDuringRead: boolean;
		const readP = withReadTx(async () => {
			await new Promise((r) => setTimeout(r, 200));
		});
		await new Promise((r) => setTimeout(r, 50));
		const [row2] = await withReadTx((tx) =>
			tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`)
		);
		sawLockDuringRead = (row2 as { n: number }).n > 0;
		await readP;
		expect(sawLockDuringRead).toBe(false);
	});

	it('translateConstraintError maps 23503 on activity_entries_project_id_fkey by op', () => {
		const err = { code: '23503', constraint_name: 'activity_entries_project_id_fkey' };
		expect(translateConstraintError(err, 'delete-project')?.code).toBe('PROJECT_IN_USE');
		expect(translateConstraintError(err, 'write-entry')?.code).toBe('VALIDATION_ERROR');
	});
});
