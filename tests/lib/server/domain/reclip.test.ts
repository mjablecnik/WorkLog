import { describe, expect, it } from 'vitest';
import { reclipAffected, type ReclipPorts } from '../../../../src/lib/server/domain/reclip';
import { intersect, normalize } from '../../../../src/lib/server/domain/interval';
import type { ActivityEntry, Interval } from '../../../../src/lib/contracts/models';

function iv(startIso: string, endIso: string): Interval {
	return { start: new Date(startIso), end: new Date(endIso) };
}

const MIN_MS = 60_000;

type FakeEntry = {
	id: string;
	projectName: string;
	colorIndex: number;
	description: string;
	requested: Interval;
	segments: Interval[];
	createdAt: Date;
};

/** An in-memory ReclipPorts fake: `sessions` is the Tracked_Time frame, `entries` the log. */
class FakeStore implements ReclipPorts {
	sessions: Interval[] = [];
	entries: FakeEntry[] = [];

	private toActivityEntry(e: FakeEntry): ActivityEntry {
		return {
			id: e.id,
			projectId: 'p-' + e.id,
			projectName: e.projectName,
			colorIndex: e.colorIndex,
			description: e.description,
			mode: 'explicit',
			requestedStartedAt: e.requested.start,
			requestedEndedAt: e.requested.end,
			requestedDurationMinutes: null,
			orphaned: e.segments.length === 0,
			createdAt: e.createdAt,
			updatedAt: e.createdAt,
			segments: e.segments.map((s, i) => ({
				id: `${e.id}-seg-${i}`,
				entryId: e.id,
				startedAt: s.start,
				endedAt: s.end
			}))
		};
	}

	async trackedIntervals(window: Interval[], _now: Date): Promise<Interval[]> {
		return intersect(normalize(this.sessions), window);
	}

	async entriesAffectedBy(window: Interval[]): Promise<ActivityEntry[]> {
		return this.entries
			.filter((e) => {
				const segOverlap = e.segments.some((s) => intersect([s], window).length > 0);
				const reqOverlap = intersect([e.requested], window).length > 0;
				return segOverlap || reqOverlap;
			})
			.map((e) => this.toActivityEntry(e));
	}

	async coveredIntervals(window: Interval[], excludeEntryId: string | null): Promise<Interval[]> {
		const segs = this.entries.filter((e) => e.id !== excludeEntryId).flatMap((e) => e.segments);
		return intersect(normalize(segs), window);
	}

	async replaceSegments(entryId: string, segments: Interval[]): Promise<void> {
		const entry = this.entries.find((e) => e.id === entryId);
		if (entry) entry.segments = normalize(segments);
	}
}

