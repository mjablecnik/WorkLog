<script module lang="ts">
	import type { Interval } from '$lib/contracts/models';
	import type { LaidOutSegment } from './timeline-geometry';

	/**
	 * `LaidOutSegment.interval` now carries the unit's own clipped start/end directly
	 * (for a real segment or an Uncovered_Time stretch alike) — `timeline-geometry.ts`
	 * was extended to expose it after this component was first built, closing the gap
	 * an earlier implementation pass had flagged (the caller no longer has to re-pair a
	 * rendered uncovered stretch back to the original `uncovered: Interval[]` array by
	 * chronological position). `RenderableSegment` is kept as a type alias, not removed,
	 * so this component's own prop name stays stable for its callers.
	 */
	export type RenderableSegment = LaidOutSegment;
</script>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { projectSlotClass } from '$lib/viz/palette';
	import { formatDuration, formatTimeOfDay } from '$lib/viz/format';
	import {
		DESCRIPTION_MIN_PX,
		FILL_THRESHOLD_PX,
		HEIGHT_STEP_PX,
		MIN_BLOCK_PX,
		type Density
	} from './timeline-geometry';

	interface Props {
		segment: RenderableSegment;
		density: Density;
		timeZone: string;
		locale: string;
		/**
		 * The entry id the parent currently considers "hovered" — owned by `DayTimeline`
		 * (task 3.5), not by this component. When it equals this segment's own
		 * `entry.id` (whether because *this* block is the one under the pointer, or a
		 * sibling part elsewhere in the DOM is), the linked Split_Marker treatment
		 * applies. This component never sets its own hover state into anything global;
		 * it only reports it upward through `onEntryHover`.
		 */
		hoveredEntryId?: string | null;
		onActivityActivate: (entryId: string) => void;
		onUncoveredActivate: (range: Interval) => void;
		/**
		 * Fired on `mouseenter`/`focus` with this segment's `entry.id` (or `null`, absent
		 * an entry) and on `mouseleave`/`blur` with `null`. The parent is expected to
		 * track "the currently hovered/focused entry id" in one place and feed it back
		 * down as `hoveredEntryId` to every `SegmentBlock` sharing that entry, including
		 * this one — that round trip is what lets a hover on one part of a split entry
		 * light up a sibling part sitting in a different `WorkBlock` across a break, which
		 * a pure-CSS sibling selector cannot reach.
		 */
		onEntryHover?: (entryId: string | null) => void;
	}

	let { segment, density, timeZone, locale, hoveredEntryId = null, onActivityActivate, onUncoveredActivate, onEntryHover }: Props =
		$props();

	function fmtTime(t: Date): string {
		return formatTimeOfDay(t, locale, timeZone);
	}
	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, locale);
	}

	const durationSeconds = $derived((segment.interval.end.getTime() - segment.interval.start.getTime()) / 1000);
	const floorPx = $derived(MIN_BLOCK_PX[density]);
	const atFloor = $derived(segment.heightPx <= floorPx);
	const isSplit = $derived(segment.partIndex !== null && segment.partCount !== null);
	const isFirstPart = $derived(segment.partIndex === 1);
	const isLastPart = $derived(segment.partIndex !== null && segment.partCount !== null && segment.partIndex === segment.partCount);
	const isUncoveredTall = $derived(density === 'desktop' ? segment.heightPx >= DESCRIPTION_MIN_PX : segment.heightPx >= 44);
	const linked = $derived(hoveredEntryId !== null && segment.entry !== null && hoveredEntryId === segment.entry.id);

	/** `tl-h-<n>` (quantised to the 2 px ladder) or `tl-h-fill` for the one tallest
	 * segment per block column — `layOutDay` already quantises `heightPx`, this only
	 * clamps defensively and picks the matching precompiled class name. */
	function heightClass(): string {
		if (segment.fillsColumn) return 'tl-h-fill';
		const stepped = Math.round(segment.heightPx / HEIGHT_STEP_PX) * HEIGHT_STEP_PX;
		const clamped = Math.min(FILL_THRESHOLD_PX, Math.max(MIN_BLOCK_PX.mobile, stepped));
		return `tl-h-${clamped}`;
	}

	function handleEnter(): void {
		onEntryHover?.(segment.entry?.id ?? null);
	}
	function handleLeave(): void {
		onEntryHover?.(null);
	}
</script>

