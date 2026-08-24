<script lang="ts">
	/**
	 * Test-only host for `DayGauge` (task 6.6). `@testing-library/svelte`'s `render()`
	 * has no supported way to hand a component a Svelte 5 `Snippet` prop directly — a
	 * snippet must be authored in template syntax. This host forwards every `DayGauge`
	 * prop unchanged and supplies the `center` snippet as a fixed, identifiable stub
	 * (`data-testid="timer-control-stub"`), exactly the mechanism the task brief
	 * suggests for asserting the control's position.
	 */
	import DayGauge from '../../../../src/modules/timer/components/DayGauge.svelte';
	import type { ActivityEntry, Interval, WorkSession } from '../../../../src/lib/contracts/models';

	interface Props {
		sessions: WorkSession[];
		entries: ActivityEntry[];
		uncovered: Interval[];
		window: { start: string; end: string };
		date: string;
		timeZone: string;
		now: Date;
		density?: 'desktop' | 'mobile';
	}

	let {
		sessions,
		entries,
		uncovered,
		window: gaugeWindow,
		date,
		timeZone,
		now,
		density = 'desktop'
	}: Props = $props();
</script>

<DayGauge {sessions} {entries} {uncovered} window={gaugeWindow} {date} {timeZone} {now} {density}>
	{#snippet center()}
		<div data-testid="timer-control-stub">stub</div>
	{/snippet}
</DayGauge>
