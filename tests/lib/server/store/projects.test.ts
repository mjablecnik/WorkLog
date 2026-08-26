import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import { createEntry } from '../../../../src/lib/server/store/activities';
import {
	createProject,
	deleteProject,
	listProjects,
	updateProject
} from '../../../../src/lib/server/store/projects';

describe('projects store', () => {
	it('assigns colour indices, reuses after delete, keeps them stable across rename and archive', async () => {
		const p1 = await withTx((tx) => createProject(tx, 'Colour Project 1'));
		const p2 = await withTx((tx) => createProject(tx, 'Colour Project 2'));
		expect(p2.colorIndex).not.toBe(p1.colorIndex);

		const renamed = await withTx((tx) =>
			updateProject(tx, p1.id, { name: 'Colour Project 1 Renamed' })
		);
		expect(renamed.colorIndex).toBe(p1.colorIndex);

		const archived = await withTx((tx) => updateProject(tx, p1.id, { archived: true }));
		expect(archived.colorIndex).toBe(p1.colorIndex);
		expect(archived.archived).toBe(true);

		const unarchived = await withTx((tx) => updateProject(tx, p1.id, { archived: false }));
		expect(unarchived.colorIndex).toBe(p1.colorIndex);
		expect(unarchived.archived).toBe(false);
	});

	it('the ninth project takes the least-used index, the tenth the next, deterministically', async () => {
		const created = [];
		for (let i = 0; i < 10; i++) {
			created.push(await withTx((tx) => createProject(tx, `Deterministic Project ${i}`)));
		}
		const indices = created.map((p) => p.colorIndex);
		expect(new Set(indices.slice(0, 8)).size).toBe(8); // first eight take every slot once
		expect(indices[8]).toBe(0); // ninth: all tied at 1, lowest wins
		expect(indices[9]).toBe(1); // tenth: index 0 now has 2, index 1 still has 1
	});

	it('PATCH stores a colorIndex another project already holds', async () => {
		const a = await withTx((tx) => createProject(tx, 'Shared Colour A'));
		const b = await withTx((tx) => createProject(tx, 'Shared Colour B'));
		const updated = await withTx((tx) => updateProject(tx, b.id, { colorIndex: a.colorIndex }));
		expect(updated.colorIndex).toBe(a.colorIndex);
	});

	it('listProjects excludes archived by default and includes them on request', async () => {
		const p = await withTx((tx) => createProject(tx, 'Listing Project'));
		await withTx((tx) => updateProject(tx, p.id, { archived: true }));
		const withoutArchived = await withTx((tx) => listProjects(tx, false));
		const withArchived = await withTx((tx) => listProjects(tx, true));
		expect(withoutArchived.some((x) => x.id === p.id)).toBe(false);
		expect(withArchived.some((x) => x.id === p.id)).toBe(true);
	});

	it('PROJECT_IN_USE carries the blocking Activity_Entry ids', async () => {
		const p = await withTx((tx) => createProject(tx, 'In Use Project'));
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: p.id,
					description: 'blocks delete',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-11T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-11T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-11T08:00:00Z'), end: new Date('2026-07-11T09:00:00Z') }]
			)
		);
		type CaughtError = {
			code?: string;
			details?: { entryCount?: number; entries?: { entryId: string }[] };
		};
		let caught: CaughtError | null = null;
		try {
			await withTx((tx) => deleteProject(tx, p.id));
		} catch (err) {
			caught = err as CaughtError;
		}
		expect(caught?.code).toBe('PROJECT_IN_USE');
		expect(caught?.details?.entryCount).toBe(1);
		expect(caught?.details?.entries?.[0].entryId).toBe(entry.id);
	});

	it('delete succeeds when unused', async () => {
		const p = await withTx((tx) => createProject(tx, 'Unused Project'));
		await withTx((tx) => deleteProject(tx, p.id));
		const list = await withTx((tx) => listProjects(tx, true));
		expect(list.some((x) => x.id === p.id)).toBe(false);
	});

	it('a project created without a billable argument defaults to true', async () => {
		const p = await withTx((tx) => createProject(tx, 'Billable Default'));
		expect(p.billable).toBe(true);
	});

	it('create/patch with an explicit billable value', async () => {
		const unbillable = await withTx((tx) => createProject(tx, 'Unbillable Create', false));
		expect(unbillable.billable).toBe(false);

		const billable = await withTx((tx) => createProject(tx, 'Billable Create', true));
		expect(billable.billable).toBe(true);

		const flipped = await withTx((tx) => updateProject(tx, billable.id, { billable: false }));
		expect(flipped.billable).toBe(false);
	});

	it('a patch that leaves billable absent leaves it unchanged', async () => {
		const p = await withTx((tx) => createProject(tx, 'Billable Untouched', false));
		const renamed = await withTx((tx) => updateProject(tx, p.id, { name: 'Billable Untouched Renamed' }));
		expect(renamed.billable).toBe(false);
	});

	it('renaming, archiving and recolouring never change billable', async () => {
		const p = await withTx((tx) => createProject(tx, 'Billable Stable', false));
		const renamed = await withTx((tx) => updateProject(tx, p.id, { name: 'Billable Stable Renamed' }));
		expect(renamed.billable).toBe(false);
		const archived = await withTx((tx) => updateProject(tx, p.id, { archived: true }));
		expect(archived.billable).toBe(false);
		const unarchived = await withTx((tx) => updateProject(tx, p.id, { archived: false }));
		expect(unarchived.billable).toBe(false);
		const recoloured = await withTx((tx) => updateProject(tx, p.id, { colorIndex: 3 }));
		expect(recoloured.billable).toBe(false);
	});
});
