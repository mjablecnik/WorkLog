<script lang="ts">
	/**
	 * The statistics page's assembly — design.md's "Statistics (`Stats`)" section
	 * (search that exact heading) and its "Statistics and Projects, Mobile" section for
	 * the responsive rules neither page has an artboard for. No task in `tasks.md`
	 * named this file explicitly (8.1-8.4 build the load function and the five
	 * components individually); found missing — the route 500ed on every request,
	 * `src/routes/stats/` held only `+page.server.ts` — while writing task 11's E2E
	 * suite, and built here to close that gap, following `ProjectsPage.svelte`'s own
	 * precedent (a `src/modules/<domain>/pages/<Name>Page.svelte` a thin `+page.svelte`
	 * delegates to, per the Project Structure listing) rather than inlining everything into
	 * `+page.svelte` directly.
	 *
	 * Structural props only, never `PageData` from `./$types` — modules never import
	 * from `src/routes/` (design.md's module boundary); `src/routes/stats/+page.svelte`
	 * passes `data` straight through, its shape structurally identical to what
	 * `+page.server.ts`'s `load` returns.
	 *
	 * LAYOUT (design.md, verbatim order): heading row (title, range segmented control,
	 * resolved range label) — then `gap: 22`: `KpiRow`, `DayRhythm` (skipped for a
	 * one-day range, or replaced by `stats_rhythm_unavailable` prose on the
	 * `intervalsIncluded: false` branch no day/week/month range through this UI can
	 * actually reach), then a `grid-template-columns: 1.4fr 1fr` row of
	 * `ProjectBreakdown` beside `RhythmPanel` (both dropped to a single
	 * `ProjectBreakdown` column for a one-day range — "the layout collapses to a single
	 * column: the KPI_Row, then the project breakdown").
	 *
	 * EMPTY STATE: owned entirely by `ProjectBreakdown` itself (its own `isEmpty` check,
	 * Requirement 12.12) — this page renders `KpiRow`/`DayRhythm`/`RhythmPanel`
	 * unconditionally alongside it rather than replacing the whole page, since an empty
	 * range still has real (zero) KPI figures to show.
	 *
	 * RANGE SWITCH: three plain links to `?range=day|week|month` — SvelteKit navigates
	 * these client-side by default (same origin, no `data-sveltekit-reload`), re-running
	 * `load` without a full page reload. `$app/state`'s `navigating` (true exactly while
	 * that in-flight navigation targets this same route) drives the one skeleton state
	 * design.md's "Skeletons have exactly three callers" names the range switch as.
	 *
	 * PROJECT LEGEND (known, deliberate gap): design.md's `Day_Rhythm_Strip` prose asks
	 * for "the project legend at the right" beside its heading; `DayRhythm.svelte`'s own
	 * doc comment already flags that it does not render one and defers the decision to
	 * "whichever task assembles the full Stats page around this component" — this task.
	 * Left unbuilt here too: every other module's component reuse in this codebase stays
	 * within its own domain (`$modules/day/**` never imports `$modules/timer/**` and vice
	 * versa), and reusing `$modules/timer/components/ProjectLegend.svelte` here would be
	 * the first cross-domain component import in the project — a bigger precedent than
	 * this task's own scope (closing two live 500s) should decide unilaterally. Every
	 * figure `DayRhythm` draws is already present as text elsewhere on this same page
	 * (`ProjectBreakdown`'s own name/swatch rows), so no information is colour-only.
	 * Logged in `.agents/ISSUES.md` rather than built silently or skipped silently.
	 */
	import { navigating } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { DaySummary } from '$lib/contracts/responses';
	import * as m from '$lib/paraglide/messages';
	import { getCurrentLocale } from '$lib/core/i18n';
	import { formatDayLabel } from '$lib/viz/format';
	import LoadingSkeleton from '$lib/ui/overlays/LoadingSkeleton.svelte';
	import KpiRow from '$modules/stats/components/KpiRow.svelte';
	import ProjectBreakdown from '$modules/stats/components/ProjectBreakdown.svelte';
	import DayRhythm from '$modules/stats/components/DayRhythm.svelte';
	import RhythmPanel from '$modules/stats/components/RhythmPanel.svelte';
	import type { KpiFigures, ProjectRangeTotal } from '$modules/stats/aggregate';

	/** Mirrors `src/routes/stats/+page.server.ts`'s own `StatsRangeKind` — not imported
	 * from there, since modules never import from `src/routes/` (design.md's module
	 * boundary: a route may import a module, never the reverse). Kept in sync by hand;
	 * a divergence would surface immediately as a type error at this file's own `Props`
	 * (`selectedRange`), since `+page.svelte` passes `data.selectedRange` straight
	 * through without a cast. */
	type StatsRangeKind = 'day' | 'week' | 'month';

	interface Props {
		selectedRange: StatsRangeKind;
		dateRange: { start: string; end: string };
		today: string;
		days: DaySummary[];
		intervalsIncluded: boolean;
		kpi: KpiFigures;
		uncoveredSeconds: number;
		/** Grouped by billable FIRST (003-worklog-time-categories, Requirement 11.2) —
		 *  a combined row never mixes a paid Project with an unpaid one. */
		projectBreakdown: { paid: ProjectRangeTotal[]; unpaid: ProjectRangeTotal[] };
		dayStartHour: number;
		eveningHour: number;
		timeZone: string;
		maxIntervalRangeDays: number;
		/** Null when no window satisfies both tests, or when it does not differ from the
		 * configured `Gauge_Window` by more than 30 minutes at either end — the caller
		 * (`+page.svelte`) resolves `showSuggestedWindow` server-side via
		 * `suggestedWindowIsSignificant` and passes `null` here in either case, so this
		 * component only ever has to ask "is this non-null", never re-derive the
		 * significance test itself. */
		suggestedWindow: { start: string; end: string } | null;
	}

	let {
		selectedRange,
		dateRange,
		today,
		days,
		intervalsIncluded,
		kpi,
		uncoveredSeconds,
		projectBreakdown,
		dayStartHour,
		eveningHour,
		timeZone,
		maxIntervalRangeDays,
		suggestedWindow
	}: Props = $props();

	const locale = $derived(getCurrentLocale());

	// Requirement 12.20: a one-day range drops both rhythm panels — one row on a shared
	// axis says nothing the day page does not say better, and every rhythm figure
	// compares days that are not there.
	const showRhythm = $derived(selectedRange !== 'day');

	const resolvedRangeLabel = $derived(
		dateRange.start === dateRange.end
			? formatDayLabel(dateRange.start, locale, today, 'long')
			: `${formatDayLabel(dateRange.start, locale, today, 'long')} – ${formatDayLabel(dateRange.end, locale, today, 'long')}`
	);

	const RANGE_OPTIONS: { value: StatsRangeKind; label: () => string }[] = [
		{ value: 'day', label: m.stats_range_day },
		{ value: 'week', label: m.stats_range_week },
		{ value: 'month', label: m.stats_range_month }
	];

	function handleRangeClick(event: MouseEvent, range: StatsRangeKind): void {
		event.preventDefault();
		void goto(resolve(`/stats?range=${range}`), { keepFocus: true });
	}

	/** True exactly while an in-flight navigation is heading to this same route with a
	 * different `range` — the one moment `navigating` (`$app/state`) should be read as
	 * "this page's own data is stale," rather than any unrelated navigation elsewhere. */
	const switchingRange = $derived(
		navigating.to !== null && navigating.to.url.pathname === '/stats'
	);

	function handleDayActivate(date: string): void {
		void goto(resolve(`/day/${date}`));
	}
