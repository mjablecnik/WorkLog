/**
 * Pure aggregation over `DaySummary[]` for the statistics page (Requirement 12,
 * tasks.md 8.1). Imports nothing from `$lib/server/**`, so a `.svelte` component may
 * import it directly, in line with design.md's "Read and Write Paths" module-boundary
 * rule — only `src/routes/stats/+page.server.ts` touches the server layer; this module
 * holds logic only.
 *
 * Every figure here is read from a `DaySummary` field by name and folded across the
 * range — never recomputed from `tracked`/`covered`/`uncovered` intervals, which are
 * optional (`intervalsIncluded` may be false) and unnecessary for any of these totals.
 */
import type { DaySummary, DaysRangeResponse } from '$lib/contracts/responses';

/** What the load function hands the page — see design.md's "Statistics" section. */
export type StatsRange = {
	days: DaySummary[];
	/** False when the range exceeded MAX_INTERVAL_RANGE_DAYS and the server dropped the intervals. */
	intervalsIncluded: boolean;
	suggestedWindow: { start: string; end: string } | null;
};

/** `DaysRangeResponse` reshaped into `StatsRange` — the two carry the same three fields. */
export function toStatsRange(response: DaysRangeResponse): StatsRange {
	return {
		days: response.days,
		intervalsIncluded: response.intervalsIncluded,
		suggestedWindow: response.suggestedWindow
	};
}

function sumBy(days: DaySummary[], pick: (day: DaySummary) => number): number {
	return days.reduce((sum, day) => sum + pick(day), 0);
}

/** At most this many projects get their own `ProjectBreakdown` row; the rest fold into "Other". */
const TOP_PROJECT_COUNT = 7;

/**
 * One project's `Covered_Time` summed across the whole range, or the folded "Other"
 * bucket for everything past the top `TOP_PROJECT_COUNT` — `projectId`, `projectName`
 * and `colorIndex` are all `null` there, since "Other" gets no `Palette_Slot` and no
 * name of its own; the rendering component supplies its own translated label rather
 * than this module inventing English text.
 */
export type ProjectRangeTotal = {
	projectId: string | null;
	projectName: string | null;
	colorIndex: number | null;
	archived: boolean;
	coveredSeconds: number;
	/** Addition — the group this row belongs to (003-worklog-time-categories). */
	billable: boolean;
};

/**
 * Folds `byProject[]` across every day into per-project range totals, GROUPED BY
 * `billable` FIRST (003-worklog-time-categories, Requirement 11.2), each group sorted
 * descending by `coveredSeconds` and folded past the top `TOP_PROJECT_COUNT` into its
 * own "Other" row — so a combined row never mixes a paid `Project` with an unpaid one,
 * and no chart ever cycles the eight-slot palette past what it can distinguish
 * (Requirements 12.3, 12.14; tasks.md 8.1).
 *
 * Archived projects that hold time in the range come through unchanged: spec 001's
 * `byProject[]` already carries them (`day-aggregation.ts`'s `loadProjectMeta` loads
 * every project row, active or archived, and only filters on which ids actually have
 * segments in range), so summing it here reconciles with the range total for free.
 */
export function foldProjectTotals(days: DaySummary[]): {
	paid: ProjectRangeTotal[];
	unpaid: ProjectRangeTotal[];
} {
	const totals = new Map<
		string,
		{ projectName: string; colorIndex: number; archived: boolean; coveredSeconds: number; billable: boolean }
	>();
	for (const day of days) {
		for (const project of day.byProject) {
			const existing = totals.get(project.projectId);
			if (existing === undefined) {
				totals.set(project.projectId, {
					projectName: project.projectName,
					colorIndex: project.colorIndex,
					archived: project.archived,
					coveredSeconds: project.coveredSeconds,
					billable: project.billable
				});
			} else {
				existing.coveredSeconds += project.coveredSeconds;
			}
		}
	}

	function foldGroup(billable: boolean): ProjectRangeTotal[] {
		const sorted = [...totals.entries()]
			.filter(([, forProject]) => forProject.billable === billable)
			.map(([projectId, forProject]) => ({ projectId, ...forProject }))
			.sort((a, b) => b.coveredSeconds - a.coveredSeconds);

		const top = sorted.slice(0, TOP_PROJECT_COUNT);
		const rest = sorted.slice(TOP_PROJECT_COUNT);

		const rows: ProjectRangeTotal[] = top.map((project) => ({
			projectId: project.projectId,
			projectName: project.projectName,
			colorIndex: project.colorIndex,
			archived: project.archived,
			coveredSeconds: project.coveredSeconds,
			billable
		}));

		if (rest.length > 0) {
			rows.push({
				projectId: null,
				projectName: null,
				colorIndex: null,
				archived: false,
				coveredSeconds: rest.reduce((sum, project) => sum + project.coveredSeconds, 0),
				billable
			});
		}

		return rows;
	}

	return { paid: foldGroup(true), unpaid: foldGroup(false) };
}

