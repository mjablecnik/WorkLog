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
import { withReadTx, withTx } from '../../../../src/lib/server/store/tx';
import { normalize, intersect, subtract, total } from '../../../../src/lib/server/domain/interval';
import { getConfig } from '../../../../src/lib/server/core/config';
import { coveredIntervals, createEntry } from '../../../../src/lib/server/store/activities';
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
/** Carries which kind of entry a segment belongs to — Property 22's amendment (see
 *  module doc) only holds a Work_Entry's segments to the Tracked_Time invariant. */
type SegRowWithKind = SegRow & { project_id: string | null };

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

/** Every stored segment, joined to its entry's project_id so callers can tell a
 *  Work_Entry segment (project_id NOT NULL) from a Leisure_Entry one (NULL). */
async function allSegmentsWithKind(): Promise<SegRowWithKind[]> {
	const rows = await withReadTx((tx) =>
		tx.execute(sql`
			select s.id, s.started_at, s.ended_at, e.project_id
			from activity_segments s
			join activity_entries e on e.id = s.entry_id
		`)
	);
	return rows as unknown as SegRowWithKind[];
}

async function allEntryIds(): Promise<string[]> {
	const rows = await withReadTx((tx) => tx.execute(sql`select id from activity_entries`));
	return (rows as unknown as { id: string }[]).map((r) => r.id);
}

// --- Property 8 & 22: a random sequence of operations, then check the final state ---

