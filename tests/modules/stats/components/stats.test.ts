/**
 * Component tests for the five statistics components (task 8.4; Requirements 12.2,
 * 12.4, 12.6, 12.7, 12.8, 12.9, 12.11, 12.12, 12.13, 12.15, 12.17, 12.18, 12.19).
 * `tasks.md` names one file for all five components here, unlike every other
 * component-test task in this spec, which gets its own file per component — followed
 * verbatim rather than defaulting to the usual one-file-per-component split.
 *
 * Three items from tasks.md's bullet list are intentionally NOT asserted here, each
 * noted at its natural place below rather than silently tested against the wrong
 * layer:
 *
 * 1. "Folds an eighth project into Other" is `aggregate.ts`'s `foldProjectTotals` job
 *    (task 8.1), not `ProjectBreakdown`'s — `ProjectBreakdown`'s own header comment
 *    says it "does not re-sort or re-fold" and trusts `projectBreakdown` to already be
 *    sorted and folded. That assertion belongs in `aggregate.test.ts`, which does not
 *    exist yet (8.1 had no dedicated test task in tasks.md). This file only verifies
 *    that `ProjectBreakdown` correctly RENDERS a folded "Other" row it is handed.
 * 2. "The window suggestion appears only when it differs by more than 30 minutes" is
 *    `suggestedWindowIsSignificant` in `aggregate.ts`, combined with UI that does not
 *    exist yet — none of the five components render `suggestedWindow` or any
 *    window-suggestion text at all. Not tested here; there is nothing rendered to
 *    assert against.
 * 3. "`intervalsIncluded: false` renders no strip while leaving every other panel
 *    populated" is a branch owned by the page (`DayRhythm.svelte`'s header comment:
 *    "The page, not the component, owns that branch"). This file verifies the other
 *    four components tolerate summary-only `DaySummary`s (no `covered`/`uncovered`)
 *    without throwing, and deliberately does not render `DayRhythm` in that scenario —
 *    it has no such branch to exercise.
 *
 * Paraglide defaults to `baseLocale` ("en") in jsdom with no cookie/URL locale
 * strategy resolved (see `change-preview.test.ts`'s header comment), so `m.*()` calls
 * render English strings directly with no locale setup step.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ProjectBreakdown from '../../../../src/modules/stats/components/ProjectBreakdown.svelte';
import KpiRow from '../../../../src/modules/stats/components/KpiRow.svelte';
import DayRhythm from '../../../../src/modules/stats/components/DayRhythm.svelte';
import RhythmPanel from '../../../../src/modules/stats/components/RhythmPanel.svelte';
import { positionPercent, widthPercent } from '../../../../src/modules/stats/components/rhythm-geometry';
import type { KpiFigures, ProjectRangeTotal } from '../../../../src/modules/stats/aggregate';
import type { DaySummary } from '../../../../src/lib/contracts/responses';
import { formatDuration } from '../../../../src/lib/viz/format';
import { projectSlotClass } from '../../../../src/lib/viz/palette';
import { getCurrentLocale } from '../../../../src/lib/core/i18n';
import * as m from '../../../../src/lib/paraglide/messages';

/**
 * `RhythmPanel`'s `weekday` variable for `stats_observation_longest` is resolved by
 * its own private (unexported) `weekdayName` helper, keyed off `getCurrentLocale()` —
 * this is an independent local copy of that same table, not an import, since the
 * component's copy is deliberately private. `src/lib/core/i18n/state.svelte.ts` seeds
 * the locale rune to `'cs'` by default (never `initLocale()`-seeded in this test
 * environment, unlike a real page load), so this — not `baseLocale` ("en") — is what
 * actually resolves here; reading `getCurrentLocale()` rather than assuming either
 * value keeps this test correct regardless of which default is in effect.
 */