export type KpiFigures = {
	trackedSeconds: number;
	coveredSeconds: number;
	/** `coveredSeconds / trackedSeconds` as a 0-100 percentage; 0 when trackedSeconds is 0. */
	describedSharePercent: number;
	overtimeSeconds: number;
	/** `overtimeSeconds / trackedSeconds` as a 0-100 percentage; 0 when trackedSeconds is 0. */
	overtimeSharePercent: number;
	/** Additions (003-worklog-time-categories, Requirement 11.1). */
	paidSeconds: number;
	unpaidSeconds: number;
	relaxSeconds: number;
};

/**
 * The four `KPI_Row` figures (Requirement 12.2), read from summary fields alone so
 * they render whether or not `intervalsIncluded` is true.
 */
export function computeKpiFigures(days: DaySummary[]): KpiFigures {
	const trackedSeconds = sumBy(days, (d) => d.trackedSeconds);
	const coveredSeconds = sumBy(days, (d) => d.coveredSeconds);
	const overtimeSeconds = sumBy(days, (d) => d.overtimeSeconds);
	return {
		trackedSeconds,
		coveredSeconds,
		describedSharePercent: trackedSeconds > 0 ? (coveredSeconds / trackedSeconds) * 100 : 0,
		overtimeSeconds,
		overtimeSharePercent: trackedSeconds > 0 ? (overtimeSeconds / trackedSeconds) * 100 : 0,
		paidSeconds: sumBy(days, (d) => d.paidSeconds),
		unpaidSeconds: sumBy(days, (d) => d.unpaidSeconds),
		relaxSeconds: sumBy(days, (d) => d.relaxSeconds)
	};
}

/** The range's total `Uncovered_Time` — shown below a divider, never as a breakdown bar (Requirement 12.5). */
export function computeUncoveredSeconds(days: DaySummary[]): number {
	return sumBy(days, (d) => d.uncoveredSeconds);
}

export type RhythmFigures = {
	/** Count of days with `trackedSeconds > 0`. */
	daysWorked: number;
	/** `trackedSeconds` summed over working days only, divided by `daysWorked`; 0 when there are none. */
	averageTrackedSecondsPerWorkingDay: number;
	/** The day with the greatest `trackedSeconds`; `null` when every day in the range is empty. */
	longestDay: { date: string; trackedSeconds: number } | null;
	/** The day with the greatest `longestBlockSeconds`; `null` when every day in the range is empty. */
	longestBlock: { date: string; seconds: number } | null;
	sessionCount: number;
	eveningSeconds: number;
};

/**
 * The `RhythmPanel` figures (Requirements 12.10, 12.11): days worked, average
 * `Tracked_Time` per working day, the single longest day, the longest uninterrupted
 * block and which day it fell on, total `Work_Block` (session) count and time after
 * the `Evening_Hour` — all summary-fields only, so no interval data is required.
 */
export function computeRhythmFigures(days: DaySummary[]): RhythmFigures {
	const workingDays = days.filter((d) => d.trackedSeconds > 0);
	const daysWorked = workingDays.length;
	const averageTrackedSecondsPerWorkingDay =
		daysWorked > 0 ? sumBy(workingDays, (d) => d.trackedSeconds) / daysWorked : 0;

	const longestDay = days.reduce<{ date: string; trackedSeconds: number } | null>((best, day) => {
		if (day.trackedSeconds <= 0) return best;
		if (best === null || day.trackedSeconds > best.trackedSeconds) {
			return { date: day.date, trackedSeconds: day.trackedSeconds };
		}
		return best;
	}, null);

	const longestBlock = days.reduce<{ date: string; seconds: number } | null>((best, day) => {
		if (day.longestBlockSeconds <= 0) return best;
		if (best === null || day.longestBlockSeconds > best.seconds) {
			return { date: day.date, seconds: day.longestBlockSeconds };
		}
		return best;
	}, null);

	return {
		daysWorked,
		averageTrackedSecondsPerWorkingDay,
		longestDay,
		longestBlock,
		sessionCount: sumBy(days, (d) => d.sessionCount),
		eveningSeconds: sumBy(days, (d) => d.eveningSeconds)
	};
}

