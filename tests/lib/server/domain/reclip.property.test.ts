import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { reclipAffected, type ReclipPorts } from '../../../../src/lib/server/domain/reclip';
import { intersect, normalize } from '../../../../src/lib/server/domain/interval';
import type { ActivityEntry, Interval } from '../../../../src/lib/contracts/models';

const BASE = new Date('2026-08-15T00:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60_000;
const MIN_MS = 60_000;

type FakeEntry = {
	id: string;
	requested: Interval;
	segments: Interval[];
	createdAt: Date;
};

class FakeStore implements ReclipPorts {
	sessions: Interval[] = [];
	entries: FakeEntry[] = [];

	private toActivityEntry(e: FakeEntry): ActivityEntry {
		return {
			id: e.id,
			projectId: 'p',
			projectName: 'P',
			colorIndex: 0,
			description: '',
			mode: 'explicit',
			requestedStartedAt: e.requested.start,
			requestedEndedAt: e.requested.end,
			requestedDurationMinutes: null,
			orphaned: e.segments.length === 0,
			createdAt: e.createdAt,
			updatedAt: e.createdAt,
			segments: e.segments.map((s, i) => ({
				id: `${e.id}-${i}`,
				entryId: e.id,
				startedAt: s.start,
				endedAt: s.end
			}))
		};
	}

	async trackedIntervals(window: Interval[]): Promise<Interval[]> {
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

const rawInterval = fc
	.tuple(fc.integer({ min: 0, max: DAY_MS }), fc.integer({ min: 60_000, max: DAY_MS }))
	.map(([start, len]): Interval => ({
		start: new Date(BASE + start),
		end: new Date(BASE + start + len)
	}));

const scenario = fc.record({
	sessions: fc.array(rawInterval, { minLength: 0, maxLength: 4 }),
	entryRequests: fc.array(rawInterval, { minLength: 1, maxLength: 4 })
});

function sortedBoundsByEntry(store: FakeStore): Record<string, { start: number; end: number }[]> {
	const out: Record<string, { start: number; end: number }[]> = {};
	for (const e of store.entries) {
		out[e.id] = normalize(e.segments)
			.map((s) => ({ start: s.start.getTime(), end: s.end.getTime() }))
			.sort((a, b) => a.start - b.start);
	}
	return out;
}

describe('Property 9: Re-clipping is deterministic and idempotent', () => {
	it('applying reclipAffected twice over the same intervals produces the same segment bounds as once', async () => {
		await fc.assert(
			fc.asyncProperty(scenario, async ({ sessions, entryRequests }) => {
				const store = new FakeStore();
				store.sessions = normalize(sessions);
				store.entries = entryRequests.map((requested, i) => ({
					id: `e${i}`,
					requested,
					segments: [], // start orphaned; the first reclip pass places them
					createdAt: new Date(BASE + i * 1000)
				}));

				const affected = normalize([...store.sessions, ...entryRequests]);
				const now = new Date(BASE + 2 * DAY_MS);

				await reclipAffected(store, affected, now, MIN_MS);
				const once = sortedBoundsByEntry(store);

				await reclipAffected(store, affected, now, MIN_MS);
				const twice = sortedBoundsByEntry(store);

				expect(twice).toEqual(once);
			}),
			{ numRuns: 50 }
		);
	});
});