describe('reclipAffected', () => {
	it('shrinking a Work_Session splits an Activity_Entry', async () => {
		const store = new FakeStore();
		store.sessions = [iv('2026-08-01T08:00:00Z', '2026-08-01T18:00:00Z')];
		store.entries = [
			{
				id: 'e1',
				projectName: 'Project A',
				colorIndex: 0,
				description: 'long entry',
				requested: iv('2026-08-01T08:00:00Z', '2026-08-01T18:00:00Z'),
				segments: [iv('2026-08-01T08:00:00Z', '2026-08-01T18:00:00Z')],
				createdAt: new Date('2026-08-01T00:00:00Z')
			}
		];

		// The session shrinks to leave a hole in the middle.
		const oldInterval = iv('2026-08-01T08:00:00Z', '2026-08-01T18:00:00Z');
		store.sessions = [
			iv('2026-08-01T08:00:00Z', '2026-08-01T12:00:00Z'),
			iv('2026-08-01T14:00:00Z', '2026-08-01T18:00:00Z')
		];
		const affected = [oldInterval]; // the whole old span is affected

		const outcomes = await reclipAffected(
			store,
			affected,
			new Date('2026-08-01T20:00:00Z'),
			MIN_MS
		);
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].after).toEqual([
			iv('2026-08-01T08:00:00Z', '2026-08-01T12:00:00Z'),
			iv('2026-08-01T14:00:00Z', '2026-08-01T18:00:00Z')
		]);
		expect(outcomes[0].removedMs).toBe(2 * 3_600_000); // the 12:00-14:00 hole
		expect(outcomes[0].orphaned).toBe(false);
	});

	it('deleting a Work_Session leaves an Orphaned_Entry with orphaned: true', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'e1',
				projectName: 'Project A',
				colorIndex: 0,
				description: 'will be orphaned',
				requested: iv('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z'),
				segments: [iv('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z')],
				createdAt: new Date('2026-08-02T00:00:00Z')
			}
		];
		store.sessions = []; // the session was deleted — no Tracked_Time left at all

		const outcomes = await reclipAffected(
			store,
			[iv('2026-08-02T08:00:00Z', '2026-08-02T09:00:00Z')],
			new Date('2026-08-02T20:00:00Z'),
			MIN_MS
		);
		expect(outcomes[0].after).toEqual([]);
		expect(outcomes[0].orphaned).toBe(true);
		expect(outcomes[0].removedMs).toBe(3_600_000);
	});

	it('widening a Work_Session restores Covered_Time', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'e1',
				projectName: 'Project A',
				colorIndex: 0,
				description: '',
				requested: iv('2026-08-03T08:00:00Z', '2026-08-03T10:00:00Z'),
				segments: [iv('2026-08-03T08:00:00Z', '2026-08-03T09:00:00Z')], // was clipped to 1h
				createdAt: new Date('2026-08-03T00:00:00Z')
			}
		];
		store.sessions = [iv('2026-08-03T08:00:00Z', '2026-08-03T10:00:00Z')]; // now covers the full 2h

		const outcomes = await reclipAffected(
			store,
			[iv('2026-08-03T08:00:00Z', '2026-08-03T10:00:00Z')],
			new Date('2026-08-03T20:00:00Z'),
			MIN_MS
		);
		expect(outcomes[0].after).toEqual([iv('2026-08-03T08:00:00Z', '2026-08-03T10:00:00Z')]);
		expect(outcomes[0].removedMs).toBe(0);
	});

	it('an Orphaned_Entry comes back when a session is re-created over its requested interval', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'e1',
				projectName: 'Project A',
				colorIndex: 0,
				description: 'orphan',
				requested: iv('2026-08-04T08:00:00Z', '2026-08-04T09:00:00Z'),
				segments: [], // already orphaned — no segment, only the requested interval left
				createdAt: new Date('2026-08-04T00:00:00Z')
			}
		];
		store.sessions = [iv('2026-08-04T08:00:00Z', '2026-08-04T09:00:00Z')]; // session restored

		// The affected window is the NEW session's interval; the orphan is found only
		// via its requested interval, since it owns no segment to overlap by.
		const outcomes = await reclipAffected(
			store,
			[iv('2026-08-04T08:00:00Z', '2026-08-04T09:00:00Z')],
			new Date('2026-08-04T20:00:00Z'),
			MIN_MS
		);
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].entryId).toBe('e1');
		expect(outcomes[0].after).toEqual([iv('2026-08-04T08:00:00Z', '2026-08-04T09:00:00Z')]);
		expect(outcomes[0].orphaned).toBe(false);
	});

	it('a session moved to a disjoint time re-clips both stretches and nothing in between', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'e1',
				projectName: 'Project A',
				colorIndex: 0,
				description: 'monday entry',
				requested: iv('2026-08-03T08:00:00Z', '2026-08-03T09:00:00Z'),
				segments: [iv('2026-08-03T08:00:00Z', '2026-08-03T09:00:00Z')],
				createdAt: new Date('2026-08-03T00:00:00Z')
			},
			{
				id: 'e2',
				projectName: 'Project B',
				colorIndex: 1,
				description: 'untouched entry, far from either stretch',
				requested: iv('2026-08-05T08:00:00Z', '2026-08-05T09:00:00Z'),
				segments: [iv('2026-08-05T08:00:00Z', '2026-08-05T09:00:00Z')],
				createdAt: new Date('2026-08-05T00:00:00Z')
			}
		];
		// The Monday session moved to Friday — two disjoint affected stretches.
		store.sessions = [iv('2026-08-07T08:00:00Z', '2026-08-07T09:00:00Z')];
		const affected = [
			iv('2026-08-03T08:00:00Z', '2026-08-03T09:00:00Z'),
			iv('2026-08-07T08:00:00Z', '2026-08-07T09:00:00Z')
		];

		const outcomes = await reclipAffected(
			store,
			affected,
			new Date('2026-08-08T00:00:00Z'),
			MIN_MS
		);
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].entryId).toBe('e1');
		expect(outcomes[0].after).toEqual([]); // Monday's old time is gone, and it never asked for Friday
		// e2 (Wednesday) is untouched — never selected at all.
	});

	it('a segment ending exactly at the affected start does not overlap it, but the entry is still selected via its requested interval', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'e1',
				projectName: 'Project A',
				colorIndex: 0,
				description: '',
				requested: iv('2026-08-09T07:00:00Z', '2026-08-09T09:00:00Z'),
				segments: [iv('2026-08-09T07:00:00Z', '2026-08-09T08:00:00Z')], // ends exactly at the affected start
				createdAt: new Date('2026-08-09T00:00:00Z')
			}
		];
		store.sessions = [iv('2026-08-09T07:00:00Z', '2026-08-09T09:00:00Z')]; // now covers the full request
		const affected = [iv('2026-08-09T08:00:00Z', '2026-08-09T09:00:00Z')]; // half-open: touches, does not overlap the segment

		const outcomes = await reclipAffected(
			store,
			affected,
			new Date('2026-08-09T20:00:00Z'),
			MIN_MS
		);
		expect(outcomes).toHaveLength(1); // found via requested interval, not segment overlap
		expect(outcomes[0].after).toEqual([iv('2026-08-09T07:00:00Z', '2026-08-09T09:00:00Z')]);
	});

	it('two entries competing for freed Tracked_Time resolve in requestedStartedAt order', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'later',
				projectName: 'Project Later',
				colorIndex: 1,
				description: '',
				requested: iv('2026-08-10T09:00:00Z', '2026-08-10T10:00:00Z'),
				segments: [],
				createdAt: new Date('2026-08-10T00:01:00Z')
			},
			{
				id: 'earlier',
				projectName: 'Project Earlier',
				colorIndex: 0,
				description: '',
				requested: iv('2026-08-10T08:00:00Z', '2026-08-10T10:00:00Z'),
				segments: [],
				createdAt: new Date('2026-08-10T00:00:00Z')
			}
		];
		// Only ONE hour of Tracked_Time exists, and both entries want part of it.
		store.sessions = [iv('2026-08-10T08:00:00Z', '2026-08-10T09:00:00Z')];
		const affected = [iv('2026-08-10T08:00:00Z', '2026-08-10T10:00:00Z')];

		const outcomes = await reclipAffected(
			store,
			affected,
			new Date('2026-08-10T20:00:00Z'),
			MIN_MS
		);
		const earlier = outcomes.find((o) => o.entryId === 'earlier')!;
		const later = outcomes.find((o) => o.entryId === 'later')!;
		// `earlier` (requestedStartedAt 08:00) is processed first and claims the hour.
		expect(earlier.after).toEqual([iv('2026-08-10T08:00:00Z', '2026-08-10T09:00:00Z')]);
		// `later` (requestedStartedAt 09:00) finds nothing left within its own request.
		expect(later.after).toEqual([]);
	});

	it('removedMs matches the time actually lost; projectName and description are carried through', async () => {
		const store = new FakeStore();
		store.entries = [
			{
				id: 'e1',
				projectName: 'Carried Project',
				colorIndex: 3,
				description: 'carried description',
				requested: iv('2026-08-11T08:00:00Z', '2026-08-11T10:00:00Z'),
				segments: [iv('2026-08-11T08:00:00Z', '2026-08-11T10:00:00Z')],
				createdAt: new Date('2026-08-11T00:00:00Z')
			}
		];
		store.sessions = [iv('2026-08-11T08:00:00Z', '2026-08-11T09:30:00Z')]; // lost the last 30 min

		const outcomes = await reclipAffected(
			store,
			[iv('2026-08-11T08:00:00Z', '2026-08-11T10:00:00Z')],
			new Date('2026-08-11T20:00:00Z'),
			MIN_MS
		);
		expect(outcomes[0].removedMs).toBe(30 * 60_000);
		expect(outcomes[0].projectName).toBe('Carried Project');
		expect(outcomes[0].description).toBe('carried description');
	});
});
