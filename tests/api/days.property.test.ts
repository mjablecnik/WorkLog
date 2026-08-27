/**
 * Property 19 (overtime and in-window time partition the day) and Property 21 (the
 * suggested window brackets the bulk of the work) — task 10.5, deliberately deferred
 * (see `.agents/ISSUES.md`, "Task 10.5 ... not written") after 10.1-10.4's real-database
 * property tests had already grown the suite's runtime substantially. Against the real
 * database, like `dry-run.property.test.ts`; smaller `numRuns` for the same reason.
 *
 * Sweeps three calendar dates for Property 19: an ordinary day, and this config's
 * 23-hour and 25-hour Logical_Day around a Prague DST transition — the cases most
 * likely to catch a `gaugeWindowOfDay` materialised on the wrong date or a wrap
 * handled by clamping instead of moving to the next day. Uses 2024's transitions
 * (`2024-03-30` is 23h, `2024-10-26` is 25h — confirmed directly against
 * `createDayResolver`, not assumed from `tests/lib/server/domain/logical-day.test.ts`'s
 * own 2026 dates), not 2026's: this test writes real `Work_Session` rows through the
 * actual `/api/sessions` route, which rejects a startedAt/endedAt too far in the
 * future (`assertNotTooFarInFuture`) — unlike the domain-layer tests, which call
 * `resolver.bounds()` directly with no wall-clock check at all. 2026-10-24 would fail
 * every run until real time actually reaches it.
 *
 * Validates: Requirements 8.12, 8.13, 8.21, 8.22.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resetDb } from '../setup/db';
import { mockEvent, bodyOf } from './helpers';
import { GET as daysGet } from '../../src/routes/api/days/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';
import { getConfig, SUGGESTED_WINDOW_COVERAGE } from '../../src/lib/server/core/config';
import { buildDayResolver, gaugeWindowFor } from '../../src/lib/server/services/day-aggregation';
import { materializeWallClock } from '../../src/lib/server/domain/logical-day';
import { intersect, total } from '../../src/lib/server/domain/interval';
import type { Interval } from '../../src/lib/contracts/models';
import type { DayResolver } from '../../src/lib/server/domain/logical-day';

const BASE = 'http://localhost';

async function createSession(startedAt: string, endedAt: string) {
	const res = await sessionsPost(
		mockEvent({ method: 'POST', url: `${BASE}/api/sessions`, body: { startedAt, endedAt } })
	);
	if (!res.ok) throw new Error(`createSession failed: ${res.status} ${JSON.stringify(await bodyOf(res))}`);
}

/** Plain calendar-date arithmetic, no timezone — `date` is already a Logical_Day
 * label; this only walks whole UTC calendar days for the range query's `to` bound. */
function nextDate(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	const next = new Date(Date.UTC(y, m - 1, d + 1));
	return next.toISOString().slice(0, 10);
}

function toIntervals(raw: { start: string; end: string }[]): Interval[] {
	return raw.map((iv) => ({ start: new Date(iv.start), end: new Date(iv.end) }));
}

function parseHHMM(value: string): { hour: number; minute: number } {
	const [hour, minute] = value.split(':').map(Number);
	return { hour, minute };
}

/** `[startHHMM, endHHMM)` materialised on `date` in `timezone`, wrapping to the next
 * calendar date when `endHHMM <= startHHMM` — mirrors `gaugeWindowFor`'s own rule
 * (day-aggregation.ts), since `suggestedWindow`'s wire shape is the same kind of
 * recurring wall-clock band `GAUGE_START`/`GAUGE_END` is, just chosen dynamically
 * instead of configured. */
function materializeDailyWindow(
	dayResolver: DayResolver,
	date: string,
	startHHMM: string,
	endHHMM: string,
	timezone: string
): Interval {
	const s = parseHHMM(startHHMM);
	const e = parseHHMM(endHHMM);
	const start = materializeWallClock(date, s.hour, s.minute, timezone);
	const wraps = e.hour * 60 + e.minute <= s.hour * 60 + s.minute;
	const endDate = wraps ? dayResolver.dateOf(dayResolver.bounds(date).end) : date;
	const end = materializeWallClock(endDate, e.hour, e.minute, timezone);
	return { start, end };
}

async function fetchDayWithIntervals(date: string) {
	const res = await daysGet(
		mockEvent({
			url: `${BASE}/api/days?from=${date}T00:00:00Z&to=${nextDate(date)}T00:00:00Z&include=intervals`
		})
	);
	const body = await bodyOf(res);
	const days = body.days as Record<string, unknown>[];
	const day = days.find((d) => d.date === date);
	if (!day) throw new Error(`no day summary for ${date} in range response`);
	return day;
}

