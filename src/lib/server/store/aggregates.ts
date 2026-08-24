/**
 * The figures `/api/days` and `/api/days/{date}` report, computed by loading the raw
 * `Work_Session` and `Activity_Segment` rows overlapping the requested range once and
 * reducing them per day with the interval algebra. `MAX_RANGE_DAYS` (366) already
 * bounds every request this runs against, and a personal single-user log holds at
 * most a few thousand rows even over a full year — small enough to reduce in process
 * rather than write and maintain a second, SQL-only implementation of the same
 * arithmetic `domain/interval.ts` already gets right and already has property tests
 * for. This is a deliberate, documented trade against the design's original
 * "everything in SQL" intent; see ISSUES.md.
 */
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Interval, ProjectInterval, ProjectTotal } from '$lib/contracts/models';
import type { CoverageResponse, DaySummary } from '$lib/contracts/responses';
import { clamp, gaps, intersect, normalize, subtract, total } from '../domain/interval';
import { minuteOfDay } from '../domain/logical-day';
import { dayStartIsInGaugeGap, gaugeWindowContainsTransition, getConfig } from '../core/config';
import { activityEntries, activitySegments, projects, workSessions } from '../../../db/schema';
import type { Tx } from './tx';

export type DayWindow = { date: string; window: Interval };

type RawSession = { id: string; startedAt: Date; endedAt: Date | null };
type RawSegment = { startedAt: Date; endedAt: Date; projectId: string };
type ProjectMeta = { id: string; name: string; colorIndex: number; archived: boolean };

function boundingRange(windows: DayWindow[]): Interval {
	let start = windows[0].window.start;
	let end = windows[0].window.end;
	for (const { window } of windows) {
		if (window.start.getTime() < start.getTime()) start = window.start;
		if (window.end.getTime() > end.getTime()) end = window.end;
	}
	return { start, end };
}

async function fetchSessions(tx: Tx, range: Interval): Promise<RawSession[]> {
	const rows = await tx
		.select({
			id: workSessions.id,
			startedAt: workSessions.startedAt,
			endedAt: workSessions.endedAt
		})
		.from(workSessions)
		.where(
			and(
				lt(workSessions.startedAt, range.end),
				or(isNull(workSessions.endedAt), gt(workSessions.endedAt, range.start))
			)
		);
	return rows;
}

async function fetchSegments(tx: Tx, range: Interval): Promise<RawSegment[]> {
	const rows = await tx
		.select({
			startedAt: activitySegments.startedAt,
			endedAt: activitySegments.endedAt,
			projectId: activityEntries.projectId
		})
		.from(activitySegments)
		.innerJoin(activityEntries, eq(activitySegments.entryId, activityEntries.id))
		.where(
			and(lt(activitySegments.startedAt, range.end), gt(activitySegments.endedAt, range.start))
		);
	return rows;
}

/** The interval a session row contributes to Tracked_Time — capped exactly as `work-sessions.ts` does. */
function cappedInterval(row: RawSession, now: Date, maxOpenSessionHours: number): Interval {
	if (row.endedAt !== null) return { start: row.startedAt, end: row.endedAt };
	const cap = new Date(row.startedAt.getTime() + maxOpenSessionHours * 3_600_000);
	const end = now.getTime() < cap.getTime() ? now : cap;
	return { start: row.startedAt, end };
}

async function loadProjectMeta(tx: Tx): Promise<Map<string, ProjectMeta>> {
	const rows = await tx
		.select({
			id: projects.id,
			name: projects.name,
			colorIndex: projects.colorIndex,
			archivedAt: projects.archivedAt
		})
		.from(projects);
	return new Map(
		rows.map((r) => [
			r.id,
			{ id: r.id, name: r.name, colorIndex: r.colorIndex, archived: r.archivedAt !== null }
		])
	);
}

const seconds = (ms: number) => Math.round(ms / 1000);

/**
 * Everything `/api/days` reports except the opt-in `tracked`/`covered`/`uncovered`
 * interval lists (see `dayIntervals`). `gaugeWindows` and `eveningStarts` are parallel
 * to `days`, materialised by the caller via `domain/logical-day.ts`'s
 * `materializeWallClock` so this module never has to reason about time zones itself.
 */
