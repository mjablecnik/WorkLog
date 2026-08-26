import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import { createProject } from '../../../../src/lib/server/store/projects';
import { openSession, closeOpenSession } from '../../../../src/lib/server/store/work-sessions';
import {
	createActivity,
	patchActivity,
	deleteActivity
} from '../../../../src/lib/server/services/activities';

function iso(s: string): Date {
	return new Date(s);
}

async function seedFrame() {
	const p = await withTx((tx) => createProject(tx, 'Scratch Project'));
	await withTx((tx) =>
		Promise.all([
			openSession(tx, iso('2026-06-01T08:00:00Z')).then(() =>
				closeOpenSession(tx, iso('2026-06-01T14:48:00Z'))
			)
		])
	);
	await withTx((tx) => openSession(tx, iso('2026-06-01T15:12:00Z')));
	await withTx((tx) => closeOpenSession(tx, iso('2026-06-01T18:00:00Z')));
	return p;
}

describe('activities service (scratch verification)', () => {
	it('explicit mode clips across the break into two segments', async () => {
		const p = await seedFrame();
		const res = await createActivity({
			projectId: p.id,
			description: 'explicit test',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T16:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(
			res.entry.segments.map((s) => [s.startedAt.toISOString(), s.endedAt.toISOString()])
		).toEqual([
			['2026-06-01T13:00:00.000Z', '2026-06-01T14:48:00.000Z'],
			['2026-06-01T15:12:00.000Z', '2026-06-01T16:00:00.000Z']
		]);
		expect(res.discarded.map((d) => [d.start.toISOString(), d.end.toISOString()])).toEqual([
			['2026-06-01T14:48:00.000Z', '2026-06-01T15:12:00.000Z']
		]);
		expect(res.anchor).toBeNull();
	});

	it('duration mode anchored at 14:00 for 2h totals 120 minutes', async () => {
		const p = await seedFrame();
		const res = await createActivity({
			projectId: p.id,
			description: 'duration test',
			date: '2026-06-01',
			startedAt: iso('2026-06-01T14:00:00Z'),
			durationMinutes: 120,
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		const totalMs = res.entry.segments.reduce(
			(sum, s) => sum + (s.endedAt.getTime() - s.startedAt.getTime()),
			0
		);
		expect(totalMs).toBe(120 * 60_000);
		expect(res.unplacedMinutes).toBe(0);
		expect(res.anchor?.at).toBe('2026-06-01T14:00:00.000Z');
	});

	it('open mode with no explicit start picks up after the last segment', async () => {
		const p = await seedFrame();
		await createActivity({
			projectId: p.id,
			description: 'first',
			startedAt: iso('2026-06-01T08:00:00Z'),
			endedAt: iso('2026-06-01T09:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		const res = await createActivity({
			projectId: p.id,
			description: 'open test',
			date: '2026-06-01',
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(res.anchor?.source).toBe('last-segment');
		expect(res.entry.mode).toBe('open');
	});

	it('ACTIVITY_OVERLAP when the interval overlaps another entry', async () => {
		const p = await seedFrame();
		await createActivity({
			projectId: p.id,
			description: 'first',
			startedAt: iso('2026-06-01T08:00:00Z'),
			endedAt: iso('2026-06-01T09:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		await expect(
			createActivity({
				projectId: p.id,
				description: 'second',
				startedAt: iso('2026-06-01T08:30:00Z'),
				endedAt: iso('2026-06-01T09:30:00Z'),
				untrackedPolicy: 'clip',
				dryRun: false,
				now: iso('2026-06-01T19:00:00Z')
			})
		).rejects.toMatchObject({ code: 'ACTIVITY_OVERLAP' });
	});

	it('NOTHING_TO_LOG (no-tracked-time) for a request entirely in a break', async () => {
		const p = await seedFrame();
		await expect(
			createActivity({
				projectId: p.id,
				description: 'in the break',
				startedAt: iso('2026-06-01T14:50:00Z'),
				endedAt: iso('2026-06-01T15:00:00Z'),
				untrackedPolicy: 'clip',
				dryRun: false,
				now: iso('2026-06-01T19:00:00Z')
			})
		).rejects.toMatchObject({ code: 'NOTHING_TO_LOG', details: { reason: 'no-tracked-time' } });
	});

	it('dryRun leaves the database untouched and returns the same shape', async () => {
		const p = await seedFrame();
		const preview = await createActivity({
			projectId: p.id,
			description: 'preview test',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T14:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: true,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(preview.dryRun).toBe(true);
		expect(preview.entry.segments.length).toBe(1);

		// nothing should have actually been written
		const real = await createActivity({
			projectId: p.id,
			description: 'preview test 2',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T14:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(real.dryRun).toBe(false);
	});

	it('idempotency key replays the same response and creates nothing twice', async () => {
		const p = await seedFrame();
		const args = {
			projectId: p.id,
			description: 'idem test',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T14:00:00Z'),
			untrackedPolicy: 'clip' as const,
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z'),
			idempotencyKey: 'scratch-key-1'
		};
		const first = await createActivity(args);
		const second = await createActivity(args);
		expect(second.entry.id).toBe(first.entry.id);
	});

	it('idempotency key reused with a different body is rejected', async () => {
		const p = await seedFrame();
		await createActivity({
			projectId: p.id,
			description: 'idem test A',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T14:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z'),
			idempotencyKey: 'scratch-key-2'
		});
		await expect(
			createActivity({
				projectId: p.id,
				description: 'idem test B (different)',
				startedAt: iso('2026-06-01T13:00:00Z'),
				endedAt: iso('2026-06-01T14:00:00Z'),
				untrackedPolicy: 'clip',
				dryRun: false,
				now: iso('2026-06-01T19:00:00Z'),
				idempotencyKey: 'scratch-key-2'
			})
		).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
	});

	it('patch meta-only does not re-clip', async () => {
		const p = await seedFrame();
		const created = await createActivity({
			projectId: p.id,
			description: 'meta patch test',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T14:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		const patched = await patchActivity({
			id: created.entry.id,
			description: 'renamed',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(patched.entry.description).toBe('renamed');
		expect(patched.entry.segments).toEqual(created.entry.segments);
	});

	it('patch replacing the interval re-clips and rescues an orphan', async () => {
		const p = await seedFrame();
		const created = await createActivity({
			projectId: p.id,
			description: 'orphan candidate',
			startedAt: iso('2026-06-01T08:00:00Z'),
			endedAt: iso('2026-06-01T08:30:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		// Rewrite the interval to somewhere else in the tracked frame.
		const patched = await patchActivity({
			id: created.entry.id,
			startedAt: iso('2026-06-01T09:00:00Z'),
			endedAt: iso('2026-06-01T10:00:00Z'),
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(patched.entry.mode).toBe('explicit');
		expect(patched.entry.orphaned).toBe(false);
		expect(patched.entry.segments[0].startedAt.toISOString()).toBe('2026-06-01T09:00:00.000Z');
	});

	it('patch that yields nothing leaves the entry unchanged and throws NOTHING_TO_LOG', async () => {
		const p = await seedFrame();
		const created = await createActivity({
			projectId: p.id,
			description: 'will fail rescue',
			startedAt: iso('2026-06-01T08:00:00Z'),
			endedAt: iso('2026-06-01T08:30:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		await expect(
			patchActivity({
				id: created.entry.id,
				startedAt: iso('2026-06-01T14:50:00Z'),
				endedAt: iso('2026-06-01T15:00:00Z'),
				dryRun: false,
				now: iso('2026-06-01T19:00:00Z')
			})
		).rejects.toMatchObject({ code: 'NOTHING_TO_LOG' });

		// entry must be untouched
		const { getEntry } = await import('../../../../src/lib/server/store/activities');
		const stillThere = await withTx((tx) => getEntry(tx, created.entry.id));
		expect(stillThere?.requestedStartedAt.toISOString()).toBe('2026-06-01T08:00:00.000Z');
	});

	it('delete removes the entry, dry run leaves it in place', async () => {
		const p = await seedFrame();
		const created = await createActivity({
			projectId: p.id,
			description: 'to delete',
			startedAt: iso('2026-06-01T13:00:00Z'),
			endedAt: iso('2026-06-01T14:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		const preview = await deleteActivity({ id: created.entry.id, dryRun: true });
		expect(preview?.dryRun).toBe(true);

		const { getEntry } = await import('../../../../src/lib/server/store/activities');
		const stillThere = await withTx((tx) => getEntry(tx, created.entry.id));
		expect(stillThere).not.toBeNull();

		await deleteActivity({ id: created.entry.id, dryRun: false });
		const gone = await withTx((tx) => getEntry(tx, created.entry.id));
		expect(gone).toBeNull();
	});

	it('extend policy creates a session and clips against it', async () => {
		const p = await seedFrame();
		const res = await createActivity({
			projectId: p.id,
			description: 'extend test',
			startedAt: iso('2026-06-01T07:00:00Z'),
			endedAt: iso('2026-06-01T07:30:00Z'),
			untrackedPolicy: 'extend',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(res.extendedSessions.length).toBeGreaterThan(0);
		expect(res.entry.segments.length).toBe(1);
		expect(res.entry.segments[0].startedAt.toISOString()).toBe('2026-06-01T07:00:00.000Z');
	});

	// --- 003-worklog-time-categories, task 5.6: unrestrictedTracked, the day-start
	// anchor fallback, and crossesProjectBoundary — exercised through the public
	// createActivity/patchActivity functions, since the helpers themselves are
	// module-private.

	it('a Leisure_Entry in Explicit_Mode ignores Tracked_Time entirely — no projectId, no session needed', async () => {
		const res = await createActivity({
			description: 'leisure explicit',
			startedAt: iso('2026-06-20T20:00:00Z'),
			endedAt: iso('2026-06-20T22:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-20T23:00:00Z')
		});
		expect(res.entry.projectId).toBeNull();
		expect(res.entry.category).toBe('relax');
		expect(res.discarded).toEqual([]);
		expect(res.entry.segments).toHaveLength(1);
		expect(res.entry.segments[0].startedAt.toISOString()).toBe('2026-06-20T20:00:00.000Z');
		expect(res.entry.segments[0].endedAt.toISOString()).toBe('2026-06-20T22:00:00.000Z');
	});

	it('a Leisure_Entry in Duration_Mode uses the whole Target_Day as its Unrestricted_Window', async () => {
		const res = await createActivity({
			description: 'leisure duration',
			date: '2026-06-21',
			startedAt: iso('2026-06-21T09:00:00Z'),
			durationMinutes: 90,
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-21T23:00:00Z')
		});
		expect(res.entry.projectId).toBeNull();
		expect(res.entry.segments).toHaveLength(1);
		expect(res.entry.segments[0].startedAt.toISOString()).toBe('2026-06-21T09:00:00.000Z');
		expect(res.unplacedMinutes).toBe(0);
	});

	it("a Leisure_Entry in Open_Mode on a day with no Work_Session anchors at the Target_Day's start (source: day-start)", async () => {
		const res = await createActivity({
			description: 'leisure open',
			date: '2026-06-22',
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-22T10:00:00Z')
		});
		expect(res.anchor?.source).toBe('day-start');
		expect(res.entry.projectId).toBeNull();
		expect(res.entry.segments.length).toBeGreaterThan(0);
	});

	it('a Work_Entry Open_Mode create on a day with no Work_Session still reports NO_PLACEMENT_ANCHOR (day-start fallback is leisure-only)', async () => {
		const p = await withTx((tx) => createProject(tx, 'No Anchor Project'));
		await expect(
			createActivity({
				projectId: p.id,
				description: 'work open, no session',
				date: '2026-06-23',
				untrackedPolicy: 'clip',
				dryRun: false,
				now: iso('2026-06-23T10:00:00Z')
			})
		).rejects.toMatchObject({ code: 'NO_PLACEMENT_ANCHOR' });
	});

	it('Requirement 3.12: Open_Mode leisure on a PAST day with no Work_Session is NOTHING_TO_LOG, not day-start', async () => {
		await expect(
			createActivity({
				description: 'leisure open, past day, no session',
				date: '2026-06-24',
				untrackedPolicy: 'clip',
				dryRun: false,
				now: iso('2026-06-28T00:00:00Z')
			})
		).rejects.toMatchObject({ code: 'NOTHING_TO_LOG' });
	});

	it('crossesProjectBoundary: converting a Work_Entry to a Leisure_Entry re-clips the existing interval and keeps it', async () => {
		const p = await seedFrame();
		const created = await createActivity({
			projectId: p.id,
			description: 'will become leisure',
			startedAt: iso('2026-06-01T09:00:00Z'),
			endedAt: iso('2026-06-01T10:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});

		const patched = await patchActivity({
			id: created.entry.id,
			projectId: null,
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(patched.entry.projectId).toBeNull();
		expect(patched.entry.category).toBe('relax');
		expect(patched.entry.segments).toHaveLength(1);
		expect(patched.entry.segments[0].startedAt.toISOString()).toBe('2026-06-01T09:00:00.000Z');
		expect(patched.entry.segments[0].endedAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');

		// And back — the reverse direction re-clips against real Tracked_Time.
		const revert = await patchActivity({
			id: created.entry.id,
			projectId: p.id,
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(revert.entry.projectId).toBe(p.id);
		expect(revert.entry.category).toBe('paid');
		expect(revert.entry.segments).toHaveLength(1);
	});

	it('a PATCH with projectId absent is not a boundary crossing and stays meta-only', async () => {
		const p = await seedFrame();
		const created = await createActivity({
			projectId: p.id,
			description: 'unchanged',
			startedAt: iso('2026-06-01T09:00:00Z'),
			endedAt: iso('2026-06-01T10:00:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		const patched = await patchActivity({
			id: created.entry.id,
			description: 'renamed only',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(patched.entry.projectId).toBe(p.id);
		expect(patched.entry.description).toBe('renamed only');
		expect(patched.entry.segments).toHaveLength(1);
	});

	it('a PATCH crossing the boundary that would leave nothing to log is rejected and leaves the entry untouched', async () => {
		const p = await seedFrame();
		// A Work_Entry sitting exactly in the 14:48-15:12 break (Untracked_Time) has no
		// legitimate way to exist normally, so build the "would empty out" scenario the
		// other direction instead: a Leisure_Entry whose interval, once treated as a
		// Work_Entry, would fall entirely in Untracked_Time and vanish.
		const leisure = await createActivity({
			description: 'leisure in the gap',
			startedAt: iso('2026-06-01T14:50:00Z'),
			endedAt: iso('2026-06-01T15:05:00Z'),
			untrackedPolicy: 'clip',
			dryRun: false,
			now: iso('2026-06-01T19:00:00Z')
		});
		expect(leisure.entry.projectId).toBeNull();

		await expect(
			patchActivity({
				id: leisure.entry.id,
				projectId: p.id,
				dryRun: false,
				now: iso('2026-06-01T19:00:00Z')
			})
		).rejects.toMatchObject({ code: 'NOTHING_TO_LOG' });

		// Untouched: still a Leisure_Entry, same segment.
		const { getEntry } = await import('../../../../src/lib/server/store/activities');
		const stillLeisure = await withTx((tx) => getEntry(tx, leisure.entry.id));
		expect(stillLeisure?.projectId).toBeNull();
		expect(stillLeisure?.segments).toHaveLength(1);
	});
});
