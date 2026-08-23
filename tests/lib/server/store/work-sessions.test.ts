import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import {
	closeOpenSession,
	currentOpenSession,
	insertSessions,
	listSessionsOverlapping,
	openSession,
	trackedIntervals
} from '../../../../src/lib/server/store/work-sessions';

describe('work-sessions store', () => {
	it('start, stop, current when none open', async () => {
		expect(await withTx((tx) => currentOpenSession(tx))).toBeNull();

		const started = await withTx((tx) => openSession(tx, new Date('2026-07-01T08:00:00Z')));
		expect(started.endedAt).toBeNull();

		const current = await withTx((tx) => currentOpenSession(tx));
		expect(current?.id).toBe(started.id);

		const stopped = await withTx((tx) => closeOpenSession(tx, new Date('2026-07-01T09:00:00Z')));
		expect(stopped?.endedAt?.toISOString()).toBe('2026-07-01T09:00:00.000Z');

		expect(await withTx((tx) => currentOpenSession(tx))).toBeNull();
	});

	it('creates closed sessions directly', async () => {
		const sessions = await withTx((tx) =>
			insertSessions(tx, [
				{ start: new Date('2026-07-02T08:00:00Z'), end: new Date('2026-07-02T09:00:00Z') },
				{ start: new Date('2026-07-02T10:00:00Z'), end: new Date('2026-07-02T11:00:00Z') }
			])
		);
		expect(sessions).toHaveLength(2);
	});

	it('lists sessions overlapping a window, including partial overlaps', async () => {
		await withTx((tx) =>
			insertSessions(tx, [
				{ start: new Date('2026-07-03T08:00:00Z'), end: new Date('2026-07-03T09:00:00Z') },
				{ start: new Date('2026-07-03T23:00:00Z'), end: new Date('2026-07-04T01:00:00Z') } // crosses midnight
			])
		);
		const list = await withTx((tx) =>
			listSessionsOverlapping(tx, {
				start: new Date('2026-07-03T00:00:00Z'),
				end: new Date('2026-07-04T00:00:00Z')
			})
		);
		expect(list.length).toBeGreaterThanOrEqual(2);
		// The session crossing midnight keeps its TRUE bounds, not clamped.
		const crossing = list.find((s) => s.startedAt.toISOString() === '2026-07-03T23:00:00.000Z');
		expect(crossing?.endedAt?.toISOString()).toBe('2026-07-04T01:00:00.000Z');
	});

	it('trackedIntervals includes an Open_Session capped at MAX_OPEN_SESSION_HOURS', async () => {
		const staleStart = new Date(Date.now() - 20 * 3_600_000);
		await withTx((tx) => openSession(tx, staleStart));
		const now = new Date();
		const tracked = await withTx((tx) =>
			trackedIntervals(tx, [{ start: staleStart, end: now }], now)
		);
		const totalMs = tracked.reduce((sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()), 0);
		// MAX_OPEN_SESSION_HOURS defaults to 12.
		expect(totalMs).toBeLessThanOrEqual(12 * 3_600_000 + 1000);
		expect(totalMs).toBeGreaterThan(11 * 3_600_000);
		await withTx((tx) => closeOpenSession(tx, now));
	});
});
