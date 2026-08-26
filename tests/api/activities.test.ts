import { describe, expect, it, beforeEach } from 'vitest';
import { mockEvent, bodyOf } from './helpers';
import {
	GET as activitiesGet,
	POST as activitiesPost
} from '../../src/routes/api/activities/+server';
import {
	GET as activityGet,
	PATCH as activityPatch,
	DELETE as activityDelete
} from '../../src/routes/api/activities/[id]/+server';
import { POST as projectsPost } from '../../src/routes/api/projects/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';
import { getConfig } from '../../src/lib/server/core/config';
import { createDayResolver } from '../../src/lib/server/domain/logical-day';

const BASE = 'http://localhost';

let projectId: string;

/** Seeds the frame `[08:00-14:48, 15:12-18:00]` on 2026-06-01, per the design's worked example. */
beforeEach(async () => {
	const project = await bodyOf(
		await projectsPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Activities Test' } })
		)
	);
	projectId = project.id as string;

	await sessionsPost(
		mockEvent({
			method: 'POST',
			url: `${BASE}/api/sessions`,
			body: { startedAt: '2026-06-01T08:00:00Z', endedAt: '2026-06-01T14:48:00Z' }
		})
	);
	await sessionsPost(
		mockEvent({
			method: 'POST',
			url: `${BASE}/api/sessions`,
			body: { startedAt: '2026-06-01T15:12:00Z', endedAt: '2026-06-01T18:00:00Z' }
		})
	);
});

