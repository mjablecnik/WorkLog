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
	/** Null models a Leisure_Entry — excluded from entriesAffectedBy below, mirroring
	 *  the real store's filter (003-worklog-time-categories task 2.3). */
	projectId?: string | null;
};

class FakeStore implements ReclipPorts {
	sessions: Interval[] = [];
	entries: FakeEntry[] = [];

	private toActivityEntry(e: FakeEntry): ActivityEntry {
		const projectId = e.projectId === undefined ? 'p' : e.projectId;
		return {
			id: e.id,
			projectId,
			projectName: projectId === null ? null : 'P',
			colorIndex: projectId === null ? null : 0,
			category: projectId === null ? 'relax' : 'paid',
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
			.filter((e) => e.projectId !== null)
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

const scenarioWithLeisure = fc.record({
	sessions: fc.array(rawInterval, { minLength: 0, maxLength: 4 }),
	workRequests: fc.array(rawInterval, { minLength: 0, maxLength: 3 }),
	leisureRequests: fc.array(rawInterval, { minLength: 1, maxLength: 3 }),
	changes: fc.array(rawInterval, { minLength: 1, maxLength: 3 })
});

describe('Property 6: A Work_Session change never disturbs a Leisure_Entry', () => {
	it('after any sequence of session creates/patches/deletes, every stored Leisure_Entry and its segments are byte-for-byte unchanged, and none is orphaned', async () => {
		await fc.assert(
			fc.asyncProperty(
				scenarioWithLeisure,
				async ({ sessions, workRequests, leisureRequests, changes }) => {
					const store = new FakeStore();
					store.sessions = normalize(sessions);
					store.entries = [
						...workRequests.map((requested, i) => ({
							id: `w${i}`,
							requested,
							segments: [] as Interval[],
							createdAt: new Date(BASE + i * 1000),
							projectId: `p${i}`
						})),
						...leisureRequests.map((requested, i) => ({
							id: `l${i}`,
							requested,
							// A Leisure_Entry's segments are whatever it was clipped to against
							// its own Unrestricted_Window at creation time — modelled here simply
							// as its own full requested interval, independent of any session.
							segments: [requested] as Interval[],
							createdAt: new Date(BASE + (workRequests.length + i) * 1000),
							projectId: null as string | null
						}))
					];

					const leisureBefore = store.entries
						.filter((e) => e.projectId === null)
						.map((e) => ({ id: e.id, segments: normalize(e.segments) }));

					// Simulate a sequence of session creates/patches/deletes by re-running
					// reclipAffected over each `changes` window in turn — the caller's own
					// responsibility in production (services/sessions.ts), reproduced here
					// directly since this suite tests reclipAffected in isolation.
					const now = new Date(BASE + 2 * DAY_MS);
					for (const change of changes) {
						await reclipAffected(store, [change], now, MIN_MS);
					}

					const leisureAfter = store.entries
						.filter((e) => e.projectId === null)
						.map((e) => ({ id: e.id, segments: normalize(e.segments) }));

					expect(leisureAfter).toEqual(leisureBefore);
					for (const e of store.entries) {
						if (e.projectId === null) expect(e.segments.length).toBeGreaterThan(0);
					}
				}
			),
			{ numRuns: 50 }
		);
	});
});

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