/** The single template `RhythmPanel`'s observation line resolves to — never rendered text, only data. */
export type ObservationTemplate =
	| { template: 1; variables: { eveningHour: number; nights: number; workdays: number } }
	| { template: 2; variables: { durationSeconds: number; date: string } }
	| { template: 3; variables: { idleDays: number } };

const LONGEST_BLOCK_TEMPLATE_THRESHOLD_SECONDS = 2 * 3600;

/**
 * The first of the three fixed observation templates (design.md, "Close it with
 * exactly one observation line") whose condition holds, in priority order, or `null`
 * when none does (Requirement 12.18). Returns structured data only — no message text
 * and no `$lib/paraglide` import; `RhythmPanel.svelte` (a later task) renders the
 * actual `m.stats_observation_*(...)` call from the template id and variables here.
 *
 * Each variable is exactly the field tasks.md 8.3 names: `nights` = days with
 * `eveningSeconds > 0`, `workdays` = days with `trackedSeconds > 0`, `longest`/`date`
 * = the day with `max(longestBlockSeconds)`, `idleDays` = days with
 * `trackedSeconds === 0`. `eveningHour` comes from server context, not the payload —
 * the caller supplies it.
 */
export function selectObservationTemplate(
	days: DaySummary[],
	eveningHour: number
): ObservationTemplate | null {
	const nights = days.filter((d) => d.eveningSeconds > 0).length;
	if (nights >= 1) {
		const workdays = days.filter((d) => d.trackedSeconds > 0).length;
		return { template: 1, variables: { eveningHour, nights, workdays } };
	}

	const longest = days.reduce<{ date: string; seconds: number } | null>((best, day) => {
		if (best === null || day.longestBlockSeconds > best.seconds) {
			return { date: day.date, seconds: day.longestBlockSeconds };
		}
		return best;
	}, null);
	if (longest !== null && longest.seconds >= LONGEST_BLOCK_TEMPLATE_THRESHOLD_SECONDS) {
		return { template: 2, variables: { durationSeconds: longest.seconds, date: longest.date } };
	}

	const idleDays = days.filter((d) => d.trackedSeconds === 0).length;
	if (idleDays >= 1) {
		return { template: 3, variables: { idleDays } };
	}

	return null;
}

function toMinutesOfDay(hhmm: string): number {
	const [hour, minute] = hhmm.split(':').map(Number);
	return hour * 60 + minute;
}

/** Shortest distance between two clock times on the 24-hour circle, in minutes. */
function circularMinuteDistance(a: number, b: number): number {
	const raw = Math.abs(a - b) % 1440;
	return Math.min(raw, 1440 - raw);
}

const SUGGESTED_WINDOW_THRESHOLD_MINUTES = 30;

/**
 * True when `suggestedWindow` differs from the configured `Gauge_Window` by more than
 * 30 minutes at either end (Requirement 12.15) — the interface offers the suggestion
 * only then, since a closer match tells the user nothing they have not already
 * configured. Distances wrap at midnight, so a window ending at 23:50 is 10 minutes
 * from one ending at 00:00, not 1430.
 */
export function suggestedWindowIsSignificant(
	suggestedWindow: { start: string; end: string } | null,
	gaugeStart: string,
	gaugeEnd: string
): boolean {
	if (suggestedWindow === null) return false;
	const startDiff = circularMinuteDistance(
		toMinutesOfDay(suggestedWindow.start),
		toMinutesOfDay(gaugeStart)
	);
	const endDiff = circularMinuteDistance(
		toMinutesOfDay(suggestedWindow.end),
		toMinutesOfDay(gaugeEnd)
	);
	return (
		startDiff > SUGGESTED_WINDOW_THRESHOLD_MINUTES || endDiff > SUGGESTED_WINDOW_THRESHOLD_MINUTES
	);
}
