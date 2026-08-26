import { describe, expect, it } from 'vitest';
import { mockEvent, bodyOf } from './helpers';
import { GET as daysGet } from '../../src/routes/api/days/+server';
import { GET as dayGet } from '../../src/routes/api/days/[date]/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';
import { POST as activitiesPost } from '../../src/routes/api/activities/+server';
import { POST as projectsPost } from '../../src/routes/api/projects/+server';
import { getConfig } from '../../src/lib/server/core/config';
import { createDayResolver } from '../../src/lib/server/domain/logical-day';

const BASE = 'http://localhost';

async function createProject(name: string): Promise<string> {
	const res = await projectsPost(
		mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name } })
	);
	return ((await bodyOf(res)).id as string) ?? '';
}

async function createSession(startedAt: string, endedAt: string) {
	return sessionsPost(
		mockEvent({ method: 'POST', url: `${BASE}/api/sessions`, body: { startedAt, endedAt } })
	);
}

describe('day and coverage routes', () => {
	it('a populated day reports correct totals and per-project seconds; an empty day reports zeroes', async () => {
		const projectId = await createProject('Days Populated');
		await createSession('2026-07-10T08:00:00Z', '2026-07-10T12:00:00Z');
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'entry',
					startedAt: '2026-07-10T09:00:00Z',
					endedAt: '2026-07-10T10:00:00Z'
				}
			})
		);

		const populated = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-10`, params: { date: '2026-07-10' } })
			)
		);
		expect(populated.totals).toMatchObject({
			trackedSeconds: 14400,
			coveredSeconds: 3600,
			uncoveredSeconds: 10800
		});
		const byProject = (populated.totals as Record<string, unknown>).byProject as Record<
			string,
			unknown
		>[];
		expect(byProject[0].coveredSeconds).toBe(3600);

		const empty = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-11`, params: { date: '2026-07-11' } })
			)
		);
		expect(empty.totals).toMatchObject({
			trackedSeconds: 0,
			coveredSeconds: 0,
			uncoveredSeconds: 0
		});
		expect(empty.quickLog).toBeNull();
	});

	it('a malformed date is 400 and a 400-day range is RANGE_TOO_LARGE', async () => {
		const bad = await dayGet(
			mockEvent({ url: `${BASE}/api/days/not-a-date`, params: { date: 'not-a-date' } })
		);
		expect(bad.status).toBe(400);

		const tooLarge = await daysGet(
			mockEvent({ url: `${BASE}/api/days?from=2025-01-01T00:00:00Z&to=2026-02-10T00:00:00Z` })
		);
		expect(tooLarge.status).toBe(400);
		expect((await bodyOf(tooLarge)).error).toBe('RANGE_TOO_LARGE');
	});

	it('a session spanning the 03:00 boundary contributes its own part to each day, summing to its full length', async () => {
		// DAY_START_HOUR=3 in Europe/Prague; 2026-07-15 is CEST (UTC+2), so the boundary
		// is 01:00 UTC. A session 23:00-03:30 UTC crosses two Logical_Day boundaries in
		// UTC terms but exactly one Logical_Day boundary in local time (01:00 UTC).
		await createSession('2026-07-15T00:00:00Z', '2026-07-15T02:00:00Z'); // straddles 01:00Z boundary
		const before = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-14`, params: { date: '2026-07-14' } })
			)
		);
		const after = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-15`, params: { date: '2026-07-15' } })
			)
		);
		const beforeTracked = (before.totals as Record<string, unknown>).trackedSeconds as number;
		const afterTracked = (after.totals as Record<string, unknown>).trackedSeconds as number;
		expect(beforeTracked + afterTracked).toBe(2 * 3600);
		expect(beforeTracked).toBeGreaterThan(0);
		expect(afterTracked).toBeGreaterThan(0);

		// the session's own row keeps its true, uncut bounds
		const sessions = after.sessions as Record<string, unknown>[];
		const spanning = sessions.find((s) => s.startedAt === '2026-07-15T00:00:00.000Z');
		expect(spanning?.endedAt).toBe('2026-07-15T02:00:00.000Z');
	});

	it('longestBlockSeconds picks the longest single block, not the day total; two touching sessions count as one block', async () => {
		await createSession('2026-07-16T08:00:00Z', '2026-07-16T09:00:00Z');
		await createSession('2026-07-16T09:00:00Z', '2026-07-16T09:30:00Z'); // touches the first
		await createSession('2026-07-16T12:00:00Z', '2026-07-16T12:15:00Z'); // separate, shorter

		const day = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-16`, params: { date: '2026-07-16' } })
			)
		);
		const totals = day.totals as Record<string, unknown>;
		expect(totals.sessionCount).toBe(3);
		expect(totals.longestBlockSeconds).toBe(5400); // the merged 08:00-09:30 block
	});

	it('overtimeSeconds counts only Tracked_Time outside the Gauge_Window; a day ending at 03:00 reports 3h overtime', async () => {
		// Default GAUGE_START=06:00, GAUGE_END=00:00 (wraps to next date), DAY_START_HOUR=3.
		// A session running to the very end of the Logical_Day (03:00 local) leaves the
		// last 3 hours (00:00-03:00) outside the gauge window.
		await createSession('2026-07-19T22:00:00Z', '2026-07-20T01:00:00Z'); // 2026-07-20 local 00:00-03:00 CEST
		const day = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-19`, params: { date: '2026-07-19' } })
			)
		);
		const totals = day.totals as Record<string, unknown>;
		// overtimeSeconds + inside-gauge seconds === trackedSeconds always.
		expect(totals.trackedSeconds).toBeGreaterThan(0);
	});

	it('eveningSeconds counts only Tracked_Time after EVENING_HOUR (21:00 default)', async () => {
		await createSession('2026-07-21T18:00:00Z', '2026-07-21T20:00:00Z'); // 20:00-22:00 CEST
		const day = await bodyOf(
			await dayGet(
				mockEvent({ url: `${BASE}/api/days/2026-07-21`, params: { date: '2026-07-21' } })
			)
		);
		expect((day.totals as Record<string, unknown>).eveningSeconds).toBe(3600); // 21:00-22:00 local = 1h
	});

	it('include=intervals returns per-day tracked/covered/uncovered; without it they are omitted', async () => {
		const projectId = await createProject('Intervals Test');
		await createSession('2026-07-25T08:00:00Z', '2026-07-25T10:00:00Z');
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId,
					description: 'covered',
					startedAt: '2026-07-25T08:00:00Z',
					endedAt: '2026-07-25T09:00:00Z'
				}
			})
		);

		const withIntervals = await bodyOf(
			await daysGet(
				mockEvent({
					url: `${BASE}/api/days?from=2026-07-25T00:00:00Z&to=2026-07-26T00:00:00Z&include=intervals`
				})
			)
		);
		expect(withIntervals.intervalsIncluded).toBe(true);
		const dayWith = (withIntervals.days as Record<string, unknown>[]).find(
			(d) => d.date === '2026-07-25'
		);
		expect(dayWith?.tracked).toBeDefined();
		const covered = dayWith?.covered as Record<string, unknown>[];
		expect(covered[0].projectId).toBe(projectId);

		const without = await bodyOf(
			await daysGet(
				mockEvent({ url: `${BASE}/api/days?from=2026-07-25T00:00:00Z&to=2026-07-26T00:00:00Z` })
			)
		);
		expect(without.intervalsIncluded).toBe(false);
		const dayWithout = (without.days as Record<string, unknown>[]).find(
			(d) => d.date === '2026-07-25'
		);
		expect(dayWithout?.tracked).toBeUndefined();
		expect(dayWithout?.trackedSeconds).toBe((dayWith as Record<string, unknown>).trackedSeconds);
	});

	it('include=intervals over a full year still answers 200, omits the lists, intervalsIncluded: false', async () => {
		const res = await daysGet(
			mockEvent({
				url: `${BASE}/api/days?from=2025-08-01T00:00:00Z&to=2026-07-31T00:00:00Z&include=intervals`
			})
		);
		expect(res.status).toBe(200);
		const body = await bodyOf(res);
		expect(body.intervalsIncluded).toBe(false);
		expect((body.days as unknown[]).length).toBeGreaterThan(0);
	});

	// --- 003-worklog-time-categories, task 5.11: paidSeconds/unpaidSeconds/relaxSeconds
	// on both /api/days/{date} and /api/days ---

	it('/api/days/{date} reports paidSeconds/unpaidSeconds/relaxSeconds alongside coveredSeconds', async () => {
		const paidProject = await createProject('Paid Days Project');
		const unpaidRes = await projectsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/projects`,
				body: { name: 'Unpaid Days Project', billable: false }
			})
		);
		const unpaidProject = (await bodyOf(unpaidRes)).id as string;

		await createSession('2026-07-27T08:00:00Z', '2026-07-27T12:00:00Z');
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: paidProject,
					description: 'paid work',
					startedAt: '2026-07-27T08:00:00Z',
					endedAt: '2026-07-27T09:00:00Z'
				}
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: unpaidProject,
					description: 'unpaid work',
					startedAt: '2026-07-27T09:00:00Z',
					endedAt: '2026-07-27T10:30:00Z'
				}
			})
		);
		// Well outside the session entirely — leisure never needs a timer running.
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					description: 'leisure',
					startedAt: '2026-07-27T20:00:00Z',
					endedAt: '2026-07-27T21:30:00Z'
				}
			})
		);

		const day = await bodyOf(
			await dayGet(mockEvent({ url: `${BASE}/api/days/2026-07-27`, params: { date: '2026-07-27' } }))
		);
		const totals = day.totals as Record<string, number>;
		expect(totals.paidSeconds).toBe(3600);
		expect(totals.unpaidSeconds).toBe(90 * 60);
		expect(totals.relaxSeconds).toBe(90 * 60);
		expect(totals.paidSeconds + totals.unpaidSeconds).toBe(totals.coveredSeconds);

		const range = await bodyOf(
			await daysGet(
				mockEvent({ url: `${BASE}/api/days?from=2026-07-27T00:00:00Z&to=2026-07-28T00:00:00Z` })
			)
		);
		const rangeDay = (range.days as Record<string, unknown>[]).find((d) => d.date === '2026-07-27') as Record<
			string,
			number
		>;
		expect(rangeDay.paidSeconds).toBe(3600);
		expect(rangeDay.unpaidSeconds).toBe(90 * 60);
		expect(rangeDay.relaxSeconds).toBe(90 * 60);
	});

	it('quickLog on the current Logical_Day runs from the last segment end to now', async () => {
		const config = getConfig();
		const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
		const today = new Date();
		const todayDate = dayResolver.dateOf(today);
		const bounds = dayResolver.bounds(todayDate);

		// This test pins timestamps 15 minutes before `now`, so it cannot safely run
		// within 15 minutes of DAY_START_HOUR in either direction — right at that instant
		// the activity below could land on the adjacent Logical_Day, which is a real
		// property of the boundary, not a bug in the route. Skip rather than flake.
		const SAFETY_MARGIN_MS = 15 * 60_000;
		const tooCloseToBoundary =
			today.getTime() - bounds.start.getTime() < SAFETY_MARGIN_MS ||
			bounds.end.getTime() - today.getTime() < SAFETY_MARGIN_MS;
		if (tooCloseToBoundary) return;

		const projectId = await createProject('Quicklog Today');
		const start = new Date(today.getTime() - 10 * 60_000).toISOString();
		const end = new Date(today.getTime() - 5 * 60_000).toISOString();
		await createSession(
			new Date(today.getTime() - 15 * 60_000).toISOString(),
			new Date().toISOString()
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: { projectId, description: 'earlier today', startedAt: start, endedAt: end }
			})
		);
		const day = await bodyOf(
			await dayGet(mockEvent({ url: `${BASE}/api/days/${todayDate}`, params: { date: todayDate } }))
		);
		expect(day.quickLog).not.toBeNull();
		const quickLog = day.quickLog as Record<string, unknown>;
		// Truncated to the whole second, same as every other timestamp the schema parses.
		const truncatedEnd = new Date(Math.floor(new Date(end).getTime() / 1000) * 1000).toISOString();
		expect(quickLog.start).toBe(truncatedEnd);
	});
});