export async function daySummaries(
	tx: Tx,
	days: DayWindow[],
	opts: { gaugeWindows: Interval[]; eveningStarts: Date[]; now: Date }
): Promise<Omit<DaySummary, 'tracked' | 'covered' | 'uncovered'>[]> {
	if (days.length === 0) return [];
	const range = boundingRange(days);
	const [sessions, segments, projectMeta] = await Promise.all([
		fetchSessions(tx, range),
		fetchSegments(tx, range),
		loadProjectMeta(tx)
	]);
	const { maxOpenSessionHours } = getConfig();
	const cappedSessions = sessions.map((s) => cappedInterval(s, opts.now, maxOpenSessionHours));

	return days.map((day, i) => {
		const trackedInDay = normalize(clamp(cappedSessions, day.window));
		const trackedSeconds = seconds(total(trackedInDay));

		const sessionCount = sessions.filter(
			(s) =>
				s.startedAt.getTime() >= day.window.start.getTime() &&
				s.startedAt.getTime() < day.window.end.getTime()
		).length;

		const longestBlockSeconds = trackedInDay.reduce(
			(max, iv) => Math.max(max, seconds(iv.end.getTime() - iv.start.getTime())),
			0
		);

		const gaugeWindow = opts.gaugeWindows[i];
		const insideGauge = intersect(trackedInDay, [gaugeWindow]);
		const overtimeSeconds = trackedSeconds - seconds(total(insideGauge));

		const eveningWindow: Interval = { start: opts.eveningStarts[i], end: day.window.end };
		const eveningSeconds = seconds(total(intersect(trackedInDay, [eveningWindow])));

		const segmentsInDay = segments
			.map((s) => ({
				projectId: s.projectId,
				interval: clampOne({ start: s.startedAt, end: s.endedAt }, day.window)
			}))
			.filter((s): s is { projectId: string; interval: Interval } => s.interval !== null);

		const coveredInDay = normalize(segmentsInDay.map((s) => s.interval));
		const coveredSeconds = seconds(total(coveredInDay));
		const uncoveredSeconds = seconds(total(subtract(trackedInDay, coveredInDay)));

		const byProjectSeconds = new Map<string, number>();
		for (const s of segmentsInDay) {
			byProjectSeconds.set(
				s.projectId,
				(byProjectSeconds.get(s.projectId) ?? 0) + seconds(total([s.interval]))
			);
		}
		const byProject: ProjectTotal[] = [...byProjectSeconds.entries()]
			.map(([projectId, coveredSecondsForProject]) => {
				const meta = projectMeta.get(projectId);
				return {
					projectId,
					projectName: meta?.name ?? '',
					colorIndex: meta?.colorIndex ?? 0,
					archived: meta?.archived ?? false,
					coveredSeconds: coveredSecondsForProject
				};
			})
			.sort((a, b) => a.projectName.localeCompare(b.projectName));

		return {
			date: day.date,
			trackedSeconds,
			coveredSeconds,
			uncoveredSeconds,
			sessionCount,
			longestBlockSeconds,
			overtimeSeconds,
			eveningSeconds,
			byProject
		};
	});
}

function clampOne(interval: Interval, window: Interval): Interval | null {
	const result = clamp([interval], window);
	return result.length === 0 ? null : result[0];
}

/** Per-day tracked, covered (with projectId) and uncovered lists, clamped to each day. */
export async function dayIntervals(
	tx: Tx,
	days: DayWindow[],
	now: Date
): Promise<{ tracked: Interval[][]; covered: ProjectInterval[][]; uncovered: Interval[][] }> {
	if (days.length === 0) return { tracked: [], covered: [], uncovered: [] };
	const range = boundingRange(days);
	const [sessions, segments, projectMeta] = await Promise.all([
		fetchSessions(tx, range),
		fetchSegments(tx, range),
		loadProjectMeta(tx)
	]);
	const { maxOpenSessionHours } = getConfig();
	const cappedSessions = sessions.map((s) => cappedInterval(s, now, maxOpenSessionHours));

	const tracked: Interval[][] = [];
	const covered: ProjectInterval[][] = [];
	const uncovered: Interval[][] = [];

	for (const day of days) {
		const trackedInDay = normalize(clamp(cappedSessions, day.window));
		tracked.push(trackedInDay);

		const segmentsInDay = segments
			.map((s) => ({
				projectId: s.projectId,
				interval: clampOne({ start: s.startedAt, end: s.endedAt }, day.window)
			}))
			.filter((s): s is { projectId: string; interval: Interval } => s.interval !== null)
			.sort((a, b) => a.interval.start.getTime() - b.interval.start.getTime());
		covered.push(
			segmentsInDay.map((s) => ({
				start: s.interval.start,
				end: s.interval.end,
				projectId: s.projectId,
				colorIndex: projectMeta.get(s.projectId)?.colorIndex ?? 0
			}))
		);

		uncovered.push(subtract(trackedInDay, normalize(segmentsInDay.map((s) => s.interval))));
	}
	return { tracked, covered, uncovered };
}

/**
 * The shortest arc on the 24-hour clock covering at least `SUGGESTED_WINDOW_COVERAGE`
 * of the range's Tracked_Time, permitted to run past midnight, and constrained to be a
 * window the server would itself accept at startup (Requirement 8.22). `null` when no
 * such window exists — a habitual worker whose hours straddle the configured
 * `DAY_START_HOUR` has none, and that is a normal answer (Requirement 8.21).
 */