</script>

<svelte:head>
	<title>{m.stats_title()}</title>
</svelte:head>

<div class="stats-page">
	<div class="stats-page__inner">
		<div class="stats-page__header">
			<h1 class="stats-page__title">{m.stats_title()}</h1>

			<div class="stats-page__range" role="radiogroup" aria-label={m.stats_title()}>
				{#each RANGE_OPTIONS as opt (opt.value)}
					{@const active = opt.value === selectedRange}
					<a
						href={resolve(`/stats?range=${opt.value}`)}
						role="radio"
						aria-checked={active}
						class="stats-page__range-item"
						class:stats-page__range-item--active={active}
						onclick={(event) => handleRangeClick(event, opt.value)}
					>
						{opt.label()}
					</a>
				{/each}
			</div>

			<span class="stats-page__meta">{resolvedRangeLabel}</span>
		</div>

		{#if switchingRange}
			<div class="stats-page__skeleton" aria-hidden="true">
				<LoadingSkeleton radius={14} class="stats-page__skeleton-kpi" />
				<LoadingSkeleton radius={14} class="stats-page__skeleton-block" />
			</div>
		{:else}
			<KpiRow {kpi} />

			{#if showRhythm}
				{#if intervalsIncluded}
					<DayRhythm {days} {dayStartHour} {timeZone} {today} onDayActivate={handleDayActivate} />
				{:else}
					<div class="stats-page__panel">
						<p class="stats-page__rhythm-unavailable">
							{m.stats_rhythm_unavailable({ days: maxIntervalRangeDays })}
						</p>
					</div>
				{/if}
			{/if}

			<div class="stats-page__breakdown-row" class:stats-page__breakdown-row--solo={!showRhythm}>
				<div class="stats-page__panel">
					<p class="lbl stats-page__panel-label">{m.stats_breakdown_label()}</p>
					<ProjectBreakdown {projectBreakdown} {uncoveredSeconds} relaxSeconds={kpi.relaxSeconds} />
				</div>

				{#if showRhythm}
					<div class="stats-page__panel">
						<p class="lbl stats-page__panel-label">{m.stats_panel_label()}</p>
						<RhythmPanel {days} {eveningHour} />
					</div>
				{/if}
			</div>

			{#if suggestedWindow !== null}
				<p class="stats-page__window-suggestion">
					{m.stats_window_suggestion({ start: suggestedWindow.start, end: suggestedWindow.end })}
				</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.stats-page {
		display: flex;
		justify-content: center;
		padding: 24px 48px;
	}

	.stats-page__inner {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 940px;
		gap: 22px;
	}

	.stats-page__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
	}

	.stats-page__title {
		margin: 0;
		font-size: 20px;
		font-weight: 500;
		color: var(--text);
	}

	.stats-page__range {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius-12);
		background: rgb(from var(--text) r g b / 0.04);
	}

	.stats-page__range-item {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 30px;
		padding: 0 14px;
		border-radius: var(--radius-9);
		font-size: 13px;
		font-weight: 500;
		color: var(--text-dim);
		text-decoration: none;
		cursor: pointer;
	}

	.stats-page__range-item--active {
		background: var(--segment-active);
		color: var(--accent-on-tint);
	}

	.stats-page__range-item:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	.stats-page__meta {
		font-size: 13px;
		color: var(--text-faint);
	}

	/* design.md: "as the two values to put in the server's .env and restart with,
	 * never as a control the interface can apply, because the window has no write
	 * endpoint." Plain advisory text, no button. */
	.stats-page__window-suggestion {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-faint);
	}

	.stats-page__panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px 22px;
		background: var(--panel);
		border-radius: var(--radius-14);
	}

	.stats-page__panel-label {
		margin: 0;
	}

	.stats-page__rhythm-unavailable {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-dim);
	}

	.stats-page__breakdown-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px;
	}

	.stats-page__skeleton {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.stats-page__skeleton :global(.stats-page__skeleton-kpi) {
		display: block;
		height: 96px;
	}

	.stats-page__skeleton :global(.stats-page__skeleton-block) {
		display: block;
		height: 240px;
	}

	@media (min-width: 768px) {
		.stats-page__breakdown-row:not(.stats-page__breakdown-row--solo) {
			grid-template-columns: 1.4fr 1fr;
			gap: 18px;
		}
	}
</style>
