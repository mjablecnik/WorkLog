import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { withTx } from '../../../../src/lib/server/store/tx';
import { createProject, updateProject } from '../../../../src/lib/server/store/projects';
import {
	coveredIntervals,
	createEntry,
	entriesOverlapping,
	entryIdsForProject,
	mostRecentWorkEntry,
	orphanedEntriesOverlapping,
	replaceSegments
} from '../../../../src/lib/server/store/activities';

async function seedProject(name: string, billable = true) {
	return withTx((tx) => createProject(tx, name, billable));
}

let seq = 0;
function nextInterval(): { start: Date; end: Date } {
	// Every generated entry needs its own, non-overlapping interval so the property
	// test below never collides with the activity_segments_no_overlap constraint.
	seq += 1;
	const start = new Date(Date.UTC(2026, 8, 1, 0, 0, 0) + seq * 3_600_000);
	return { start, end: new Date(start.getTime() + 30 * 60_000) };
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

	it('a billable project derives category paid', async () => {
		const project = await seedProject('Category Paid Project', true);
		const { start, end } = nextInterval();
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: start,
					requestedEndedAt: end,
					requestedDurationMinutes: null
				},
				[{ start, end }]
			)
		);
		expect(entry.category).toBe('paid');
	});

	it('a non-billable project derives category unpaid', async () => {
		const project = await seedProject('Category Unpaid Project', false);
		const { start, end } = nextInterval();
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: start,
					requestedEndedAt: end,
					requestedDurationMinutes: null
				},
				[{ start, end }]
			)
		);
		expect(entry.category).toBe('unpaid');
	});

	it('a null project derives category relax, with projectId/projectName/colorIndex all null', async () => {
		const { start, end } = nextInterval();
		const entry = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: null,
					description: 'resting',
					mode: 'explicit',
					requestedStartedAt: start,
					requestedEndedAt: end,
					requestedDurationMinutes: null
				},
				[{ start, end }]
			)
		);
		expect(entry.category).toBe('relax');
		expect(entry.projectId).toBeNull();
		expect(entry.projectName).toBeNull();
		expect(entry.colorIndex).toBeNull();
	});

	it('creating a Leisure_Entry (projectId: null) and reading it back hydrates category relax', async () => {
		const { start, end } = nextInterval();
		const created = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: null,
					description: 'reading',
					mode: 'explicit',
					requestedStartedAt: start,
					requestedEndedAt: end,
					requestedDurationMinutes: null
				},
				[{ start, end }]
			)
		);
		const window = { start: new Date(start.getTime() - 60_000), end: new Date(end.getTime() + 60_000) };
		const [refetched] = await withTx((tx) => entriesOverlapping(tx, window));
		expect(refetched.id).toBe(created.id);
		expect(refetched.category).toBe('relax');
		expect(refetched.projectId).toBeNull();
		expect(refetched.projectName).toBeNull();
		expect(refetched.colorIndex).toBeNull();
	});

	it('Property 1: category is a pure function of stored state, including after billable is flipped', async () => {
		const project = await seedProject('Category Flip Project', true);
		await fc.assert(
			fc.asyncProperty(fc.boolean(), async (billable) => {
				await withTx((tx) => updateProject(tx, project.id, { billable }));
				const { start, end } = nextInterval();
				const entry = await withTx((tx) =>
					createEntry(
						tx,
						{
							projectId: project.id,
							description: '',
							mode: 'explicit',
							requestedStartedAt: start,
							requestedEndedAt: end,
							requestedDurationMinutes: null
						},
						[{ start, end }]
					)
				);
				expect(entry.category).toBe(billable ? 'paid' : 'unpaid');

				// Flipping billable again retroactively reclassifies the SAME entry on the
				// next read (Requirement 1.6) — never fixed at creation time.
				await withTx((tx) => updateProject(tx, project.id, { billable: !billable }));
				const window = { start: new Date(start.getTime() - 1000), end: new Date(end.getTime() + 1000) };
				const [reread] = await withTx((tx) => entriesOverlapping(tx, window));
				const reheredEntry = reread.id === entry.id ? reread : entry;
				expect(reheredEntry.category).toBe(!billable ? 'paid' : 'unpaid');
			}),
			{ numRuns: 10 }
		);
	});

	it('mostRecentWorkEntry returns null when only Leisure_Entry rows exist', async () => {
		const { start, end } = nextInterval();
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: null,
					description: 'only leisure',
					mode: 'explicit',
					requestedStartedAt: start,
					requestedEndedAt: end,
					requestedDurationMinutes: null
				},
				[{ start, end }]
			)
		);
		expect(await withTx((tx) => mostRecentWorkEntry(tx))).toBeNull();
	});

	it('mostRecentWorkEntry skips a more recent Leisure_Entry', async () => {
		const soloLeisureWindow = nextInterval();
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: null,
					description: 'only leisure so far',
					mode: 'explicit',
					requestedStartedAt: soloLeisureWindow.start,
					requestedEndedAt: soloLeisureWindow.end,
					requestedDurationMinutes: null
				},
				[soloLeisureWindow]
			)
		);
		const project = await seedProject('Most Recent Work Entry Project');
		const workWindow = nextInterval();
		const work = await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: 'work',
					mode: 'explicit',
					requestedStartedAt: workWindow.start,
					requestedEndedAt: workWindow.end,
					requestedDurationMinutes: null
				},
				[workWindow]
			)
		);
		const leisureWindow = nextInterval();
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: null,
					description: 'more recent leisure',
					mode: 'explicit',
					requestedStartedAt: leisureWindow.start,
					requestedEndedAt: leisureWindow.end,
					requestedDurationMinutes: null
				},
				[leisureWindow]
			)
		);
		const mostRecent = await withTx((tx) => mostRecentWorkEntry(tx));
		expect(mostRecent).not.toBeNull();
		expect(mostRecent!.id).toBe(work.id);
		expect(mostRecent!.category).not.toBe('relax');
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