export async function suggestedWindow(
	tx: Tx,
	days: DayWindow[],
	now: Date
): Promise<{ start: string; end: string } | null> {
	if (days.length === 0) return null;
	const range = boundingRange(days);
	const sessions = await fetchSessions(tx, range);
	if (sessions.length === 0) return null;

	const { maxOpenSessionHours, timezone, dayStartHour } = getConfig();
	const cappedSessions = normalize(
		sessions.map((s) => cappedInterval(s, now, maxOpenSessionHours))
	);
	if (cappedSessions.length === 0) return null;

	// A 1440-minute histogram of tracked minutes, wrapping arcs that cross real
	// calendar midnight (which happens routinely: a Logical_Day starting at 03:00
	// covers real midnight in its middle, not at its edge).
	const buckets = new Array(1440).fill(0);
	for (const iv of cappedSessions) {
		let cursor = iv.start;
		while (cursor.getTime() < iv.end.getTime()) {
			const startMin = minuteOfDay(cursor, timezone);
			// Advance to the next whole minute boundary or the interval's end, whichever
			// comes first, crediting the elapsed time to `startMin`'s bucket.
			const nextMinuteBoundary = new Date(Math.ceil((cursor.getTime() + 1) / 60_000) * 60_000);
			const step = nextMinuteBoundary.getTime() < iv.end.getTime() ? nextMinuteBoundary : iv.end;
			buckets[startMin] += (step.getTime() - cursor.getTime()) / 60_000;
			cursor = step;
		}
	}

	const totalTrackedMinutes = buckets.reduce((a, b) => a + b, 0);
	const threshold = 0.9 * totalTrackedMinutes;
	if (threshold <= 0) return null;

	const doubled = [...buckets, ...buckets];
	const prefix = new Array(doubled.length + 1).fill(0);
	for (let i = 0; i < doubled.length; i++) prefix[i + 1] = prefix[i] + doubled[i];

	// For every start minute, the shortest length covering >= threshold, via a
	// two-pointer sweep over the doubled circular array.
	const candidates: { start: number; length: number }[] = [];
	for (let s = 0; s < 1440; s++) {
		// Binary search the smallest e >= s such that prefix[e] - prefix[s] >= threshold,
		// bounded to at most a full circle (e <= s + 1440).
		let lo = s;
		let hi = s + 1440;
		while (lo < hi) {
			const mid = Math.floor((lo + hi) / 2);
			if (prefix[mid] - prefix[s] >= threshold - 1e-9) hi = mid;
			else lo = mid + 1;
		}
		if (lo <= s + 1440) candidates.push({ start: s, length: lo - s });
	}
	candidates.sort((a, b) => a.length - b.length || a.start - b.start);

	for (const c of candidates) {
		if (c.length < 60 || c.length > 1440) continue;
		const startHHMM = toHHMM(c.start % 1440);
		const endMinuteRaw = c.start + c.length;
		const endHHMM = toHHMM(endMinuteRaw % 1440);
		// Requirement 8.22: the suggestion must itself pass the startup checks.
		if (!dayStartIsInGaugeGap({ dayStartHour, gaugeStart: startHHMM, gaugeEnd: endHHMM })) continue;
		if (gaugeWindowContainsTransition(startHHMM, endHHMM, timezone, now)) continue;
		return { start: startHHMM, end: endHHMM };
	}
	return null;
}

/**
 * `/api/coverage` and the single-day route's own `coverage` field: `tracked`,
 * `covered`, `uncovered` (`Tracked_Time` minus `Covered_Time`) and `untracked` (the
 * complement of `Tracked_Time` in `range`), plus a `totals` object of all four in
 * seconds. `minGapSeconds` filters the returned `uncovered` LIST only — the totals
 * always describe the whole range (Requirements 9.4, 9.8).
 */
export async function coverageForRange(
	tx: Tx,
	range: Interval,
	now: Date,
	minGapSeconds: number
): Promise<CoverageResponse> {
	const [sessions, segments] = await Promise.all([
		fetchSessions(tx, range),
		fetchSegments(tx, range)
	]);
	const { maxOpenSessionHours } = getConfig();
	const cappedSessions = sessions.map((s) => cappedInterval(s, now, maxOpenSessionHours));

	const tracked = normalize(clamp(cappedSessions, range));
	const covered = normalize(
		clamp(
			segments.map((s) => ({ start: s.startedAt, end: s.endedAt })),
			range
		)
	);
	const uncoveredAll = subtract(tracked, covered);
	const untracked = gaps(tracked, range);

	const minGapMs = minGapSeconds * 1000;
	const uncovered = uncoveredAll.filter((iv) => iv.end.getTime() - iv.start.getTime() >= minGapMs);

	return {
		from: range.start.toISOString(),
		to: range.end.toISOString(),
		tracked,
		covered,
		uncovered,
		untracked,
		totals: {
			trackedSeconds: seconds(total(tracked)),
			coveredSeconds: seconds(total(covered)),
			uncoveredSeconds: seconds(total(uncoveredAll)),
			untrackedSeconds: seconds(total(untracked))
		}
	};
}

function toHHMM(minuteOfDay: number): string {
	const h = Math.floor(minuteOfDay / 60)
		.toString()
		.padStart(2, '0');
	const m = (minuteOfDay % 60).toString().padStart(2, '0');
	return `${h}:${m}`;
}