{#if segment.segment !== null && segment.entry !== null}
	{@const entry = segment.entry}
	<button
		type="button"
		class="sb sb--{density} sb--project {projectSlotClass(entry.colorIndex)} {heightClass()}"
		class:sb--floor={atFloor}
		class:sb--linked={linked}
		data-entry-id={entry.id}
		aria-label={m.day_segment_label({
			project: entry.projectName,
			from: fmtTime(segment.interval.start),
			to: fmtTime(segment.interval.end),
			duration: fmtDuration(durationSeconds),
			part: isSplit ? 'true' : 'false',
			index: segment.partIndex ?? 0,
			count: segment.partCount ?? 0
		})}
		onclick={() => onActivityActivate(entry.id)}
		onmouseenter={handleEnter}
		onmouseleave={handleLeave}
		onfocus={handleEnter}
		onblur={handleLeave}
	>
		{#if isSplit && !isFirstPart}
			<span class="sb-notch sb-notch--top" aria-hidden="true"></span>
		{/if}
		<span class="sb-name">{entry.projectName}</span>
		{#if segment.showsDescription && !atFloor && entry.description}
			<span class="sb-desc">{entry.description}</span>
		{/if}
		<span class="sb-meta">
			{fmtTime(segment.interval.start)} – {fmtTime(segment.interval.end)} · {fmtDuration(durationSeconds)}
			{#if isSplit}
				· {atFloor
					? m.day_segment_part_short({ index: segment.partIndex ?? 0, count: segment.partCount ?? 0 })
					: m.day_segment_part({ index: segment.partIndex ?? 0, count: segment.partCount ?? 0 })}
			{/if}
		</span>
		{#if isSplit && !isLastPart}
			<span class="sb-notch sb-notch--bottom" aria-hidden="true"></span>
		{/if}
	</button>
{:else}
	<button
		type="button"
		class="sb sb--{density} sb--uncovered {heightClass()}"
		class:sb--floor={atFloor}
		aria-label={m.aria_uncovered_block({
			from: fmtTime(segment.interval.start),
			to: fmtTime(segment.interval.end),
			duration: fmtDuration(durationSeconds)
		})}
		onclick={() => onUncoveredActivate(segment.interval)}
	>
		{#if density === 'desktop'}
			{#if isUncoveredTall}
				<span class="sb-unc-title">{m.day_uncovered_title()}</span>
				<span class="sb-unc-hint"
					>{m.day_uncovered_hint({
						from: fmtTime(segment.interval.start),
						to: fmtTime(segment.interval.end),
						duration: fmtDuration(durationSeconds)
					})}</span
				>
			{:else}
				<span class="sb-unc-row">
					<span class="sb-unc-title">{m.day_uncovered_title()}</span>
					<span class="sb-unc-dot" aria-hidden="true">·</span>
					<span class="sb-unc-times">{fmtTime(segment.interval.start)} – {fmtTime(segment.interval.end)}</span>
					<span class="sb-unc-spacer" aria-hidden="true"></span>
					<span class="sb-unc-action">{m.day_uncovered_action()}</span>
				</span>
			{/if}
		{:else if isUncoveredTall}
			<span class="sb-unc-row sb-unc-row--mobile">
				<span class="sb-unc-stack">
					<span class="sb-unc-title sb-unc-title--mobile">{m.day_uncovered_title()}</span>
					<span class="sb-unc-times sb-unc-times--mobile"
						>{fmtTime(segment.interval.start)} – {fmtTime(segment.interval.end)}</span
					>
				</span>
				<span class="sb-unc-pill">{m.day_uncovered_action()}</span>
			</span>
		{:else}
			<span class="sb-unc-row">
				<span class="sb-unc-title-short">{m.day_uncovered_title_short()}</span>
				<span class="sb-unc-dot" aria-hidden="true">·</span>
				<span class="sb-unc-times sb-unc-times--mobile"
					>{fmtTime(segment.interval.start)} – {fmtTime(segment.interval.end)}</span
				>
			</span>
		{/if}
	</button>
{/if}

<style>
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
		--focus-gap: var(--pj-tint, var(--bg));
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

	.sb--project {
		background: var(--pj-tint);
		border-left: 3px solid var(--pj);
	}
	.sb--project:hover,
	.sb--project:focus-visible {
		background: color-mix(in srgb, var(--pj) 24%, transparent);
	}
	:global([data-theme='light']) .sb--project:hover,
	:global([data-theme='light']) .sb--project:focus-visible {
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
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Split_Marker continuation notch — a 7 px --pj triangle centred on the edge
	   facing the break: bottom for every part but the last, top for every part but
	   the first. Positioned outside the block's own box so it is never clipped. */
	.sb-notch {
		position: absolute;
		left: 50%;
		width: 0;
		height: 0;
		transform: translateX(-50%);
		pointer-events: none;
	}
	.sb-notch--bottom {
		bottom: -6px;
		border-left: 3.5px solid transparent;
		border-right: 3.5px solid transparent;
		border-top: 7px solid var(--pj);
	}
	.sb-notch--top {
		top: -6px;
		border-left: 3.5px solid transparent;
		border-right: 3.5px solid transparent;
		border-bottom: 7px solid var(--pj);
	}

	/* Uncovered_Marker — one treatment, four variants (design.md "Uncovered_Marker"). */
	.sb--uncovered {
		background: color-mix(in srgb, var(--accent) 6%, transparent);
		border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
	}
	:global([data-theme='light']) .sb--uncovered {
		border-color: color-mix(in srgb, var(--accent) 52%, transparent);
	}

	.sb-unc-title {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.4;
		/* --accent-on-tint, not --accent: confirmed via axe-core that plain --accent on
		   this 6% tint fill is only 4.38:1 in the light theme (theme.css). */
		color: var(--accent-on-tint);
	}
	.sb-unc-hint {
		font-size: 12px;
		line-height: 1.35;
		color: var(--text-faint);
	}
	.sb-unc-row {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
	}
	.sb-unc-row--mobile {
		justify-content: space-between;
	}
	.sb-unc-dot {
		color: var(--text-faint);
	}
	.sb-unc-times {
		font-size: 12px;
		line-height: 1.35;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}
	.sb-unc-times--mobile {
		font-size: 10.5px;
	}
	.sb-unc-spacer {
		flex: 1 1 auto;
	}
	.sb-unc-action {
		font-size: 12px;
		font-weight: 500;
		color: var(--accent-on-tint);
		flex-shrink: 0;
	}
	.sb-unc-stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sb-unc-title--mobile {
		font-size: 12.5px;
	}
	.sb-unc-title-short {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--accent-on-tint);
		flex-shrink: 0;
	}
	.sb-unc-pill {
		flex-shrink: 0;
		padding: 2px 9px;
		border-radius: var(--radius-9999);
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		color: var(--accent-on-tint);
		font-size: 11px;
		font-weight: 500;
		line-height: 1.4;
	}
</style>
