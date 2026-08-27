<script lang="ts">
	/**
	 * The rhythm panel's plain figures (design.md "Statistics (Stats)": "The rhythm
	 * panel lists days worked, average per working day, longest day, longest unbroken
	 * block, total blocks, and time after the `Evening_Hour`, closing with the
	 * observation line"; Requirements 12.10, 12.11, 12.18; tasks.md 8.3).
	 *
	 * Renders no outer panel chrome and no `stats_panel_label` heading of its own — this
	 * component is the right-hand half of design.md's single "Breakdown and rhythm
	 * panel" `1.4fr 1fr` grid section, and its sibling `ProjectBreakdown` (task 8.2,
	 * already built) establishes the pattern this follows: the panel background,
	 * padding/radius and caption belong to whichever page-assembly task wraps both
	 * halves in the shared grid, not to either half individually — see
	 * `ProjectBreakdown.svelte`'s own header comment and `KpiRow.svelte`'s `.kpi-panel`
	 * for the contrasting case (a component that IS its own self-contained panel). A
	 * `class` prop is accepted for the same reason `ProjectBreakdown`/`KpiRow`/
	 * `CoverageMeter` all accept one.
	 *
	 * Unaffected by `intervalsIncluded` (design.md: "none of their figures needs an
	 * interval") — every figure here reads summary fields only (`aggregate.ts`'s
	 * `computeRhythmFigures`/`selectObservationTemplate`, neither of which touches
	 * `tracked`/`covered`/`uncovered`), so this component renders the same way whether
	 * or not the caller ever asked for per-day intervals.
	 */
	import type { DaySummary } from '$lib/contracts/responses';
	import * as m from '$lib/paraglide/messages';
	import { getCurrentLocale } from '$lib/core/i18n';
	import { formatDuration, weekdayName } from '$lib/viz/format';
	import { computeRhythmFigures, selectObservationTemplate } from '../aggregate';

	interface Props {
		days: DaySummary[];
		/** The `Evening_Hour` from context — named in the label, never assumed to be 21. */
		eveningHour: number;
		class?: string;
	}

	let { days, eveningHour, class: className = '' }: Props = $props();

	const figures = $derived(computeRhythmFigures(days));
	const observation = $derived(selectObservationTemplate(days, eveningHour));

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}

	/** A bare configuration hour as a wall-clock string — "21" → "21:00". */
	function formatHour(hour: number): string {
		return `${String(hour).padStart(2, '0')}:00`;
	}

</script>

<div class="rhythm-panel {className}">
	<dl class="rhythm-panel__rows">
		<div class="rhythm-panel__row">
			<dt>{m.stats_days_worked()}</dt>
			<dd>{figures.daysWorked}</dd>
		</div>
		<div class="rhythm-panel__row">
			<dt>{m.stats_average_day()}</dt>
			<dd>{figures.daysWorked > 0 ? fmtDuration(figures.averageTrackedSecondsPerWorkingDay) : '—'}</dd>
		</div>
		<div class="rhythm-panel__row">
			<dt>{m.stats_longest_day()}</dt>
			<dd>{figures.longestDay ? fmtDuration(figures.longestDay.trackedSeconds) : '—'}</dd>
		</div>
		<div class="rhythm-panel__row">
			<dt>{m.stats_longest_block()}</dt>
			<dd>{figures.longestBlock ? fmtDuration(figures.longestBlock.seconds) : '—'}</dd>
		</div>
		<div class="rhythm-panel__row">
			<dt>{m.stats_total_blocks()}</dt>
			<dd>{figures.sessionCount}</dd>
		</div>
		<div class="rhythm-panel__row">
			<dt>{m.stats_evening({ eveningHour: formatHour(eveningHour) })}</dt>
			<dd>{fmtDuration(figures.eveningSeconds)}</dd>
		</div>
	</dl>

	{#if observation !== null}
		<p class="rhythm-panel__observation">
			{#if observation.template === 1}
				{m.stats_observation_nights({
					eveningHour: formatHour(observation.variables.eveningHour),
					nights: observation.variables.nights,
					workdays: observation.variables.workdays
				})}
			{:else if observation.template === 2}
				{m.stats_observation_longest({
					duration: fmtDuration(observation.variables.durationSeconds),
					weekday: weekdayName(observation.variables.date, getCurrentLocale())
				})}
			{:else}
				{m.stats_observation_idle({ idleDays: observation.variables.idleDays })}
			{/if}
		</p>
	{/if}
</div>

<style>
	.rhythm-panel {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.rhythm-panel__rows {
		display: flex;
		flex-direction: column;
		gap: 13px;
		margin: 0;
	}
	.rhythm-panel__row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin: 0;
	}
	.rhythm-panel__row dt {
		flex-grow: 1;
		font-size: 13.5px;
		color: var(--text-dim);
		font-weight: 400;
	}
	.rhythm-panel__row dd {
		margin: 0;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.rhythm-panel__observation {
		margin: 0;
		padding-top: 14px;
		border-top: 1px solid var(--track);
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--text-faint);
	}
</style>