describe('activity routes', () => {
	it('explicit 13:00-16:00 returns 201 with two segments and preserves the requested interval', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'explicit worked example',
					startedAt: '2026-06-01T13:00:00Z',
					endedAt: '2026-06-01T16:00:00Z'
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await bodyOf(res);
		const entry = body.entry as Record<string, unknown>;
		expect(entry.requestedStartedAt).toBe('2026-06-01T13:00:00.000Z');
		expect(entry.requestedEndedAt).toBe('2026-06-01T16:00:00.000Z');
		expect((entry.segments as unknown[]).length).toBe(2);
		expect(body.anchor).toBeNull();
	});

	it('duration 2h anchored at 14:00 totals exactly 120 minutes', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'duration worked example',
					date: '2026-06-01',
					startedAt: '2026-06-01T14:00:00Z',
					durationMinutes: 120
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await bodyOf(res);
		const entry = body.entry as Record<string, unknown>;
		const segments = entry.segments as { startedAt: string; endedAt: string }[];
		const totalMs = segments.reduce(
			(sum, s) => sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()),
			0
		);
		expect(totalMs).toBe(120 * 60_000);
		expect(body.unplacedMinutes).toBe(0);
		const anchor = body.anchor as Record<string, unknown>;
		expect(anchor.at).toBe('2026-06-01T14:00:00.000Z');
	});

	it('an Open_Mode write carries the resolved anchor and its source', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: { projectId, description: 'open mode', date: '2026-06-01' }
			})
		);
		expect(res.status).toBe(201);
		const body = await bodyOf(res);
		const anchor = body.anchor as Record<string, unknown>;
		expect(anchor.source).toBe('first-session'); // no segment logged yet this day
		expect((body.entry as Record<string, unknown>).mode).toBe('open');
	});

	it('AMBIGUOUS_MODE when both endedAt and durationMinutes are supplied', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'ambiguous',
					startedAt: '2026-06-01T13:00:00Z',
					endedAt: '2026-06-01T14:00:00Z',
					durationMinutes: 30
				}
			})
		);
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error).toBe('AMBIGUOUS_MODE');
	});

	it('order=desc returns the newest first and limit=1 returns exactly one entry', async () => {
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'first',
					startedAt: '2026-06-01T08:00:00Z',
					endedAt: '2026-06-01T09:00:00Z'
				}
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'second',
					startedAt: '2026-06-01T09:00:00Z',
					endedAt: '2026-06-01T10:00:00Z'
				}
			})
		);

		const asc = await bodyOf(
			await activitiesGet(
				mockEvent({
					url: `${BASE}/api/activities?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z`
				})
			)
		);
		const ascEntries = asc.entries as Record<string, unknown>[];
		expect(ascEntries[0].description).toBe('first');

		const desc = await bodyOf(
			await activitiesGet(
				mockEvent({
					url: `${BASE}/api/activities?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z&order=desc`
				})
			)
		);
		const descEntries = desc.entries as Record<string, unknown>[];
		expect(descEntries[0].description).toBe('second');

		const limited = await bodyOf(
			await activitiesGet(
				mockEvent({
					url: `${BASE}/api/activities?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z&limit=1`
				})
			)
		);
		expect((limited.entries as unknown[]).length).toBe(1);
	});

	it('a repeated Idempotency-Key with a different body is rejected; an illegal key is 400', async () => {
		const first = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				headers: { 'idempotency-key': 'idem-key-1' },
				body: {
					projectId,
					description: 'first body',
					startedAt: '2026-06-01T13:00:00Z',
					endedAt: '2026-06-01T14:00:00Z'
				}
			})
		);
		expect(first.status).toBe(201);

		const replay = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				headers: { 'idempotency-key': 'idem-key-1' },
				body: {
					projectId,
					description: 'first body',
					startedAt: '2026-06-01T13:00:00Z',
					endedAt: '2026-06-01T14:00:00Z'
				}
			})
		);
		expect(replay.status).toBe(201);
		const firstBody = (await bodyOf(first)).entry as Record<string, unknown>;
		const replayBody = (await bodyOf(replay)).entry as Record<string, unknown>;
		expect(replayBody.id).toBe(firstBody.id);

		const differentBody = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				headers: { 'idempotency-key': 'idem-key-1' },
				body: {
					projectId,
					description: 'DIFFERENT body',
					startedAt: '2026-06-01T13:00:00Z',
					endedAt: '2026-06-01T14:00:00Z'
				}
			})
		);
		expect(differentBody.status).toBe(409);
		expect((await bodyOf(differentBody)).error).toBe('IDEMPOTENCY_KEY_REUSED');

		const illegalKey = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				headers: { 'idempotency-key': 'not a valid key!' },
				body: {
					projectId,
					description: 'x',
					startedAt: '2026-06-01T13:00:00Z',
					endedAt: '2026-06-01T14:00:00Z'
				}
			})
		);
		expect(illegalKey.status).toBe(400);
	});

	it("Duration_Mode with date set to yesterday places against yesterday's frame", async () => {
		await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-05-31T08:00:00Z', endedAt: '2026-05-31T10:00:00Z' }
			})
		);
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'yesterday duration',
					date: '2026-05-31',
					startedAt: '2026-05-31T08:00:00Z',
					durationMinutes: 60
				}
			})
		);
		expect(res.status).toBe(201);
		const entry = (await bodyOf(res)).entry as Record<string, unknown>;
		expect((entry.requestedStartedAt as string).startsWith('2026-05-31')).toBe(true);
	});

	it('ACTIVITY_OVERLAP carries the entry id, project name, description and interval per conflict', async () => {
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'first entry',
					startedAt: '2026-06-01T08:00:00Z',
					endedAt: '2026-06-01T09:00:00Z'
				}
			})
		);
		const overlap = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'second entry',
					startedAt: '2026-06-01T08:30:00Z',
					endedAt: '2026-06-01T09:30:00Z'
				}
			})
		);
		expect(overlap.status).toBe(409);
		const body = await bodyOf(overlap);
		expect(body.error).toBe('ACTIVITY_OVERLAP');
		const details = body.details as Record<string, unknown>;
		const conflicts = details.conflicts as Record<string, unknown>[];
		expect(conflicts.length).toBeGreaterThan(0);
		expect(conflicts[0].projectName).toBe('Activities Test');
		expect(conflicts[0].description).toBe('first entry');
		expect(conflicts[0].interval).toBeDefined();
	});

	it('GET, PATCH (meta-only and interval), and DELETE round-trip an entry', async () => {
		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'round trip',
							startedAt: '2026-06-01T13:00:00Z',
							endedAt: '2026-06-01T14:00:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;
		const id = created.id as string;

		const fetched = await bodyOf(
			await activityGet(mockEvent({ url: `${BASE}/api/activities/${id}`, params: { id } }))
		);
		expect(fetched.id).toBe(id);

		const metaPatched = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${id}`,
					params: { id },
					body: { description: 'renamed' }
				})
			)
		);
		expect((metaPatched.entry as Record<string, unknown>).description).toBe('renamed');

		const intervalPatched = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${id}`,
					params: { id },
					body: { startedAt: '2026-06-01T09:00:00Z', endedAt: '2026-06-01T10:00:00Z' }
				})
			)
		);
		const patchedEntry = intervalPatched.entry as Record<string, unknown>;
		expect(patchedEntry.mode).toBe('explicit');
		expect(patchedEntry.requestedStartedAt).toBe('2026-06-01T09:00:00.000Z');

		const del = await activityDelete(
			mockEvent({ method: 'DELETE', url: `${BASE}/api/activities/${id}`, params: { id } })
		);
		expect(del.status).toBe(204);

		const gone = await activityGet(
			mockEvent({ url: `${BASE}/api/activities/${id}`, params: { id } })
		);
		expect(gone.status).toBe(404);
	});

	it('a PATCH rescuing an orphan produces orphaned: false; a failed rescue is NOTHING_TO_LOG and leaves it untouched', async () => {
		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'orphan candidate',
							startedAt: '2026-06-01T08:00:00Z',
							endedAt: '2026-06-01T08:30:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;
		const id = created.id as string;

		const rescued = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${id}`,
					params: { id },
					body: { startedAt: '2026-06-01T09:00:00Z', endedAt: '2026-06-01T09:30:00Z' }
				})
			)
		);
		expect((rescued.entry as Record<string, unknown>).orphaned).toBe(false);

		const failedRescue = await activityPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/activities/${id}`,
				params: { id },
				body: { startedAt: '2026-06-01T14:50:00Z', endedAt: '2026-06-01T15:00:00Z' }
			})
		);
		expect(failedRescue.status).toBe(409);
		expect((await bodyOf(failedRescue)).error).toBe('NOTHING_TO_LOG');

		const stillThere = await bodyOf(
			await activityGet(mockEvent({ url: `${BASE}/api/activities/${id}`, params: { id } }))
		);
		expect(stillThere.requestedStartedAt).toBe('2026-06-01T09:00:00.000Z');
	});

	it('PATCH moving an entry to an archived project is rejected with PROJECT_ARCHIVED', async () => {
		const archivedProject = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Archived' } })
			)
		);
		const { PATCH: projectPatch } = await import('../../src/routes/api/projects/[id]/+server');
		await projectPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/projects/${archivedProject.id}`,
				params: { id: archivedProject.id as string },
				body: { archived: true }
			})
		);

		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'move me',
							startedAt: '2026-06-01T13:00:00Z',
							endedAt: '2026-06-01T14:00:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;

		const res = await activityPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/activities/${created.id}`,
				params: { id: created.id as string },
				body: { projectId: archivedProject.id }
			})
		);
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error).toBe('PROJECT_ARCHIVED');
	});

	it('range over 366 days is rejected with RANGE_TOO_LARGE', async () => {
		const res = await activitiesGet(
			mockEvent({
				url: `${BASE}/api/activities?from=2020-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`
			})
		);
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error).toBe('RANGE_TOO_LARGE');
	});

	// --- 003-worklog-time-categories, task 5.10: Leisure_Entry create/patch/delete ---

	it('creates a Leisure_Entry in Explicit_Mode with no projectId at all', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					description: 'evening off',
					startedAt: '2026-06-01T20:00:00Z',
					endedAt: '2026-06-01T21:00:00Z'
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await bodyOf(res);
		const entry = body.entry as Record<string, unknown>;
		expect(entry.projectId).toBeNull();
		expect(entry.projectName).toBeNull();
		expect(entry.colorIndex).toBeNull();
		expect(entry.category).toBe('relax');
	});

	it('creates a Leisure_Entry in Duration_Mode, bounded at the Target_Day end', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					description: 'late duration leisure',
					date: '2026-06-01',
					startedAt: '2026-06-01T23:00:00Z',
					durationMinutes: 180
				}
			})
		);
		expect(res.status).toBe(201);
		const body = await bodyOf(res);
		const entry = body.entry as Record<string, unknown>;
		const segments = entry.segments as { startedAt: string; endedAt: string }[];
		const totalMs = segments.reduce(
			(sum, s) => sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()),
			0
		);
		// Bounded at the Target_Day end (03:00 Europe/Prague, or whatever DAY_START_HOUR
		// resolves to in UTC for this fixture) rather than running the full 180 minutes.
		expect(totalMs).toBeLessThanOrEqual(180 * 60_000);
		expect(totalMs).toBeGreaterThan(0);
	});

	it('creates a Leisure_Entry in Open_Mode on the CURRENT Logical_Day with no Work_Session at all (day-start anchor)', async () => {
		// resolveCreateWindow reads the real wall clock, not a test-controlled `now`
		// (unlike the service-layer tests in tests/lib/server/services/activities.test.ts,
		// which do control it) — so this only exercises the day-start success path when
		// the target date IS today, matching days.test.ts's own "quickLog on the current
		// Logical_Day" convention. Requirement 3.12's past-day dead end is covered by the
		// next test.
		const config = getConfig();
		const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
		const todayDate = dayResolver.dateOf(new Date());
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: { description: 'open leisure, no session today', date: todayDate }
			})
		);
		expect(res.status).toBe(201);
		const body = await bodyOf(res);
		expect((body.anchor as Record<string, unknown>).source).toBe('day-start');
		expect((body.entry as Record<string, unknown>).projectId).toBeNull();
	});

	it('accepts an empty description on a Leisure_Entry, exactly as for a Work_Entry', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: { description: '', startedAt: '2026-06-01T20:00:00Z', endedAt: '2026-06-01T20:30:00Z' }
			})
		);
		expect(res.status).toBe(201);
	});

	it('a sub-MIN_INTERVAL_SECONDS Leisure_Entry is rejected as NOTHING_TO_LOG (all-slivers)', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					description: 'too short',
					startedAt: '2026-06-01T20:00:00Z',
					endedAt: '2026-06-01T20:00:30Z'
				}
			})
		);
		expect(res.status).toBe(409);
		expect((await bodyOf(res)).error).toBe('NOTHING_TO_LOG');
	});

	it('VALIDATION_ERROR when a supplied projectId names no existing Project', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: '00000000-0000-0000-0000-000000000000',
					description: 'unknown project',
					startedAt: '2026-06-01T20:00:00Z',
					endedAt: '2026-06-01T21:00:00Z'
				}
			})
		);
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error).toBe('VALIDATION_ERROR');
	});

	it('PROJECT_ARCHIVED when a supplied projectId names an archived Project', async () => {
		const archivedProject = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Archived Leisure' } })
			)
		);
		const { PATCH: projectPatch } = await import('../../src/routes/api/projects/[id]/+server');
		await projectPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/projects/${archivedProject.id}`,
				params: { id: archivedProject.id as string },
				body: { archived: true }
			})
		);
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: archivedProject.id,
					description: 'archived',
					startedAt: '2026-06-01T20:00:00Z',
					endedAt: '2026-06-01T21:00:00Z'
				}
			})
		);
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error).toBe('PROJECT_ARCHIVED');
	});

	it('ACTIVITY_OVERLAP between a Leisure_Entry and a Work_Entry, in either order', async () => {
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'work first',
					startedAt: '2026-06-01T09:00:00Z',
					endedAt: '2026-06-01T10:00:00Z'
				}
			})
		);
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					description: 'leisure overlapping work',
					startedAt: '2026-06-01T09:30:00Z',
					endedAt: '2026-06-01T10:30:00Z'
				}
			})
		);
		expect(res.status).toBe(409);
		expect((await bodyOf(res)).error).toBe('ACTIVITY_OVERLAP');
	});

	it('Requirement 3.12: Open_Mode leisure on a PAST day with no Work_Session is NOTHING_TO_LOG', async () => {
		const res = await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: { description: 'past day, no session', date: '2020-01-01' }
			})
		);
		expect(res.status).toBe(409);
		expect((await bodyOf(res)).error).toBe('NOTHING_TO_LOG');
	});

	it('deletes a Leisure_Entry exactly as a Work_Entry', async () => {
		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							description: 'to delete',
							startedAt: '2026-06-01T20:00:00Z',
							endedAt: '2026-06-01T21:00:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;
		const del = await activityDelete(
			mockEvent({ method: 'DELETE', url: `${BASE}/api/activities/${created.id}`, params: { id: created.id as string } })
		);
		expect(del.status).toBe(204);
	});

	it('lists a Leisure_Entry alongside a Work_Entry in the documented order', async () => {
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'work at 09',
					startedAt: '2026-06-01T09:00:00Z',
					endedAt: '2026-06-01T10:00:00Z'
				}
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					description: 'leisure at 20',
					startedAt: '2026-06-01T20:00:00Z',
					endedAt: '2026-06-01T21:00:00Z'
				}
			})
		);
		const list = await bodyOf(
			await activitiesGet(
				mockEvent({
					url: `${BASE}/api/activities?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z`
				})
			)
		);
		const entries = list.entries as Record<string, unknown>[];
		expect(entries).toHaveLength(2);
		expect(entries.map((e) => e.description)).toEqual(['work at 09', 'leisure at 20']);
	});

	it('PATCH converts a Work_Entry to a Leisure_Entry (projectId: null) and back', async () => {
		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'convert me',
							startedAt: '2026-06-01T09:00:00Z',
							endedAt: '2026-06-01T10:00:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;

		const toLeisure = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${created.id}`,
					params: { id: created.id as string },
					body: { projectId: null }
				})
			)
		);
		const leisureEntry = toLeisure.entry as Record<string, unknown>;
		expect(leisureEntry.projectId).toBeNull();
		expect(leisureEntry.category).toBe('relax');

		const backToWork = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${created.id}`,
					params: { id: created.id as string },
					body: { projectId }
				})
			)
		);
		const workEntry = backToWork.entry as Record<string, unknown>;
		expect(workEntry.projectId).toBe(projectId);
		expect(workEntry.category).not.toBe('relax');
	});

	it('a description-only PATCH and a Project-to-Project PATCH stay meta-only (unchanged behaviour)', async () => {
		const otherProject = await bodyOf(
			await projectsPost(mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Other Project' } }))
		);
		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'meta only',
							startedAt: '2026-06-01T09:00:00Z',
							endedAt: '2026-06-01T10:00:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;

		const renamed = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${created.id}`,
					params: { id: created.id as string },
					body: { description: 'renamed' }
				})
			)
		);
		expect((renamed.entry as Record<string, unknown>).description).toBe('renamed');

		const reassigned = await bodyOf(
			await activityPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/activities/${created.id}`,
					params: { id: created.id as string },
					body: { projectId: otherProject.id }
				})
			)
		);
		expect((reassigned.entry as Record<string, unknown>).projectId).toBe(otherProject.id);
	});

	it('a JSON PATCH supplying clearProject is rejected — projectId: null is the one JSON encoding', async () => {
		const created = (
			await bodyOf(
				await activitiesPost(
					mockEvent({
						method: 'POST',
						url: `${BASE}/api/activities`,
						body: {
							projectId,
							description: 'no clearProject over JSON',
							startedAt: '2026-06-01T09:00:00Z',
							endedAt: '2026-06-01T10:00:00Z'
						}
					})
				)
			)
		).entry as Record<string, unknown>;

		const res = await activityPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/activities/${created.id}`,
				params: { id: created.id as string },
				body: { clearProject: true }
			})
		);
		expect(res.status).toBe(400);
		expect((await bodyOf(res)).error).toBe('VALIDATION_ERROR');
	});
});
