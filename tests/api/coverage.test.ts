import { describe, expect, it } from 'vitest';
import { mockEvent, bodyOf } from './helpers';
import { GET as coverageGet } from '../../src/routes/api/coverage/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';
import { POST as activitiesPost } from '../../src/routes/api/activities/+server';
import { POST as projectsPost } from '../../src/routes/api/projects/+server';

const BASE = 'http://localhost';

describe('coverage route', () => {
	it('tracked, covered, uncovered and untracked reconstruct the frame exactly', async () => {
		const project = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Coverage Test' } })
			)
		);
		await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-07-30T08:00:00Z', endedAt: '2026-07-30T12:00:00Z' }
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: project.id,
					description: 'covered stretch',
					startedAt: '2026-07-30T09:00:00Z',
					endedAt: '2026-07-30T10:00:00Z'
				}
			})
		);

		const res = await coverageGet(
			mockEvent({ url: `${BASE}/api/coverage?from=2026-07-30T00:00:00Z&to=2026-07-31T00:00:00Z` })
		);
		expect(res.status).toBe(200);
		const body = await bodyOf(res);
		const totals = body.totals as Record<string, unknown>;
		expect(totals.trackedSeconds).toBe(14400);
		expect(totals.coveredSeconds).toBe(3600);
		expect(totals.uncoveredSeconds).toBe(10800);
		expect(totals.untrackedSeconds).toBe(86400 - 14400);

		// tracked = covered + uncovered, exactly
		expect((totals.coveredSeconds as number) + (totals.uncoveredSeconds as number)).toBe(
			totals.trackedSeconds
		);
		// untracked holds the Untracked_Time breaks — the whole day minus tracked
		expect((totals.trackedSeconds as number) + (totals.untrackedSeconds as number)).toBe(86400);
	});

	it('min_gap_seconds filters the uncovered list but never the totals', async () => {
		const project = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Gap Test' } })
			)
		);
		await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-07-31T08:00:00Z', endedAt: '2026-07-31T12:00:00Z' }
			})
		);
		// Covered on both sides of a tiny 30-second uncovered gap at 09:59:30-10:00:00.
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: project.id,
					description: 'first half',
					startedAt: '2026-07-31T09:00:00Z',
					endedAt: '2026-07-31T09:59:30Z'
				}
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: project.id,
					description: 'second half',
					startedAt: '2026-07-31T10:00:00Z',
					endedAt: '2026-07-31T11:00:00Z'
				}
			})
		);

		const unfiltered = await bodyOf(
			await coverageGet(
				mockEvent({ url: `${BASE}/api/coverage?from=2026-07-31T00:00:00Z&to=2026-08-01T00:00:00Z` })
			)
		);
		const unfilteredUncovered = unfiltered.uncovered as unknown[];
		const unfilteredTotals = unfiltered.totals as Record<string, unknown>;

		const filtered = await bodyOf(
			await coverageGet(
				mockEvent({
					url: `${BASE}/api/coverage?from=2026-07-31T00:00:00Z&to=2026-08-01T00:00:00Z&min_gap_seconds=60`
				})
			)
		);
		const filteredUncovered = filtered.uncovered as unknown[];
		const filteredTotals = filtered.totals as Record<string, unknown>;

		expect(filteredUncovered.length).toBeLessThan(unfilteredUncovered.length);
		expect(filteredTotals.uncoveredSeconds).toBe(unfilteredTotals.uncoveredSeconds);
	});

	it('from after to is 400', async () => {
		const res = await coverageGet(
			mockEvent({ url: `${BASE}/api/coverage?from=2026-08-02T00:00:00Z&to=2026-08-01T00:00:00Z` })
		);
		expect(res.status).toBe(400);
	});
});
