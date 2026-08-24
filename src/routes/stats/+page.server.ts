/**
 * The statistics range control and its data load (tasks.md 8.1; Requirements 12.1,
 * 12.14, 12.15, 12.16, 12.19, 12.20). Reads the day summaries from the store directly
 * — never through `/api/days`, which exists for scripts and phone shortcuts — per
 * design.md's "Read and Write Paths": a load function calling its own REST route would
 * serialise the same data twice and cost a network hop to the same process.
 *
 * The aggregation itself lives in `$modules/stats/aggregate.ts` as pure functions over
 * `DaySummary[]`; this file only resolves the selected range to a `Logical_Day` window,
 * calls the store, and passes the response through.
 */
import type { PageServerLoad } from './$types';
import type { Interval } from '$lib/contracts/models';
import type { DaysRangeResponse } from '$lib/contracts/responses';
import { getConfig, MAX_INTERVAL_RANGE_DAYS } from '$lib/server/core/config';
import {
	buildDayResolver,
	dayWindowsInRange,
	eveningStartFor,
	gaugeWindowFor
} from '$lib/server/services/day-aggregation';
import { withReadTx } from '$lib/server/store/tx';
import { daySummaries, dayIntervals, suggestedWindow } from '$lib/server/store/aggregates';
import {
	computeKpiFigures,
	computeRhythmFigures,
	computeUncoveredSeconds,
	foldProjectTotals,
	selectObservationTemplate,
	suggestedWindowIsSignificant,
	toStatsRange
} from '$modules/stats/aggregate';

export type StatsRangeKind = 'day' | 'week' | 'month';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateString(date: string): { y: number; m: number; d: number } {
	const match = DATE_RE.exec(date);
	if (match === null) throw new Error(`invalid date: ${JSON.stringify(date)}`);
	return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function formatDateString(y: number, m: number, d: number): string {
	const dt = new Date(Date.UTC(y, m, d));
	const yyyy = dt.getUTCFullYear().toString().padStart(4, '0');
	const mm = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
	const dd = dt.getUTCDate().toString().padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Plain calendar arithmetic on a `YYYY-MM-DD` string — no timezone conversion, because
 * `date` is already a resolved `Logical_Day` value (`event.locals.today.date`), not a
 * raw instant. The day-boundary math itself stays exclusively in spec 001's
 * `domain/logical-day.ts`; this only walks whole calendar days back and forth.
 */
function addCalendarDays(date: string, days: number): string {
	const { y, m, d } = parseDateString(date);
	const shifted = new Date(Date.UTC(y, m, d) + days * 86_400_000);
	return formatDateString(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** The Monday of the calendar week containing `date` (Requirement 12.1: week starts Monday). */
function mondayOfWeek(date: string): string {
	const { y, m, d } = parseDateString(date);
	const weekday = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
	const daysSinceMonday = (weekday + 6) % 7;
	return addCalendarDays(date, -daysSinceMonday);
}

/** The first and last calendar date of the month `date` falls in. */
function monthBounds(date: string): { first: string; last: string } {
	const { y, m } = parseDateString(date);
	const first = formatDateString(y, m, 1);
	const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	const last = formatDateString(y, m, lastDayOfMonth);
	return { first, last };
}

function resolveSelectedRange(param: string | null): StatsRangeKind {
	if (param === 'day' || param === 'month') return param;
	// Requirement 12.1 pins the three ranges but names no default; a week is the
	// middle ground between "today only" and "a whole month at once".
	return 'week';
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const selectedRange = resolveSelectedRange(url.searchParams.get('range'));
	const today = locals.today.date;

	let firstDate: string;
	let lastDate: string;
	if (selectedRange === 'day') {
		firstDate = today;
		lastDate = today;
	} else if (selectedRange === 'week') {
		firstDate = mondayOfWeek(today);
		lastDate = addCalendarDays(firstDate, 6);
	} else {
		const bounds = monthBounds(today);
		firstDate = bounds.first;
		lastDate = bounds.last;
	}

	const config = getConfig();
	const dayResolver = buildDayResolver(config);
	const now = new Date();

	const rangeInterval: Interval = {
		start: dayResolver.bounds(firstDate).start,
		end: dayResolver.bounds(lastDate).end
	};
	const dayWindows = dayWindowsInRange(dayResolver, rangeInterval);

	const gaugeWindows = dayWindows.map((d) => gaugeWindowFor(dayResolver, d.date, config));
	const eveningStarts = dayWindows.map((d) =>
		eveningStartFor(dayResolver, d.date, d.window, config)
	);

	// A one-day range never draws the Day_Rhythm_Strip (Requirement 12.20), so it never
	// asks for intervals; week and month do. The length check mirrors `/api/days`
	// exactly (Requirement 12.16) — never true through this UI's own range choices,
	// since a month is at most 31 days against a 62-day ceiling, but the branch belongs
	// to this load function's contract rather than to an assumption about its caller.
	const wantsIntervals = selectedRange !== 'day' && dayWindows.length <= MAX_INTERVAL_RANGE_DAYS;

	const response = await withReadTx(async (tx) => {
		const summaries = await daySummaries(tx, dayWindows, { gaugeWindows, eveningStarts, now });
		const suggested = await suggestedWindow(tx, dayWindows, now);

		if (!wantsIntervals) {
			const body: DaysRangeResponse = {
				days: summaries,
				suggestedWindow: suggested,
				intervalsIncluded: false
			};
			return body;
		}

		const { tracked, covered, uncovered } = await dayIntervals(tx, dayWindows, now);
		const body: DaysRangeResponse = {
			days: summaries.map((s, i) => ({
				...s,
				tracked: tracked[i],
				covered: covered[i],
				uncovered: uncovered[i]
			})),
			suggestedWindow: suggested,
			intervalsIncluded: true
		};
		return body;
	});

	const range = toStatsRange(response);

	return {
		selectedRange,
		dateRange: { start: firstDate, end: lastDate },
		today,
		range,
		kpi: computeKpiFigures(range.days),
		uncoveredSeconds: computeUncoveredSeconds(range.days),
		projectBreakdown: foldProjectTotals(range.days),
		rhythm: computeRhythmFigures(range.days),
		observation: selectObservationTemplate(range.days, config.eveningHour),
		showSuggestedWindow: suggestedWindowIsSignificant(
			range.suggestedWindow,
			config.gaugeStart,
			config.gaugeEnd
		),
		dayStartHour: config.dayStartHour,
		eveningHour: config.eveningHour,
		timeZone: config.timezone
	};
};