const WEEKDAY_NAMES: Record<'cs' | 'en', string[]> = {
	cs: ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'],
	en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

function weekdayNameFor(date: string): string {
	const [y, mo, d] = date.split('-').map(Number);
	const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
	const lang = getCurrentLocale().startsWith('cs') ? 'cs' : 'en';
	return WEEKDAY_NAMES[lang][weekday];
}

function fmtDuration(seconds: number): string {
	return formatDuration(seconds, '');
}

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

// --- Fixture builders -----------------------------------------------------------------

function daySummaryFixture(overrides: Partial<DaySummary> = {}): DaySummary {
	return {
		date: '2026-06-15',
		trackedSeconds: 0,
		coveredSeconds: 0,
		uncoveredSeconds: 0,
		paidSeconds: 0,
		unpaidSeconds: 0,
		relaxSeconds: 0,
		sessionCount: 0,
		longestBlockSeconds: 0,
		overtimeSeconds: 0,
		eveningSeconds: 0,
		byProject: [],
		...overrides
	};
}

function projectRangeTotalFixture(overrides: Partial<ProjectRangeTotal> = {}): ProjectRangeTotal {
	return {
		projectId: nextId('project'),
		projectName: 'Client Work',
		colorIndex: 0,
		archived: false,
		coveredSeconds: 0,
		billable: true,
		...overrides
	};
}

/** `ProjectBreakdown`'s prop shape, task 11.1's `{ paid, unpaid }` grouping — a plain
 *  `paid` list wrapped for call sites that only cared about one flat array before. */
function projectBreakdownFixture(
	paid: ProjectRangeTotal[] = [],
	unpaid: ProjectRangeTotal[] = []
): { paid: ProjectRangeTotal[]; unpaid: ProjectRangeTotal[] } {
	return { paid, unpaid };
}

function kpiFixture(overrides: Partial<KpiFigures> = {}): KpiFigures {
	return {
		trackedSeconds: 0,
		coveredSeconds: 0,
		describedSharePercent: 0,
		overtimeSeconds: 0,
		overtimeSharePercent: 0,
		paidSeconds: 0,
		unpaidSeconds: 0,
		relaxSeconds: 0,
		...overrides
	};
}

const noopActivate = () => {};

// ========================================================================================
describe('ProjectBreakdown', () => {
	it('renders rows in the order the (already-sorted) array is given, without re-sorting', () => {
		// `foldProjectTotals` guarantees descending order before this component ever sees
		// the array; this asserts the component preserves that order rather than
		// re-deriving it, per its own header comment ("does not re-sort or re-fold").
		const projects = [
			projectRangeTotalFixture({ projectName: 'Alpha', coveredSeconds: 500 }),
			projectRangeTotalFixture({ projectName: 'Beta', coveredSeconds: 300 }),
			projectRangeTotalFixture({ projectName: 'Gamma', coveredSeconds: 200 })
		];
		const { container } = render(ProjectBreakdown, {
			props: { projectBreakdown: projectBreakdownFixture(projects), uncoveredSeconds: 0, relaxSeconds: 0 }
		});

		const names = [...container.querySelectorAll('.name')].map((el) => el.textContent);
		expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
	});

	it('renders a folded "Other" bucket row (colorIndex/projectId null) under the stats_breakdown_other label', () => {
		// The folding itself is aggregate.ts's job (see file header note 1) — this only
		// checks that ProjectBreakdown renders whatever "Other" row it is handed.
		const other = projectRangeTotalFixture({
			projectId: null,
			projectName: null,
			colorIndex: null,
			coveredSeconds: 120
		});
		const { container } = render(ProjectBreakdown, {
			props: { projectBreakdown: projectBreakdownFixture([other]), uncoveredSeconds: 0, relaxSeconds: 0 }
		});

		expect(screen.getByText(m.stats_breakdown_other())).toBeInTheDocument();
		expect(container.querySelector('.swatch--other')).not.toBeNull();
		expect(container.querySelector('.bar-fill--other')).not.toBeNull();
	});

	it("draws each bar to its share of the range's total, not of the largest project", () => {
		// design.md: "The artboard drew bars relative to the largest project … while
		// printing shares of the total … the share is the number the reader is given."
		// total = 1000; if bars were relative to the largest (500) these would render
		// 100/60/40 instead of the correct 50/30/20.
		const projects = [
			projectRangeTotalFixture({ projectName: 'Alpha', coveredSeconds: 500 }),
			projectRangeTotalFixture({ projectName: 'Beta', coveredSeconds: 300 }),
			projectRangeTotalFixture({ projectName: 'Gamma', coveredSeconds: 200 })
		];
		const { container } = render(ProjectBreakdown, {
			props: { projectBreakdown: projectBreakdownFixture(projects), uncoveredSeconds: 0, relaxSeconds: 0 }
		});

		const bars = [...container.querySelectorAll('.bar-fill')];
		const widths = bars.map((bar) => parseFloat(bar.getAttribute('width') ?? '0'));
		expect(widths).toEqual([50, 30, 20]);

		const shares = [...container.querySelectorAll('.share')].map((el) => el.textContent);
		expect(shares).toEqual(['50%', '30%', '20%']);
	});

	it('shows the empty state instead of an empty chart for a zero range', () => {
		const { container } = render(ProjectBreakdown, {
			props: { projectBreakdown: projectBreakdownFixture(), uncoveredSeconds: 0, relaxSeconds: 0 }
		});

		expect(screen.getByText(m.stats_empty_title())).toBeInTheDocument();
		expect(screen.getByText(m.stats_empty_body())).toBeInTheDocument();
		expect(container.querySelectorAll('.row').length).toBe(0);
	});
});

// ========================================================================================
describe('KpiRow', () => {
	it('shows the overtime duration together with its share of tracked time', () => {
		const kpi: KpiFigures = kpiFixture({
			trackedSeconds: 36_000, // 10h
			coveredSeconds: 25_200, // 7h
			describedSharePercent: 70,
			overtimeSeconds: 10_800, // 3h
			overtimeSharePercent: 30
		});
		render(KpiRow, { props: { kpi } });

		expect(screen.getByText(fmtDuration(kpi.overtimeSeconds))).toBeInTheDocument();
		expect(
			screen.getByText(m.stats_kpi_overtime_share({ percent: Math.round(kpi.overtimeSharePercent) }))
		).toBeInTheDocument();
	});

	it('shows paidSeconds/unpaidSeconds/relaxSeconds as individually visible figures (Requirement 11.1)', () => {
		const kpi: KpiFigures = kpiFixture({
			paidSeconds: 3600,
			unpaidSeconds: 1800,
			relaxSeconds: 900
		});
		render(KpiRow, { props: { kpi } });

		expect(screen.getByText(m.stats_kpi_paid())).toBeInTheDocument();
		expect(screen.getByText(m.stats_kpi_unpaid())).toBeInTheDocument();
		expect(screen.getByText(m.stats_kpi_relax())).toBeInTheDocument();
		expect(screen.getByText(fmtDuration(kpi.paidSeconds))).toBeInTheDocument();
		expect(screen.getByText(fmtDuration(kpi.unpaidSeconds))).toBeInTheDocument();
		expect(screen.getByText(fmtDuration(kpi.relaxSeconds))).toBeInTheDocument();
	});
});

// ========================================================================================
describe('DayRhythm', () => {
	const TZ = 'UTC';

	it('places a 21:00–03:00 overnight session using rhythm-geometry.ts’s own mapping', () => {
		const dayStartHour = 3;
		const date = '2026-06-15';
		const start = new Date('2026-06-15T21:00:00.000Z');
		const end = new Date('2026-06-16T03:00:00.000Z');
		const day = daySummaryFixture({
			date,
			trackedSeconds: 6 * 3600,
			coveredSeconds: 6 * 3600,
			covered: [{ start, end, projectId: 'p1', colorIndex: 1 }],
			uncovered: []
		});

		const { container } = render(DayRhythm, {
			props: { days: [day], dayStartHour, timeZone: TZ, today: '2026-01-01', onDayActivate: noopActivate }
		});

		// Computed from the same function the component itself calls, so the expected
		// value can never drift out of sync with the mapping's own math.
		const expectedX = positionPercent(start, dayStartHour, TZ);
		const expectedWidth = widthPercent(start, end);

		const segment = container.querySelector(
			'.day-rhythm__segment:not(.day-rhythm__segment--uncovered)'
		);
		expect(segment).not.toBeNull();
		expect(parseFloat(segment!.getAttribute('x') ?? '')).toBeCloseTo(expectedX, 6);
		expect(parseFloat(segment!.getAttribute('width') ?? '')).toBeCloseTo(expectedWidth, 6);
	});

	it("marks today's row distinctly from other rows", () => {
		const today = '2026-06-15';
		const days = [
			daySummaryFixture({ date: '2026-06-14', trackedSeconds: 3600 }),
			daySummaryFixture({ date: today, trackedSeconds: 3600 })
		];
		const { container } = render(DayRhythm, {
			props: { days, dayStartHour: 3, timeZone: TZ, today, onDayActivate: noopActivate }
		});

		const rows = container.querySelectorAll('.day-rhythm__row');
		expect(rows.length).toBe(2);

		expect(rows[0].querySelector('.day-rhythm__label--today')).toBeNull();
		expect(rows[0].querySelector('.day-rhythm__today-ring')).toBeNull();

		expect(rows[1].querySelector('.day-rhythm__label--today')).not.toBeNull();
		expect(rows[1].querySelector('.day-rhythm__today-ring')).not.toBeNull();
	});

	it('renders an empty day as an em dash with no segment rects', () => {
		const day = daySummaryFixture({ date: '2026-06-15', trackedSeconds: 0 });
		const { container } = render(DayRhythm, {
			props: { days: [day], dayStartHour: 3, timeZone: TZ, today: '2026-06-16', onDayActivate: noopActivate }
		});

		expect(screen.getByText('—')).toBeInTheDocument();
		expect(container.querySelectorAll('.day-rhythm__segment').length).toBe(0);
	});

	it('takes its axis labels from dayStartHour (4) rather than a hardcoded 3', () => {
		const { container } = render(DayRhythm, {
			props: { days: [], dayStartHour: 4, timeZone: TZ, today: '2026-06-15', onDayActivate: noopActivate }
		});

		const labels = [...container.querySelectorAll('.day-rhythm__axis-label')].map((el) => el.textContent);
		expect(labels).toEqual(['04:00', '10:00', '16:00', '22:00', '04:00']);
	});

	it('renders a covered interval in its project color and an uncovered interval hatched', () => {
		const day = daySummaryFixture({
			date: '2026-06-15',
			trackedSeconds: 7200,
			covered: [
				{
					start: new Date('2026-06-15T10:00:00.000Z'),
					end: new Date('2026-06-15T11:00:00.000Z'),
					projectId: 'p1',
					colorIndex: 3
				}
			],
			uncovered: [
				{ start: new Date('2026-06-15T12:00:00.000Z'), end: new Date('2026-06-15T13:00:00.000Z') }
			]
		});
		const { container } = render(DayRhythm, {
			props: { days: [day], dayStartHour: 3, timeZone: TZ, today: '2026-01-01', onDayActivate: noopActivate }
		});

		const covered = container.querySelector('.day-rhythm__segment:not(.day-rhythm__segment--uncovered)');
		expect(covered).not.toBeNull();
		expect(covered!.classList.contains(projectSlotClass(3))).toBe(true);
		expect(covered!.getAttribute('fill')).toBeNull();

		const uncovered = container.querySelector('.day-rhythm__segment--uncovered');
		expect(uncovered).not.toBeNull();
		expect(uncovered!.getAttribute('fill')).toBe('url(#day-rhythm-hatch)');
	});

	// 003-worklog-time-categories, task 11.5: a leisure interval draws in the
	// Leisure_Palette_Slot, at the position it actually fell (Requirement 11.4).
	it('draws a Leisure_Time interval in the Leisure_Palette_Slot at its own position', () => {
		const dayStartHour = 3;
		const start = new Date('2026-06-15T20:00:00.000Z');
		const end = new Date('2026-06-15T21:00:00.000Z');
		const day = daySummaryFixture({
			date: '2026-06-15',
			trackedSeconds: 0,
			leisure: [{ start, end }]
		});

		const { container } = render(DayRhythm, {
			props: { days: [day], dayStartHour, timeZone: TZ, today: '2026-01-01', onDayActivate: noopActivate }
		});

		const expectedX = positionPercent(start, dayStartHour, TZ);
		const expectedWidth = widthPercent(start, end);

		const segment = container.querySelector('.day-rhythm__segment.pj-relax');
		expect(segment).not.toBeNull();
		expect(parseFloat(segment!.getAttribute('x') ?? '')).toBeCloseTo(expectedX, 6);
		expect(parseFloat(segment!.getAttribute('width') ?? '')).toBeCloseTo(expectedWidth, 6);
	});
});

// ========================================================================================
describe('Activation', () => {
	it('calls onDayActivate with the row’s date when a strip is activated', async () => {
		const onDayActivate = vi.fn();
		const days = [
			daySummaryFixture({ date: '2026-06-14', trackedSeconds: 3600 }),
			daySummaryFixture({ date: '2026-06-15', trackedSeconds: 1800 })
		];
		render(DayRhythm, {
			props: { days, dayStartHour: 3, timeZone: 'UTC', today: '2026-06-16', onDayActivate }
		});

		const buttons = screen.getAllByRole('button');
		expect(buttons.length).toBe(2);
		await fireEvent.click(buttons[1]);

		expect(onDayActivate).toHaveBeenCalledWith('2026-06-15');
	});
});

// ========================================================================================
describe('intervalsIncluded: false (page-level branch)', () => {
	// design.md: "DayRhythm is rendered only when intervalsIncluded is true … the page,
	// not the component, owns that branch." This section therefore renders the other
	// four components against summary-only DaySummarys (no covered/uncovered fields)
	// and confirms they populate normally with no error — and deliberately never
	// renders DayRhythm here, since it has no such branch of its own to test.
	it('KpiRow, ProjectBreakdown and RhythmPanel render normal content from summary-only data without throwing', () => {
		const days = [
			daySummaryFixture({
				date: '2026-06-15',
				trackedSeconds: 3600,
				coveredSeconds: 1800,
				uncoveredSeconds: 1800,
				eveningSeconds: 0
				// no `covered`/`uncovered`/`tracked` — exactly what intervalsIncluded: false omits
			})
		];
		const kpi: KpiFigures = kpiFixture({
			trackedSeconds: 3600,
			coveredSeconds: 1800,
			describedSharePercent: 50
		});
		const projectBreakdown = projectBreakdownFixture([
			projectRangeTotalFixture({ projectName: 'Client Work', coveredSeconds: 1800 })
		]);

		expect(() => render(KpiRow, { props: { kpi } })).not.toThrow();
		expect(() =>
			render(ProjectBreakdown, { props: { projectBreakdown, uncoveredSeconds: 1800, relaxSeconds: 0 } })
		).not.toThrow();
		expect(() => render(RhythmPanel, { props: { days, eveningHour: 21 } })).not.toThrow();

		expect(screen.getAllByText('Client Work').length).toBeGreaterThan(0);
	});
});

// ========================================================================================
describe('RhythmPanel observation sentence', () => {
	it('renders template 1 (stats_observation_nights) when a day has eveningSeconds > 0', () => {
		const days = [
			daySummaryFixture({ date: '2026-06-15', trackedSeconds: 3600, eveningSeconds: 1800 }),
			daySummaryFixture({ date: '2026-06-16', trackedSeconds: 0 })
		];
		render(RhythmPanel, { props: { days, eveningHour: 21 } });

		expect(
			screen.getByText(m.stats_observation_nights({ eveningHour: '21:00', nights: 1, workdays: 1 }))
		).toBeInTheDocument();
	});

	it('renders template 2 (stats_observation_longest) when the longest block is at least 2 hours and no night qualifies', () => {
		// 2026-06-15 is a Monday.
		const days = [
			daySummaryFixture({ date: '2026-06-15', trackedSeconds: 9000, longestBlockSeconds: 9000, eveningSeconds: 0 }),
			daySummaryFixture({ date: '2026-06-16', trackedSeconds: 1800, longestBlockSeconds: 1800, eveningSeconds: 0 })
		];
		render(RhythmPanel, { props: { days, eveningHour: 21 } });

		expect(
			screen.getByText(
				m.stats_observation_longest({ duration: fmtDuration(9000), weekday: weekdayNameFor('2026-06-15') })
			)
		).toBeInTheDocument();
	});

	it('renders template 3 (stats_observation_idle) when a day is idle and neither earlier condition holds', () => {
		const days = [
			daySummaryFixture({ date: '2026-06-15', trackedSeconds: 1800, longestBlockSeconds: 1800, eveningSeconds: 0 }),
			daySummaryFixture({ date: '2026-06-16', trackedSeconds: 0, longestBlockSeconds: 0, eveningSeconds: 0 })
		];
		render(RhythmPanel, { props: { days, eveningHour: 21 } });

		expect(screen.getByText(m.stats_observation_idle({ idleDays: 1 }))).toBeInTheDocument();
	});

	it('omits the observation line entirely when none of the three conditions hold', () => {
		const days = [
			daySummaryFixture({ date: '2026-06-15', trackedSeconds: 1800, longestBlockSeconds: 1800, eveningSeconds: 0 }),
			daySummaryFixture({ date: '2026-06-16', trackedSeconds: 1800, longestBlockSeconds: 1800, eveningSeconds: 0 })
		];
		const { container } = render(RhythmPanel, { props: { days, eveningHour: 21 } });

		expect(container.querySelector('.rhythm-panel__observation')).toBeNull();
	});
});

// ========================================================================================
describe('RhythmPanel evening hour label', () => {
	it('labels the evening figure with the eveningHour prop, not a hardcoded 21:00', () => {
		const days = [daySummaryFixture({ date: '2026-06-15', trackedSeconds: 3600 })];
		const { container } = render(RhythmPanel, { props: { days, eveningHour: 20 } });

		expect(screen.getByText(m.stats_evening({ eveningHour: '20:00' }))).toBeInTheDocument();
		expect(container.textContent).not.toContain('21:00');
	});
});
