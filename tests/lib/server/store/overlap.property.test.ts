/**
 * The global invariants, against the real database: Property 8 (Activity_Segment rows
 * never overlap globally), Property 22 (every stored segment lies inside Tracked_Time
 * — the invariant the whole application exists to maintain, checked here after a
 * random *sequence* of session and entry operations, since re-clipping is exactly
 * where it breaks), Property 7 (coverage partitions tracked time), Property 15 (day
 * totals partition the timeline) and Property 23 (described time is conserved).
 *
 * Validates: Requirements 2.9, 4.5, 6.1, 6.2, 6.4, 8.3, 8.4, 8.5, 9.3, 10.7.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { resetDb } from '../../../setup/db';
import { withReadTx } from '../../../../src/lib/server/store/tx';
import { normalize, intersect, subtract, total } from '../../../../src/lib/server/domain/interval';
import { mockEvent, bodyOf } from '../../../api/helpers';
import { POST as projectsPost } from '../../../../src/routes/api/projects/+server';
import { POST as sessionsPost } from '../../../../src/routes/api/sessions/+server';
import {
	DELETE as sessionDelete,
	PATCH as sessionPatch
} from '../../../../src/routes/api/sessions/[id]/+server';
import { GET as coverageGet } from '../../../../src/routes/api/coverage/+server';
import { GET as daysGet } from '../../../../src/routes/api/days/+server';
import { GET as dayGet } from '../../../../src/routes/api/days/[date]/+server';
import { DELETE as activityDelete } from '../../../../src/routes/api/activities/[id]/+server';
import { POST as activitiesPost } from '../../../../src/routes/api/activities/+server';

const BASE = 'http://localhost';
const DAY0 = new Date('2026-06-15T00:00:00Z').getTime();
const HOUR = 3_600_000;

type Row = { id: string; started_at: string; ended_at: string | null };
type SegRow = { id: string; started_at: string; ended_at: string };

async function allSessions(): Promise<Row[]> {
	const rows = await withReadTx((tx) =>
		tx.execute(sql`select id, started_at, ended_at from work_sessions`)
	);
	return rows as unknown as Row[];
}

async function allSegments(): Promise<SegRow[]> {
	const rows = await withReadTx((tx) =>
		tx.execute(sql`select id, started_at, ended_at from activity_segments`)
	);
	return rows as unknown as SegRow[];
}

async function allEntryIds(): Promise<string[]> {
	const rows = await withReadTx((tx) => tx.execute(sql`select id from activity_entries`));
	return (rows as unknown as { id: string }[]).map((r) => r.id);
}

// --- Property 8 & 22: a random sequence of operations, then check the final state ---

type Op =
	| { kind: 'createSession'; offsetHours: number; durationHours: number }
	| { kind: 'createActivity'; offsetHours: number; durationHours: number }
	| { kind: 'deleteSession'; pick: number }
	| { kind: 'deleteActivity'; pick: number }
	| { kind: 'patchSession'; pick: number; newOffsetHours: number; newDurationHours: number };

const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
	fc.record({
		kind: fc.constant('createSession' as const),
		offsetHours: fc.integer({ min: 0, max: 60 }),
		durationHours: fc.integer({ min: 1, max: 6 })
	}),
	fc.record({
		kind: fc.constant('createActivity' as const),
		offsetHours: fc.integer({ min: 0, max: 60 }),
		durationHours: fc.integer({ min: 1, max: 4 })
	}),
	fc.record({ kind: fc.constant('deleteSession' as const), pick: fc.nat({ max: 20 }) }),
	fc.record({ kind: fc.constant('deleteActivity' as const), pick: fc.nat({ max: 20 }) }),
	fc.record({
		kind: fc.constant('patchSession' as const),
		pick: fc.nat({ max: 20 }),
		newOffsetHours: fc.integer({ min: 0, max: 60 }),
		newDurationHours: fc.integer({ min: 1, max: 6 })
	})
);

async function runOp(op: Op, projectId: string): Promise<void> {
	if (op.kind === 'createSession') {
		const start = new Date(DAY0 + op.offsetHours * HOUR);
		const end = new Date(start.getTime() + op.durationHours * HOUR);
		await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: start.toISOString(), endedAt: end.toISOString() }
			})
		);
		return;
	}
	if (op.kind === 'createActivity') {
		const start = new Date(DAY0 + op.offsetHours * HOUR);
		const end = new Date(start.getTime() + op.durationHours * HOUR);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'sequence op',
					startedAt: start.toISOString(),
					endedAt: end.toISOString(),
					untrackedPolicy: 'clip'
				}
			})
		);
		return;
	}
	if (op.kind === 'deleteSession') {
		const sessions = await allSessions();
		if (sessions.length === 0) return;
		const s = sessions[op.pick % sessions.length];
		await sessionDelete(mockEvent({ url: `${BASE}/api/sessions/${s.id}`, params: { id: s.id } }));
		return;
	}
	if (op.kind === 'deleteActivity') {
		const ids = await allEntryIds();
		if (ids.length === 0) return;
		const id = ids[op.pick % ids.length];
		await activityDelete(
			mockEvent({ method: 'DELETE', url: `${BASE}/api/activities/${id}`, params: { id } })
		);
		return;
	}
	if (op.kind === 'patchSession') {
		const sessions = await allSessions();
		if (sessions.length === 0) return;
		const s = sessions[op.pick % sessions.length];
		const start = new Date(DAY0 + op.newOffsetHours * HOUR);
		const end = new Date(start.getTime() + op.newDurationHours * HOUR);
		await sessionPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/sessions/${s.id}`,
				params: { id: s.id },
				body: { startedAt: start.toISOString(), endedAt: end.toISOString() }
			})
		);
	}
}

describe('Property 8 & 22: segments never overlap, and always lie inside Tracked_Time', () => {
	it('after any sequence of accepted session and activity operations, every stored segment is non-overlapping and inside Tracked_Time', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(opArbitrary, { minLength: 3, maxLength: 10 }), async (ops) => {
				await resetDb();
				const project = await bodyOf(
					await projectsPost(
						mockEvent({
							method: 'POST',
							url: `${BASE}/api/projects`,
							body: { name: 'Sequence Project' }
						})
					)
				);
				const projectId = project.id as string;

				for (const op of ops) {
					// Each individual operation may legitimately be rejected (an overlap, a
					// NOTHING_TO_LOG, ...) — that is a normal outcome mid-sequence, not a
					// property violation. Only the FINAL database state is asserted.
					await runOp(op, projectId).catch(() => undefined);
				}

				const segments = await allSegments();
				const sorted = [...segments].sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
				for (let i = 1; i < sorted.length; i++) {
					expect(
						new Date(sorted[i].started_at).getTime(),
						'Property 8: two activity_segments overlap'
					).toBeGreaterThanOrEqual(new Date(sorted[i - 1].ended_at).getTime());
				}

				const sessions = await allSessions();
				const { maxOpenSessionHours } = (
					await import('../../../../src/lib/server/core/config')
				).getConfig();
				const now = new Date();
				const tracked = normalize(
					sessions.map((s) => {
						const start = new Date(s.started_at);
						if (s.ended_at !== null) return { start, end: new Date(s.ended_at) };
						const cap = new Date(start.getTime() + maxOpenSessionHours * HOUR);
						return { start, end: now.getTime() < cap.getTime() ? now : cap };
					})
				);
				for (const seg of segments) {
					const iv = { start: new Date(seg.started_at), end: new Date(seg.ended_at) };
					const inside = intersect([iv], tracked);
					const insideMs = total(inside);
					const segMs = iv.end.getTime() - iv.start.getTime();
					expect(insideMs, 'Property 22: a stored segment lies outside Tracked_Time').toBe(segMs);
				}
			}),
			{ numRuns: 20 }
		);
	}, 120_000);
});

describe('Property 7: Coverage partitions tracked time', () => {
	it('covered and uncovered are disjoint and their union equals tracked, for /api/coverage', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 4 }),
				async (offsets) => {
					await resetDb();
					const project = await bodyOf(
						await projectsPost(
							mockEvent({
								method: 'POST',
								url: `${BASE}/api/projects`,
								body: { name: 'Coverage Prop' }
							})
						)
					);
					for (const [i, offsetHours] of offsets.entries()) {
						const start = new Date(DAY0 + offsetHours * HOUR);
						const end = new Date(start.getTime() + 3 * HOUR);
						await Promise.resolve(
							sessionsPost(
								mockEvent({
									method: 'POST',
									url: `${BASE}/api/sessions`,
									body: { startedAt: start.toISOString(), endedAt: end.toISOString() }
								})
							)
						).catch(() => undefined);
						if (i % 2 === 0) {
							await Promise.resolve(
								activitiesPost(
									mockEvent({
										method: 'POST',
										url: `${BASE}/api/activities`,
										body: {
											projectId: project.id,
											description: 'x',
											startedAt: start.toISOString(),
											endedAt: new Date(start.getTime() + HOUR).toISOString()
										}
									})
								)
							).catch(() => undefined);
						}
					}

					const res = await bodyOf(
						await coverageGet(
							mockEvent({
								url: `${BASE}/api/coverage?from=2026-06-14T00:00:00Z&to=2026-06-18T00:00:00Z`
							})
						)
					);
					const tracked = (res.tracked as { start: string; end: string }[]).map((i) => ({
						start: new Date(i.start),
						end: new Date(i.end)
					}));
					const covered = (res.covered as { start: string; end: string }[]).map((i) => ({
						start: new Date(i.start),
						end: new Date(i.end)
					}));
					const uncovered = (res.uncovered as { start: string; end: string }[]).map((i) => ({
						start: new Date(i.start),
						end: new Date(i.end)
					}));

					// disjoint: covered ∩ uncovered = ∅
					expect(total(intersect(covered, uncovered))).toBe(0);
					// union: covered ∪ uncovered = tracked, exactly
					const union = normalize([...covered, ...uncovered]);
					expect(total(subtract(union, tracked))).toBe(0);
					expect(total(subtract(tracked, union))).toBe(0);
				}
			),
			{ numRuns: 15 }
		);
	}, 60_000);
});

describe('Property 15: Day totals partition the timeline', () => {
	it('the sum of trackedSeconds over a consecutive run of days equals the total Tracked_Time over the whole range', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 90 }), { minLength: 1, maxLength: 5 }),
				async (offsets) => {
					await resetDb();
					for (const offsetHours of offsets) {
						const start = new Date(DAY0 + offsetHours * HOUR);
						const end = new Date(start.getTime() + 2 * HOUR);
						await Promise.resolve(
							sessionsPost(
								mockEvent({
									method: 'POST',
									url: `${BASE}/api/sessions`,
									body: { startedAt: start.toISOString(), endedAt: end.toISOString() }
								})
							)
						).catch(() => undefined);
					}

					const from = '2026-06-14T00:00:00Z';
					const to = '2026-06-19T00:00:00Z';
					const daysRes = await bodyOf(
						await daysGet(mockEvent({ url: `${BASE}/api/days?from=${from}&to=${to}` }))
					);
					const sumTracked = (daysRes.days as { trackedSeconds: number }[]).reduce(
						(sum, d) => sum + d.trackedSeconds,
						0
					);

					const coverageRes = await bodyOf(
						await coverageGet(mockEvent({ url: `${BASE}/api/coverage?from=${from}&to=${to}` }))
					);
					const totals = coverageRes.totals as { trackedSeconds: number };

					expect(sumTracked).toBe(totals.trackedSeconds);
				}
			),
			{ numRuns: 10 }
		);
	}, 150_000);
});

describe('Property 23: Described time is conserved', () => {
	it("a day's covered seconds equals the sum of that day's segment durations and the sum of its per-project breakdown", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 1, maxLength: 4 }),
				async (offsets) => {
					await resetDb();
					const project = await bodyOf(
						await projectsPost(
							mockEvent({
								method: 'POST',
								url: `${BASE}/api/projects`,
								body: { name: 'Conservation Prop' }
							})
						)
					);
					await sessionsPost(
						mockEvent({
							method: 'POST',
							url: `${BASE}/api/sessions`,
							body: { startedAt: '2026-06-15T06:00:00Z', endedAt: '2026-06-15T22:00:00Z' }
						})
					);
					const placedOffsets = [...new Set(offsets)].sort((a, b) => a - b);
					let cursor = 6;
					for (const gapHours of placedOffsets) {
						const start = new Date(DAY0 + (cursor + (gapHours % 2)) * HOUR);
						const end = new Date(start.getTime() + HOUR);
						if (end.getTime() >= DAY0 + 22 * HOUR) break;
						await Promise.resolve(
							activitiesPost(
								mockEvent({
									method: 'POST',
									url: `${BASE}/api/activities`,
									body: {
										projectId: project.id,
										description: 'x',
										startedAt: start.toISOString(),
										endedAt: end.toISOString()
									}
								})
							)
						).catch(() => undefined);
						cursor += 2;
					}

					const day = await bodyOf(
						await dayGet(
							mockEvent({ url: `${BASE}/api/days/2026-06-15`, params: { date: '2026-06-15' } })
						)
					);
					const totals = day.totals as {
						coveredSeconds: number;
						byProject: { coveredSeconds: number }[];
					};
					const segments = await allSegments();
					const clampedTotalMs = total(
						segments.map((s) => ({ start: new Date(s.started_at), end: new Date(s.ended_at) }))
					);
					expect(Math.round(clampedTotalMs / 1000)).toBe(totals.coveredSeconds);
					const byProjectSum = totals.byProject.reduce((sum, p) => sum + p.coveredSeconds, 0);
					expect(byProjectSum).toBe(totals.coveredSeconds);
				}
			),
			{ numRuns: 15 }
		);
	}, 60_000);
});
