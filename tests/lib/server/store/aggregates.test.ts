import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import {
	createDayResolver,
	materializeWallClock
} from '../../../../src/lib/server/domain/logical-day';
import { createProject } from '../../../../src/lib/server/store/projects';
import { createEntry } from '../../../../src/lib/server/store/activities';
import { insertSessions } from '../../../../src/lib/server/store/work-sessions';
import {
	daySummaries,
	dayIntervals,
	suggestedWindow
} from '../../../../src/lib/server/store/aggregates';

const resolver = createDayResolver('Europe/Prague', 3);

function dayWindow(date: string) {
	return { date, window: resolver.bounds(date) };
}

function gaugeWindowFor(date: string) {
	// The default Gauge_Window: 06:00 on `date` to 00:00 the next date.
	return {
		start: materializeWallClock(date, 6, 0, 'Europe/Prague'),
		end: materializeWallClock(addOneDay(date), 0, 0, 'Europe/Prague')
	};
}

function addOneDay(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
	return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

describe('aggregates store', () => {
	it('daySummaries matches figures computed by hand over a seeded day', async () => {
		const project = await withTx((tx) => createProject(tx, 'Aggregates Project'));
		await withTx((tx) =>
			insertSessions(tx, [
				{ start: new Date('2026-07-15T08:00:00Z'), end: new Date('2026-07-15T14:48:00Z') },
				{ start: new Date('2026-07-15T15:12:00Z'), end: new Date('2026-07-15T18:00:00Z') }
			])
		);
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: project.id,
					description: '',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-15T13:00:00Z'),
					requestedEndedAt: new Date('2026-07-15T16:00:00Z'),
					requestedDurationMinutes: null
				},
				[
					{ start: new Date('2026-07-15T13:00:00Z'), end: new Date('2026-07-15T14:48:00Z') },
					{ start: new Date('2026-07-15T15:12:00Z'), end: new Date('2026-07-15T16:00:00Z') }
				]
			)
		);

		const date = '2026-07-15';
		const [summary] = await withTx((tx) =>
			daySummaries(tx, [dayWindow(date)], {
				gaugeWindows: [gaugeWindowFor(date)],
				eveningStarts: [materializeWallClock(date, 21, 0, 'Europe/Prague')],
				now: new Date()
			})
		);

		expect(summary.trackedSeconds).toBe(6 * 3600 + 48 * 60 + (2 * 3600 + 48 * 60));
		expect(summary.coveredSeconds).toBe(1 * 3600 + 48 * 60 + 48 * 60);
		expect(summary.sessionCount).toBe(2);
		expect(summary.longestBlockSeconds).toBe(6 * 3600 + 48 * 60);
		expect(summary.byProject.reduce((sum, p) => sum + p.coveredSeconds, 0)).toBe(
			summary.coveredSeconds
		);
	});

	it('longestBlockSeconds merges two touching sessions into one block while sessionCount still reports two', async () => {
		await withTx((tx) =>
			insertSessions(tx, [
				{ start: new Date('2026-07-16T08:00:00Z'), end: new Date('2026-07-16T10:00:00Z') },
				{ start: new Date('2026-07-16T10:00:00Z'), end: new Date('2026-07-16T12:00:00Z') }
			])
		);
		const date = '2026-07-16';
		const [summary] = await withTx((tx) =>
			daySummaries(tx, [dayWindow(date)], {
				gaugeWindows: [gaugeWindowFor(date)],
				eveningStarts: [materializeWallClock(date, 21, 0, 'Europe/Prague')],
				now: new Date()
			})
		);
		expect(summary.sessionCount).toBe(2);
		expect(summary.longestBlockSeconds).toBe(4 * 3600);
	});

	it('suggestedWindow returns a window crossing midnight for an evening worker, null for an empty range', async () => {
		const nullResult = await withTx((tx) =>
			suggestedWindow(tx, [dayWindow('2026-07-17')], new Date())
		);
		expect(nullResult).toBeNull();

		// Prague is UTC+2 in July (CEST): local 20:00-23:59 and local 00:01-01:00 the
		// next day are both on 2026-07-20 in UTC (18:00-21:59Z and 22:01-23:00Z) — a
		// span that crosses real midnight but stays well clear of the 03:00
		// Logical_Day boundary, which criterion 8.22 requires the suggestion to leave
		// in the Gauge_Gap. A span straddling 03:00 itself (e.g. local 22:00-04:00)
		// has no valid suggestion at all — that is Requirement 8.21's normal null.
		await withTx((tx) =>
			insertSessions(tx, [
				{ start: new Date('2026-07-20T18:00:00Z'), end: new Date('2026-07-20T21:59:00Z') },
				{ start: new Date('2026-07-20T22:01:00Z'), end: new Date('2026-07-20T23:00:00Z') }
			])
		);
		const window = await withTx((tx) =>
			suggestedWindow(tx, [dayWindow('2026-07-20')], new Date('2026-07-21T12:00:00Z'))
		);
		expect(window).not.toBeNull();
	});

	it('a day mixing a billable Work_Entry, a non-billable one, and a Leisure_Entry with no overlapping Work_Session', async () => {
		const paidProject = await withTx((tx) => createProject(tx, 'Paid Aggregates Project', true));
		const unpaidProject = await withTx((tx) =>
			createProject(tx, 'Unpaid Aggregates Project', false)
		);

		await withTx((tx) =>
			insertSessions(tx, [
				{ start: new Date('2026-07-21T08:00:00Z'), end: new Date('2026-07-21T12:00:00Z') }
			])
		);
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: paidProject.id,
					description: 'paid work',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-21T08:00:00Z'),
					requestedEndedAt: new Date('2026-07-21T09:00:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-21T08:00:00Z'), end: new Date('2026-07-21T09:00:00Z') }]
			)
		);
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: unpaidProject.id,
					description: 'unpaid work',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-21T09:00:00Z'),
					requestedEndedAt: new Date('2026-07-21T10:30:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-21T09:00:00Z'), end: new Date('2026-07-21T10:30:00Z') }]
			)
		);
		// Well outside the Work_Session entirely — no timer needs to have run for it.
		await withTx((tx) =>
			createEntry(
				tx,
				{
					projectId: null,
					description: 'evening leisure',
					mode: 'explicit',
					requestedStartedAt: new Date('2026-07-21T20:00:00Z'),
					requestedEndedAt: new Date('2026-07-21T21:30:00Z'),
					requestedDurationMinutes: null
				},
				[{ start: new Date('2026-07-21T20:00:00Z'), end: new Date('2026-07-21T21:30:00Z') }]
			)
		);

		const date = '2026-07-21';
		const [summary] = await withTx((tx) =>
			daySummaries(tx, [dayWindow(date)], {
				gaugeWindows: [gaugeWindowFor(date)],
				eveningStarts: [materializeWallClock(date, 21, 0, 'Europe/Prague')],
				now: new Date()
			})
		);

		// coveredSeconds/uncoveredSeconds are unaffected by the leisure rows.
		expect(summary.coveredSeconds).toBe(3600 + 90 * 60);
		expect(summary.uncoveredSeconds).toBe(4 * 3600 - (3600 + 90 * 60));
		// paidSeconds/unpaidSeconds/relaxSeconds each match hand computation.
		expect(summary.paidSeconds).toBe(3600);
		expect(summary.unpaidSeconds).toBe(90 * 60);
		expect(summary.paidSeconds + summary.unpaidSeconds).toBe(summary.coveredSeconds);
		expect(summary.relaxSeconds).toBe(90 * 60);

		const { leisure } = await withTx((tx) => dayIntervals(tx, [dayWindow(date)], new Date()));
		expect(leisure[0]).toHaveLength(1);
		expect(leisure[0][0].start.toISOString()).toBe('2026-07-21T20:00:00.000Z');
		expect(leisure[0][0].end.toISOString()).toBe('2026-07-21T21:30:00.000Z');
	});
});
