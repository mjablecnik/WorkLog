<script lang="ts">
	/**
	 * `Leisure_Block` — 003-worklog-time-categories, task 8.3 (design.md component 8).
	 * Mirrors `SegmentBlock.svelte`'s self-contained pressable-block shape (title,
	 * description, times) but tints with `LEISURE_SLOT_CLASS` instead of a project
	 * colour, and carries no session rail, no Split_Marker notches (a Leisure_Entry's
	 * segments are never clipped to a session, so they are never split the way a
	 * Work_Entry's can be) and no Uncovered_Marker variant.
	 *
	 * Calls the same `onActivityActivate(entry.id)` callback `SegmentBlock` already
	 * exposes on click/Enter/Space, opening the Activity_Dialog with `category`
	 * pre-set to `relax` (`ActivityDialog.svelte` seeds this from `entry.category`).
	 */
	import type { LeisureBlockUnit } from './timeline-geometry';
	import * as m from '$lib/paraglide/messages';
	import { LEISURE_SLOT_CLASS } from '$lib/viz/palette';
	import { formatDuration, formatTimeOfDay } from '$lib/viz/format';
	import { DESCRIPTION_MIN_PX, FILL_THRESHOLD_PX, HEIGHT_STEP_PX, MIN_BLOCK_PX, type Density } from './timeline-geometry';

	interface Props {
		unit: LeisureBlockUnit;
		density: Density;
		timeZone: string;
		locale: string;
		/** Same shared hover/focus id `DayTimeline` fans down to every `SegmentBlock`. */
		hoveredEntryId?: string | null;
		onActivityActivate: (entryId: string) => void;
		onEntryHover?: (entryId: string | null) => void;
	}

	let { unit, density, timeZone, locale, hoveredEntryId = null, onActivityActivate, onEntryHover }: Props =
		$props();

	function fmtTime(t: Date): string {
		return formatTimeOfDay(t, locale, timeZone);
	}
	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, locale);
	}

	const durationSeconds = $derived((unit.interval.end.getTime() - unit.interval.start.getTime()) / 1000);
	const compactRow = $derived(unit.heightPx < DESCRIPTION_MIN_PX);
	const linked = $derived(hoveredEntryId !== null && hoveredEntryId === unit.entry.id);

	function heightClass(): string {
		const stepped = Math.round(unit.heightPx / HEIGHT_STEP_PX) * HEIGHT_STEP_PX;
		const clamped = Math.min(FILL_THRESHOLD_PX, Math.max(MIN_BLOCK_PX.mobile, stepped));
		return `tl-h-${clamped}`;
	}

	function handleEnter(): void {
		onEntryHover?.(unit.entry.id);
	}
	function handleLeave(): void {
		onEntryHover?.(null);
	}
</script>

<button
	type="button"
	class="sb sb--{density} sb--leisure {LEISURE_SLOT_CLASS} {heightClass()}"
	class:sb--floor={compactRow}
	class:sb--linked={linked}
	data-entry-id={unit.entry.id}
	aria-label={m.day_segment_label({
		project: m.category_relax(),
		from: fmtTime(unit.interval.start),
		to: fmtTime(unit.interval.end),
		duration: fmtDuration(durationSeconds),
		part: 'false',
		index: 0,
		count: 0
	})}
	onclick={() => onActivityActivate(unit.entry.id)}
	onmouseenter={handleEnter}
	onmouseleave={handleLeave}
	onfocus={handleEnter}
	onblur={handleLeave}
>
	<span class="sb-name">{m.category_relax()}</span>
	{#if unit.entry.description}
		<span class="sb-desc">{unit.entry.description}</span>
	{/if}
	<span class="sb-meta">
		{fmtTime(unit.interval.start)} – {fmtTime(unit.interval.end)} · {fmtDuration(durationSeconds)}
	</span>
</button>

<style>
	/* Mirrors SegmentBlock.svelte's `.sb`/`.sb--project` treatment exactly, tinted by
	 * the `pj-relax` class (LEISURE_SLOT_CLASS) instead of a project's `pj-<n>`. */
	.sb {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: center;
		width: 100%;
		box-sizing: border-box;
		border: none;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
		transition:
			background-color var(--dur-hover) var(--ease-standard),
			outline-color var(--dur-hover) var(--ease-standard);
	}

	.sb--desktop {
		border-radius: var(--radius-10);
		padding: 9px 13px;
		gap: 2px;
	}
	.sb--mobile {
		border-radius: var(--radius-9);
		padding: 8px 11px;
		gap: 4px;
	}

	.sb--floor {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.sb--leisure {
		background: var(--pj-tint);
		border-left: 3px solid var(--pj);
	}
	.sb--leisure:hover,
	.sb--leisure:focus-visible {
		background: color-mix(in srgb, var(--pj) 24%, transparent);
	}
	:global([data-theme='light']) .sb--leisure:hover,
	:global([data-theme='light']) .sb--leisure:focus-visible {
		background: color-mix(in srgb, var(--pj) 20%, transparent);
	}
	.sb--linked {
		background: color-mix(in srgb, var(--pj) 24%, transparent);
		outline: 1px solid var(--pj);
		outline-offset: -1px;
	}
	:global([data-theme='light']) .sb--linked {
		background: color-mix(in srgb, var(--pj) 20%, transparent);
	}

	.sb-name {
		font-size: 14px;
		font-weight: 500;
		line-height: 1.4;
		color: var(--text);
	}
	.sb--mobile .sb-name {
		font-size: 13px;
	}

	.sb-desc {
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sb-meta {
		font-size: 12px;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}
	.sb--mobile .sb-meta {
		font-size: 11px;
	}
	.sb--floor .sb-meta {
		flex-shrink: 0;
	}
	.sb--floor .sb-name {
		flex: 0 1 auto;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sb--floor:not(:has(.sb-desc)) .sb-name {
		flex: 1 1 auto;
		max-width: none;
	}
	.sb--floor .sb-desc {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0 2px;
	}
</style>
