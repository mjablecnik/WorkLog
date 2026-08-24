import { describe, expect, it } from 'vitest';
import { mockEvent, bodyOf } from './helpers';
import { POST as startPost } from '../../src/routes/api/sessions/start/+server';
import { POST as stopPost } from '../../src/routes/api/sessions/stop/+server';
import { GET as currentGet } from '../../src/routes/api/sessions/current/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';
import {
	PATCH as sessionPatch,
	DELETE as sessionDelete
} from '../../src/routes/api/sessions/[id]/+server';
import { POST as activitiesPost } from '../../src/routes/api/activities/+server';
import { POST as projectsPost } from '../../src/routes/api/projects/+server';

const BASE = 'http://localhost';

async function createProject(name: string): Promise<string> {
	const res = await projectsPost(
		mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name } })
	);
	const body = await bodyOf(res);
	return body.id as string;
}

describe('session routes', () => {
	it('start 201, second start 409, current reports it, stop 200', async () => {
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
		const startRes = await startPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions/start`,
				body: { startedAt: fiveMinutesAgo }
			})
		);
		expect(startRes.status).toBe(201);
		const started = await bodyOf(startRes);
		expect((started.session as Record<string, unknown>).endedAt).toBeNull();

		const currentRes = await currentGet(mockEvent({ url: `${BASE}/api/sessions/current` }));
		const current = await bodyOf(currentRes);
		expect(current.session).not.toBeNull();
		expect(current.stale).toBe(false);

		const secondStart = await startPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/sessions/start` })
		);
		expect(secondStart.status).toBe(409);
		expect((await bodyOf(secondStart)).error).toBe('SESSION_ALREADY_RUNNING');

		const stopRes = await stopPost(mockEvent({ method: 'POST', url: `${BASE}/api/sessions/stop` }));
		expect(stopRes.status).toBe(200);
		const stopped = await bodyOf(stopRes);
		expect(stopped.discarded).toBe(false);

		const currentAfter = await bodyOf(
			await currentGet(mockEvent({ url: `${BASE}/api/sessions/current` }))
		);
		expect(currentAfter.session).toBeNull();
	});

	it('stop with none running answers 409 NO_SESSION_RUNNING', async () => {
		const res = await stopPost(mockEvent({ method: 'POST', url: `${BASE}/api/sessions/stop` }));
		expect(res.status).toBe(409);
		expect((await bodyOf(res)).error).toBe('NO_SESSION_RUNNING');
	});

	it('a sub-floor stop deletes the row and reports discarded: true, not an error', async () => {
		await startPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions/start`,
				body: { startedAt: '2026-06-01T10:00:00+02:00' }
			})
		);
		const res = await stopPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions/stop`,
				body: { endedAt: '2026-06-01T10:00:20+02:00' }
			})
		);
		expect(res.status).toBe(200);
		const body = await bodyOf(res);
		expect(body.discarded).toBe(true);
		expect(body.session).toBeNull();
	});

	it('POST /api/sessions creates a closed session; an inverted interval is 400', async () => {
		const created = await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-06-01T08:00:00Z', endedAt: '2026-06-01T09:00:00Z' }
			})
		);
		expect(created.status).toBe(201);

		const inverted = await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-06-01T09:00:00Z', endedAt: '2026-06-01T08:00:00Z' }
			})
		);
		expect(inverted.status).toBe(400);
	});

	it('POST /api/sessions rejects an overlap 409 with identifiers, a future start 400, and a 30s session 400', async () => {
		await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-06-02T08:00:00Z', endedAt: '2026-06-02T09:00:00Z' }
			})
		);
		const overlap = await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-06-02T08:30:00Z', endedAt: '2026-06-02T09:30:00Z' }
			})
		);
		expect(overlap.status).toBe(409);
		const overlapBody = await bodyOf(overlap);
		expect(overlapBody.error).toBe('SESSION_OVERLAP');
		const details = overlapBody.details as Record<string, unknown>;
		expect(Array.isArray(details.conflicts)).toBe(true);

		const future = new Date(Date.now() + 3_600_000).toISOString();
		const futureRes = await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: future, endedAt: new Date(Date.now() + 7_200_000).toISOString() }
			})
		);
		expect(futureRes.status).toBe(400);
		expect((await bodyOf(futureRes)).error).toBe('FUTURE_TIMESTAMP');

		const shortRes = await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-06-03T08:00:00Z', endedAt: '2026-06-03T08:00:30Z' }
			})
		);
		expect(shortRes.status).toBe(400);
		expect((await bodyOf(shortRes)).error).toBe('INTERVAL_TOO_SHORT');
	});

	it('DELETE 204 and re-applies clipping; dryRun DELETE answers 200 and leaves rows untouched', async () => {
		const projectId = await createProject('Session Delete Project');
		const created = await bodyOf(
			await sessionsPost(
				mockEvent({
					method: 'POST',
					url: `${BASE}/api/sessions`,
					body: { startedAt: '2026-06-04T08:00:00Z', endedAt: '2026-06-04T12:00:00Z' }
				})
			)
		);
		const sessionId = (created.session as Record<string, unknown>).id as string;

		const activity = await bodyOf(
			await activitiesPost(
				mockEvent({
					method: 'POST',
					url: `${BASE}/api/activities`,
					body: {
						projectId,
						description: 'inside the session',
						startedAt: '2026-06-04T09:00:00Z',
						endedAt: '2026-06-04T10:00:00Z'
					}
				})
			)
		);
		expect((activity.entry as Record<string, unknown>).id).toBeDefined();

		const preview = await sessionDelete(
			mockEvent({
				url: `${BASE}/api/sessions/${sessionId}?dry_run=true`,
				params: { id: sessionId }
			})
		);
		expect(preview.status).toBe(200);
		const previewBody = await bodyOf(preview);
		expect(previewBody.dryRun).toBe(true);
		expect((previewBody.reclipped as unknown[]).length).toBeGreaterThan(0);

		const real = await sessionDelete(
			mockEvent({ url: `${BASE}/api/sessions/${sessionId}`, params: { id: sessionId } })
		);
		expect(real.status).toBe(204);
	});

	it('POST /api/sessions/stop with dryRun reports the re-clip and closes nothing', async () => {
		const projectId = await createProject('Stop Dry Run Project');
		await startPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions/start`,
				body: { startedAt: '2026-06-05T08:00:00Z' }
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'during open session',
					startedAt: '2026-06-05T08:15:00Z',
					endedAt: '2026-06-05T08:45:00Z'
				}
			})
		);

		const preview = await bodyOf(
			await stopPost(
				mockEvent({
					method: 'POST',
					url: `${BASE}/api/sessions/stop`,
					body: { endedAt: '2026-06-05T08:20:00Z', dryRun: true }
				})
			)
		);
		expect(preview.dryRun).toBe(true);
		expect((preview.reclipped as unknown[]).length).toBeGreaterThan(0);

		// the timer must still be running afterward
		const current = await bodyOf(
			await currentGet(mockEvent({ url: `${BASE}/api/sessions/current` }))
		);
		expect(current.session).not.toBeNull();
	});

	it('shortening a session reports the loss precisely: covered vs uncovered vs both', async () => {
		const projectId = await createProject('Shorten Project');
		const created = await bodyOf(
			await sessionsPost(
				mockEvent({
					method: 'POST',
					url: `${BASE}/api/sessions`,
					body: { startedAt: '2026-06-06T08:00:00Z', endedAt: '2026-06-06T12:00:00Z' }
				})
			)
		);
		const sessionId = (created.session as Record<string, unknown>).id as string;

		// Described stretch at the very end (10:00-12:00) — will be entirely cut off.
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'covered tail',
					startedAt: '2026-06-06T10:00:00Z',
					endedAt: '2026-06-06T11:00:00Z'
				}
			})
		);

		// Shorten the session so 10:00-12:00 (11:00-12:00 uncovered, 10:00-11:00 covered)
		// falls outside Tracked_Time. Previewed with dryRun, which is the only response
		// shape carrying `reclipped`/`lostUncoveredSeconds` — a real write answers the
		// plain SessionWriteResponse instead.
		const patched = await bodyOf(
			await sessionPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/sessions/${sessionId}`,
					params: { id: sessionId },
					body: { endedAt: '2026-06-06T10:00:00Z', dryRun: true }
				})
			)
		);
		expect((patched.reclipped as unknown[]).length).toBeGreaterThan(0);
		expect(patched.lostUncoveredSeconds).toBe(3600); // 11:00-12:00, described by nothing

		// The real write leaves the plain shape and actually applies the change.
		const real = await bodyOf(
			await sessionPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/sessions/${sessionId}`,
					params: { id: sessionId },
					body: { endedAt: '2026-06-06T10:00:00Z' }
				})
			)
		);
		expect(real.reclipped).toBeUndefined();
		expect((real.session as Record<string, unknown>).endedAt).toBe('2026-06-06T10:00:00.000Z');
	});
});
