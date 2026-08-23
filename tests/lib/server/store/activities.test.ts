import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import { createProject } from '../../../../src/lib/server/store/projects';
import {
	coveredIntervals,
	createEntry,
	entriesOverlapping,
	entryIdsForProject,
	orphanedEntriesOverlapping,
	replaceSegments
} from '../../../../src/lib/server/store/activities';

async function seedProject(name: string) {
	return withTx((tx) => createProject(tx, name));
}

describe('activities store', () => {
	it('creates an entry with several segments', async () => {
		const project = await seedProject('Activities Project A');
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: 'work',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-05T13:00:00Z'),
					requestedEndedAt: new Date('2026-07-05T16:00:00Z'),
					requestedDurationMinutes: null
				},
				[
					{ start: new Date('2026-07-05T13:00:00Z'), end: new Date('2026-07-05T14:48:00Z') },
					{ start: new Date('2026-07-05T15:12:00Z'), end: new Date('2026-07-05T16:00:00Z') }
				]
			)
		);
		expect(entry.segments).toHaveLength(2);
		expect(entry.orphaned).toBe(false);
		expect(entry.projectName).toBe('Activities Project A');
	});

	it('coveredIntervals excludes one entry when asked', async () => {
		const project = await seedProject('Activities Project B');
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-06T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-06T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-06T08:00:00Z'), end: new Date('2026-07-06T09:00:00Z') }]
			)
		);
		const window = {
			start: new Date('2026-07-06T00:00:00Z'),
			end: new Date('2026-07-07T00:00:00Z')
		};
		const withIt = await withTx((tx) => coveredIntervals(tx, window));
		const withoutIt = await withTx((tx) => coveredIntervals(tx, window, entry.id));
		expect(withIt.length).toBeGreaterThan(0);
		expect(withoutIt).toEqual([]);
	});

	it('replaceSegments swaps the stored segments', async () => {
		const project = await seedProject('Activities Project C');
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-07T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-07T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-07T08:00:00Z'), end: new Date('2026-07-07T09:00:00Z') }]
			)
		);
		await withTx((tx) =>
			replaceSegments(tx, entry.id, [
				{ start: new Date('2026-07-07T08:00:00Z'), end: new Date('2026-07-07T08:30:00Z') }
			])
		);
		const window = {
			start: new Date('2026-07-07T00:00:00Z'),
			end: new Date('2026-07-08T00:00:00Z')
		};
		const [refetched] = await withTx((tx) => entriesOverlapping(tx, window));
		expect(refetched.segments).toHaveLength(1);
		expect(refetched.segments[0].endedAt.toISOString()).toBe('2026-07-07T08:30:00.000Z');
	});

	it('entriesOverlapping orders by requestedStartedAt then createdAt', async () => {
		const project = await seedProject('Activities Project D');
		const window = {
			start: new Date('2026-07-08T00:00:00Z'),
			end: new Date('2026-07-09T00:00:00Z')
		};
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: 'second',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-08T14:00:00Z'),
					requestedEndedAt: new Date('2026-07-08T15:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-08T14:00:00Z'), end: new Date('2026-07-08T15:00:00Z') }]
			)
		);
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: 'first',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-08T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-08T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-08T08:00:00Z'), end: new Date('2026-07-08T09:00:00Z') }]
			)
		);
		const list = await withTx((tx) => entriesOverlapping(tx, window));
		expect(list.map((e) => e.description)).toEqual(['first', 'second']);
	});

	it('cascade delete removes segments; an emptied entry stays an Orphaned_Entry', async () => {
		const project = await seedProject('Activities Project E');
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: 'will be orphaned',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-09T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-09T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-09T08:00:00Z'), end: new Date('2026-07-09T09:00:00Z') }]
			)
		);
		await withTx((tx) => replaceSegments(tx, entry.id, []));
		const window = {
			start: new Date('2026-07-09T00:00:00Z'),
			end: new Date('2026-07-10T00:00:00Z')
		};
		const orphans = await withTx((tx) => orphanedEntriesOverlapping(tx, window));
		expect(orphans.some((o) => o.id === entry.id && o.orphaned)).toBe(true);
	});

	it('entryIdsForProject returns every entry referencing a project', async () => {
		const project = await seedProject('Activities Project F');
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-10T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-10T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-10T08:00:00Z'), end: new Date('2026-07-10T09:00:00Z') }]
			)
		);
		const ids = await withTx((tx) => entryIdsForProject(tx, project.id));
		expect(ids).toContain(entry.id);
	});
});