describe('Property 19: overtime and in-window time partition the day', () => {
	it('overtimeSeconds + total(intersect(tracked, gaugeWindowOfDay)) === trackedSeconds, on an ordinary day and both DST-boundary Logical_Days', async () => {
		const config = getConfig();
		const dayResolver = buildDayResolver(config);

		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom('2024-07-15', '2024-03-30', '2024-10-26'),
				fc.double({ min: 0, max: 0.7, noNaN: true }),
				fc.double({ min: 0.05, max: 0.25, noNaN: true }),
				async (date, offsetFraction, durationFraction) => {
					await resetDb();

					const bounds = dayResolver.bounds(date);
					const boundsMs = bounds.end.getTime() - bounds.start.getTime();
					// Whole seconds only — trackedSeconds/overtimeSeconds are integer-seconds
					// fields, and total() (domain/interval.ts) returns milliseconds; rounding
					// both sides to whole seconds up front keeps the comparison exact instead
					// of chasing sub-second rounding between the two.
					const offsetSec = Math.floor((offsetFraction * boundsMs) / 1000);
					const maxDurationSec = Math.floor(boundsMs / 1000) - offsetSec - 60; // stay strictly inside the day
					if (maxDurationSec < 60) return; // degenerate sample, skip
					const durationSec = Math.max(60, Math.floor((durationFraction * boundsMs) / 1000));
					const clampedDurationSec = Math.min(durationSec, maxDurationSec);

					const sessionStart = new Date(bounds.start.getTime() + offsetSec * 1000);
					const sessionEnd = new Date(sessionStart.getTime() + clampedDurationSec * 1000);
					await createSession(sessionStart.toISOString(), sessionEnd.toISOString());

					const day = await fetchDayWithIntervals(date);
					const trackedSeconds = day.trackedSeconds as number;
					const overtimeSeconds = day.overtimeSeconds as number;
					const tracked = toIntervals(day.tracked as { start: string; end: string }[]);

					const gaugeWindow = gaugeWindowFor(dayResolver, date, config);
					const insideGaugeSeconds = total(intersect(tracked, [gaugeWindow])) / 1000;

					expect(overtimeSeconds + insideGaugeSeconds).toBe(trackedSeconds);
				}
			),
			{ numRuns: 8 }
		);
	}, 120_000);
});

describe('Property 21: the suggested window brackets the bulk of the work', () => {
	it('when non-null, the suggested window covers at least SUGGESTED_WINDOW_COVERAGE of the range’s Tracked_Time', async () => {
		const config = getConfig();
		const dayResolver = buildDayResolver(config);
		const BASE_DATE = '2026-08-03'; // arbitrary; resetDb() per iteration, no cross-file date concern

		await fc.assert(
			fc.asyncProperty(
				fc.double({ min: 0.2, max: 0.5, noNaN: true }),
				fc.double({ min: 0.05, max: 0.15, noNaN: true }),
				async (offsetFraction, durationFraction) => {
					await resetDb();

					// One session per day, at the same fractional offset each day, so their
					// wall-clock times cluster — the shape most likely to produce a real
					// (non-null) bracketing window rather than one scattered across the clock.
					const dates = [BASE_DATE, nextDate(BASE_DATE), nextDate(nextDate(BASE_DATE))];
					for (const date of dates) {
						const bounds = dayResolver.bounds(date);
						const boundsMs = bounds.end.getTime() - bounds.start.getTime();
						// Round to whole minutes — materializeWallClock/toHHMM below only ever
						// produce minute-aligned instants, so this keeps the intersection exact
						// instead of chasing sub-minute rounding slack against a real algorithm
						// that buckets by whole minute.
						const offsetMinutes = Math.floor((offsetFraction * boundsMs) / 60_000);
						const durationMinutes = Math.max(1, Math.floor((durationFraction * boundsMs) / 60_000));
						const start = new Date(bounds.start.getTime() + offsetMinutes * 60_000);
						const end = new Date(
							Math.min(start.getTime() + durationMinutes * 60_000, bounds.end.getTime() - 60_000)
						);
						await createSession(start.toISOString(), end.toISOString());
					}

					const res = await daysGet(
						mockEvent({
							url: `${BASE}/api/days?from=${BASE_DATE}T00:00:00Z&to=${nextDate(dates[2])}T00:00:00Z&include=intervals`
						})
					);
					const body = await bodyOf(res);
					// `suggestedWindow` is a recurring wall-clock band (`{start: "HH:MM", end:
					// "HH:MM"}`), not a single absolute instant — design.md's Property 21 says
					// so explicitly ("materialised on each day of the range"). It must be
					// re-materialised onto every day in the range, the same way
					// `gaugeWindowFor` materialises `GAUGE_START`/`GAUGE_END`, before it can be
					// intersected against the range's tracked intervals.
					const suggested = body.suggestedWindow as { start: string; end: string } | null;
					const days = body.days as Record<string, unknown>[];
					const allTracked = days.flatMap((d) =>
						toIntervals((d.tracked ?? []) as { start: string; end: string }[])
					);
					const totalTrackedMs = total(allTracked);

					if (suggested === null) return; // Property 21's conditional — no window is a legitimate answer

					const windows = dates.map((date) =>
						materializeDailyWindow(dayResolver, date, suggested.start, suggested.end, config.timezone)
					);
					const insideWindowMs = total(intersect(allTracked, windows));

					expect(insideWindowMs).toBeGreaterThanOrEqual(totalTrackedMs * SUGGESTED_WINDOW_COVERAGE - 1);
				}
			),
			{ numRuns: 8 }
		);
	}, 60_000);
});
