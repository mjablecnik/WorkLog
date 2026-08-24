<script lang="ts">
	/**
	 * The statistics route — a thin wrapper mirroring `src/routes/projects/+page.svelte`.
	 * `+page.server.ts`'s `load` already shapes everything `StatsPage.svelte` needs; this
	 * file only flattens `data.range` (`{days, intervalsIncluded, suggestedWindow}`) and
	 * resolves `showSuggestedWindow` into a single `suggestedWindow | null` prop, since
	 * that boolean/value pair is exactly what `StatsPage.svelte`'s own single
	 * `suggestedWindow` prop needs.
	 */
	import type { PageData } from './$types';
	import StatsPage from '$modules/stats/pages/StatsPage.svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
</script>

<StatsPage
	selectedRange={data.selectedRange}
	dateRange={data.dateRange}
	today={data.today}
	days={data.range.days}
	intervalsIncluded={data.range.intervalsIncluded}
	kpi={data.kpi}
	uncoveredSeconds={data.uncoveredSeconds}
	projectBreakdown={data.projectBreakdown}
	dayStartHour={data.dayStartHour}
	eveningHour={data.eveningHour}
	timeZone={data.timeZone}
	maxIntervalRangeDays={data.maxIntervalRangeDays}
	suggestedWindow={data.showSuggestedWindow ? data.range.suggestedWindow : null}
/>
