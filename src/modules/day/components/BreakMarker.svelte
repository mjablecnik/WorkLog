<script lang="ts">
	/**
	 * Renders one `Untracked_Time` gap between two `Work_Block`s (design.md "Break
	 * Markers"). `role="separator"`, not a button — there is nothing to activate on a
	 * break, per task 3.4: "`BreakMarker` is a `role="separator"` with a label, not a
	 * control".
	 */
	import * as m from '$lib/paraglide/messages';
	import { formatDuration, formatTimeOfDay } from '$lib/viz/format';
	import type { Density, DayLayout } from './timeline-geometry';

	interface Props {
		brk: DayLayout['breaks'][number];
		density: Density;
		timeZone: string;
		locale: string;
	}

	let { brk, density, timeZone, locale }: Props = $props();

	const durationSeconds = $derived((brk.interval.end.getTime() - brk.interval.start.getTime()) / 1000);

	const label = $derived(
		density === 'desktop'
			? m.day_break({
					duration: formatDuration(durationSeconds, locale),
					from: formatTimeOfDay(brk.interval.start, locale, timeZone),
					to: formatTimeOfDay(brk.interval.end, locale, timeZone)
				})
			: m.day_break_short({ duration: formatDuration(durationSeconds, locale) })
	);
</script>

<div class="break-marker break-marker--{density}" class:break-marker--long={brk.long} role="separator" aria-label={label}>
	<span class="break-marker__rule" aria-hidden="true"></span>
	<span class="break-marker__label">{label}</span>
	<span class="break-marker__rule" aria-hidden="true"></span>
</div>

<style>
	.break-marker {
		display: flex;
		align-items: center;
		gap: 10px;
		box-sizing: border-box;
		padding: 11px 0 11px 22px;
	}
	.break-marker--mobile {
		padding-left: 18px;
	}
	.break-marker--long {
		padding-top: 13px;
		padding-bottom: 13px;
	}

	.break-marker__rule {
		flex: 1 1 auto;
		height: 0;
		border-top: 1px dashed var(--hairline);
	}

	.break-marker__label {
		flex-shrink: 0;
		font-size: 11.5px;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}
	.break-marker--mobile .break-marker__label {
		font-size: 10.5px;
	}
	.break-marker--long .break-marker__label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-dim);
	}
	.break-marker--long.break-marker--mobile .break-marker__label {
		font-size: 11px;
	}
</style>