type Op =
	| { kind: 'createSession'; offsetHours: number; durationHours: number }
	| { kind: 'createActivity'; offsetHours: number; durationHours: number }
	| { kind: 'createLeisure'; offsetHours: number; durationHours: number }
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
	fc.record({
		kind: fc.constant('createLeisure' as const),
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
	if (op.kind === 'createLeisure') {
		// A Leisure_Entry is created directly through the store, bypassing the HTTP/
		// service layer (not updated for a nullable projectId until section 5 of this
		// plan) — exactly the Unrestricted_Window arithmetic of Explicit_Mode: tracked
		// IS the requested interval itself, so the only thing to subtract is what
		// another entry (of either kind) already covers (Requirement 3.1, 3.2).
		const start = new Date(DAY0 + op.offsetHours * HOUR);
		const end = new Date(start.getTime() + op.durationHours * HOUR);
		const requested = { start, end };
		await withTx(async (tx) => {
			const covered = await coveredIntervals(tx, requested);
			const segments = subtract([requested], covered);
			const { minIntervalSeconds } = getConfig();
			const minMs = minIntervalSeconds * 1000;
			const kept = segments.filter((s) => s.end.getTime() - s.start.getTime() >= minMs);
			if (kept.length === 0) return; // NOTHING_TO_LOG — a normal outcome mid-sequence
			await createEntry(
				tx,
				{
					projectId: null,
					description: 'leisure sequence op',
					mode: 'explicit',
					requestedStartedAt: start,
					requestedEndedAt: end,
					requestedDurationMinutes: null
				},
				kept
			);
		});
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
	it('after any sequence of accepted session, activity and leisure operations, every stored segment is non-overlapping, and every Work_Entry segment lies inside Tracked_Time', async () => {
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

				// Property 2 (this specification): mutual exclusivity holds ACROSS
				// categories — every stored segment, Work_Entry or Leisure_Entry alike,
				// participates in the same non-overlap check.
				const segments = await allSegments();
				const sorted = [...segments].sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
				for (let i = 1; i < sorted.length; i++) {
					expect(
						new Date(sorted[i].started_at).getTime(),
						'Property 8/2: two activity_segments overlap'
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
				// Property 22, AMENDED by 003-worklog-time-categories: only a Work_Entry's
				// segments must lie inside Tracked_Time — a Leisure_Entry's segments are by
				// design not a subset of it (reconciled against the Unrestricted_Window
				// instead), so including them here would make the unrestricted assertion
				// false the moment leisure time is logged.
				const withKind = await allSegmentsWithKind();
				const workSegments = withKind.filter((s) => s.project_id !== null);
				const leisureSegments = withKind.filter((s) => s.project_id === null);
				expect(workSegments.length + leisureSegments.length).toBe(segments.length);
				for (const seg of workSegments) {
					const iv = { start: new Date(seg.started_at), end: new Date(seg.ended_at) };
					const inside = intersect([iv], tracked);
					const insideMs = total(inside);
					const segMs = iv.end.getTime() - iv.start.getTime();
					expect(insideMs, 'Property 22: a Work_Entry segment lies outside Tracked_Time').toBe(
						segMs
					);
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

describe('Property 3 (003-worklog-time-categories): Covered_Time excludes Leisure_Time', () => {
	it('covered/uncovered still reconstruct tracked exactly, and never include a leisure interval, with Leisure_Entry rows present', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 4 }),
				async (offsets) => {
					await resetDb();
					const project = await bodyOf(
						await projectsPost(
							mockEvent({
								method: 'POST',
								url: `${BASE}/api/projects`,
								body: { name: 'Leisure Coverage Prop' }
							})
						)
					);
					for (const [i, offsetHours] of offsets.entries()) {
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
						// A Leisure_Entry, well outside any Work_Session window created above —
						// no timer needs to have run for it (Requirement 3.1).
						await runOp(
							{ kind: 'createLeisure', offsetHours: offsetHours + 200, durationHours: 1 },
							project.id as string
						).catch(() => undefined);
					}

					const res = await bodyOf(
						await coverageGet(
							mockEvent({
								url: `${BASE}/api/coverage?from=2026-06-14T00:00:00Z&to=2026-06-27T00:00:00Z`
							})
						)
					);
					const tracked = (res.tracked as { start: string; end: string }[]).map((iv) => ({
						start: new Date(iv.start),
						end: new Date(iv.end)
					}));
					const covered = (res.covered as { start: string; end: string }[]).map((iv) => ({
						start: new Date(iv.start),
						end: new Date(iv.end)
					}));
					const uncovered = (res.uncovered as { start: string; end: string }[]).map((iv) => ({
						start: new Date(iv.start),
						end: new Date(iv.end)
					}));

					// The invariant this specification could silently break: covered ∪
					// uncovered must still reconstruct tracked EXACTLY, unaffected by any
					// Leisure_Entry present in the same range.
					const union = normalize([...covered, ...uncovered]);
					expect(total(subtract(union, tracked))).toBe(0);
					expect(total(subtract(tracked, union))).toBe(0);

					// And covered must never include the leisure interval itself — it lies
					// hours outside every Work_Session, so it cannot appear in tracked either.
					const leisureSegments = (await allSegmentsWithKind()).filter(
						(s) => s.project_id === null
					);
					for (const seg of leisureSegments) {
						const iv = { start: new Date(seg.started_at), end: new Date(seg.ended_at) };
						expect(total(intersect(covered, [iv])), 'a leisure interval leaked into covered').toBe(
							0
						);
					}
				}
			),
			{ numRuns: 15 }
		);
	}, 90_000);
});

describe('Property 4 (003-worklog-time-categories): the paid/unpaid split partitions Covered_Time', () => {
	it('paidSeconds + unpaidSeconds === coveredSeconds for every day, with a mix of billable and non-billable projects', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
				async (billableFlags) => {
					await resetDb();
					const projectIds: string[] = [];
					for (const [i, billable] of billableFlags.entries()) {
						const project = await bodyOf(
							await projectsPost(
								mockEvent({
									method: 'POST',
									url: `${BASE}/api/projects`,
									body: { name: `Split Prop ${i}`, billable }
								})
							)
						);
						projectIds.push(project.id as string);
					}
					await sessionsPost(
						mockEvent({
							method: 'POST',
							url: `${BASE}/api/sessions`,
							body: { startedAt: '2026-06-15T06:00:00Z', endedAt: '2026-06-15T20:00:00Z' }
						})
					);
					let cursor = 6;
					for (const projectId of projectIds) {
						const start = new Date(DAY0 + cursor * HOUR);
						const end = new Date(start.getTime() + HOUR);
						await Promise.resolve(
							activitiesPost(
								mockEvent({
									method: 'POST',
									url: `${BASE}/api/activities`,
									body: {
										projectId,
										description: 'split',
										startedAt: start.toISOString(),
										endedAt: end.toISOString()
									}
								})
							)
						).catch(() => undefined);
						cursor += 1;
					}

					const day = await bodyOf(
						await dayGet(
							mockEvent({ url: `${BASE}/api/days/2026-06-15`, params: { date: '2026-06-15' } })
						)
					);
					const totals = day.totals as {
						coveredSeconds: number;
						paidSeconds: number;
						unpaidSeconds: number;
					};
					expect(totals.paidSeconds + totals.unpaidSeconds).toBe(totals.coveredSeconds);
				}
			),
			{ numRuns: 10 }
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
