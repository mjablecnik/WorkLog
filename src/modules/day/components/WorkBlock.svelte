<script module lang="ts">
	import type { Interval } from '$lib/contracts/models';
	import type { DayLayout } from './timeline-geometry';
	import type { RenderableSegment } from './SegmentBlock.svelte';

	/**
	 * `DayLayout['blocks'][number]` with its `segments` widened to `RenderableSegment` —
	 * see `SegmentBlock.svelte`'s own module comment for why `LaidOutSegment` alone isn't
	 * enough (no time data for an Uncovered_Time stretch). `DayTimeline` (task 3.5) is
	 * the component that actually builds this shape, since it is the only one holding
	 * both `layOutDay`'s output and the original `uncovered: Interval[]` array needed to
	 * pair times onto the uncovered stretches.
	 */
	export type RenderableBlock = Omit<DayLayout['blocks'][number], 'segments'> & {
		segments: RenderableSegment[];
	};
</script>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDuration, formatTimeOfDay, parseTimeOfDay } from '$lib/viz/format';
	import SegmentBlock from './SegmentBlock.svelte';
	import type { Density } from './timeline-geometry';

	interface Props {
		block: RenderableBlock;
		/** Used only to build a stable `wb-<index>-head` id — matches design.md's own
		 * `wb-3-head` example. Unique as long as the caller renders blocks in one list. */
		index: number;
		density: Density;
		now: Date;
		timeZone: string;
		locale: string;
		/** From the Health_Endpoint, threaded down through layout context — this
		 * component never knows the Evening_Hour itself. */
		eveningHour: number;
		/** Also from the Health_Endpoint — needed to compute a capped session's own cap
		 * instant, since `DayLayout.blocks` carries the `capped` flag but not the instant
		 * itself. */
		maxOpenSessionHours: number;
		/** Forwarded to every `SegmentBlock` child — see that component for the contract. */
		hoveredEntryId?: string | null;
		onSessionActivate: (sessionId: string) => void;
		onSessionEdgeActivate: (sessionId: string, edge: 'start' | 'end') => void;
		onActivityActivate: (entryId: string) => void;
		onUncoveredActivate: (range: Interval) => void;
		onEntryHover?: (entryId: string | null) => void;
	}

	let {
		block,
		index,
		density,
		now,
		timeZone,
		locale,
		eveningHour,
		maxOpenSessionHours,
		hoveredEntryId = null,
		onSessionActivate,
		onSessionEdgeActivate,
		onActivityActivate,
		onUncoveredActivate,
		onEntryHover
	}: Props = $props();

	const headId = $derived(`wb-${index}-head`);

	function fmtTime(t: Date): string {
		return formatTimeOfDay(t, locale, timeZone);
	}
	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, locale);
	}

	/** The instant a Stale_Session stopped counting — `bounds` inside `layOutDay`
	 * computes the same value but never returns it, only the `capped` flag. */
	const cappedAtMs = $derived(block.session.startedAt.getTime() + maxOpenSessionHours * 3_600_000);

	/** Requirement 4.9 / design.md "Running, Capped and Continuing Blocks": a closed
	 * session ends at `endedAt`; an open, stale one is drawn stopping at its cap
	 * instant; an open, still-counting one is drawn extending to `now`. */
	const effectiveEndMs = $derived(
		block.session.endedAt !== null
			? block.session.endedAt.getTime()
			: block.capped
				? cappedAtMs
				: now.getTime()
	);

	const fromTime = $derived(fmtTime(block.session.startedAt));
	const toTime = $derived(fmtTime(new Date(effectiveEndMs)));
	const durationSeconds = $derived((effectiveEndMs - block.session.startedAt.getTime()) / 1000);

	/**
	 * "Does any part of the session fall at or after the Evening_Hour of its
	 * Logical_Day" (design.md, "The Night Marker") — checked per local calendar day the
	 * session's drawn span touches, since crossing midnight is explicitly not the test.
	 * This intentionally mirrors the technique `format.ts` already documents borrowing
	 * from `src/lib/server/domain/logical-day.ts` (a small, independent, client-safe
	 * duplicate — this component may not import `$lib/server/**`) rather than the
	 * server's own `eveningInstant` (`day-aggregation.ts`), which additionally accounts
	 * for `DAY_START_HOUR`; that refinement is out of this component's reach and, per
	 * that file's own comment on the `continues` flag, worth reconciling once a caller
	 * can pass the real Logical_Day boundary instead.
	 */
	function dateStringInZone(instantMs: number, tz: string): string {
		const dtf = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		return dtf.format(new Date(instantMs));
	}
	function addDaysToDateString(date: string, days: number): string {
		const [y, mo, d] = date.split('-').map(Number);
		return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
	}
	function sessionTouchesEvening(startMs: number, endMs: number, hour: number, tz: string): boolean {
		if (endMs <= startMs) return false;
		const startDate = dateStringInZone(startMs, tz);
		const endDate = dateStringInZone(endMs, tz);
		let cursor = startDate;
		for (let guard = 0; guard < 400; guard++) {
			const eveningInstantMs = parseTimeOfDay(`${String(hour).padStart(2, '0')}:00`, cursor, tz).getTime();
			const nextMidnightMs = parseTimeOfDay('00:00', addDaysToDateString(cursor, 1), tz).getTime();
			if (eveningInstantMs < endMs && nextMidnightMs > startMs) return true;
			if (cursor === endDate) break;
			cursor = addDaysToDateString(cursor, 1);
		}
		return false;
	}

	const isNight = $derived(
		sessionTouchesEvening(block.session.startedAt.getTime(), effectiveEndMs, eveningHour, timeZone)
	);

	/** "running" and "continues" both draw the rail's bottom end square rather than
	 * rounded — "the block has no end yet". `running` is true for every open session
	 * (capped ones included), so a capped block gets a square end too, which is
	 * correct: it has not truly ended, only stopped counting. */
	const squareEnd = $derived(block.running || block.continues);

	const showEdges = $derived(block.heightPx >= 60);

	/**
	 * The capped rail's accent/muted split has no fraction in `layOutDay`'s output (see
	 * `WorkBlock`'s implementation report for why) — derived here from real elapsed
	 * time: `countedMs` (the fixed span up to the cap) over `elapsedMs` (real time
	 * since start, per `now`). Bucketed to the nearest tenth so the split is drawn
	 * through precompiled flex-grow classes (`.wb-flex-0` … `.wb-flex-10`) rather than
	 * an inline style, which the production CSP forbids.
	 */
	const splitBucket = $derived.by(() => {
		if (!block.capped) return 10;
		const countedMs = maxOpenSessionHours * 3_600_000;
		const elapsedMs = now.getTime() - block.session.startedAt.getTime();
		const fraction = elapsedMs > 0 ? Math.min(1, countedMs / elapsedMs) : 1;
		return Math.min(10, Math.max(0, Math.round(fraction * 10)));
	});
</script>

<section aria-labelledby={headId} class="wb wb--{density}">
	<div class="wb-head">
		<button
			id={headId}
			type="button"
			class="wb-head-btn"
			onclick={() => onSessionActivate(block.session.id)}
		>
			<span class="wb-head-main">
				{#if block.running}
					<span class="wb-head-dot" aria-hidden="true"></span>
				{/if}
				<span class="wb-head-time">{m.day_block_head({ from: fromTime, to: toTime })}</span>
				<span class="wb-head-sep" aria-hidden="true">·</span>
				<span class="wb-head-meta" class:wb-head-meta--accent={block.capped}>
					{block.capped ? m.day_block_capped() : m.day_block_duration({ duration: fmtDuration(durationSeconds) })}
				</span>
				{#if isNight}
					<span class="wb-head-sep" aria-hidden="true">·</span>
					<span class="wb-head-meta">{m.day_block_night()}</span>
				{/if}
				{#if block.continues}
					<span class="wb-head-sep" aria-hidden="true">·</span>
					<span class="wb-head-meta">{m.day_block_continues({ time: fmtTime(now) })}</span>
				{/if}
			</span>
			{#if block.running}
				<span class="wb-head-running">{m.day_block_running()}</span>
			{/if}
		</button>
	</div>

	<div class="wb-body">
		<div class="wb-rail" class:wb-rail--square={squareEnd} class:wb-rail--accent={block.running && !block.capped}>
			{#if block.capped}
				<div class="wb-rail-split-top wb-flex-{splitBucket}" aria-hidden="true"></div>
				<div class="wb-rail-split-bottom wb-flex-{10 - splitBucket}" aria-hidden="true"></div>
			{/if}
			{#if block.continues}
				<span class="wb-rail-notch" aria-hidden="true"></span>
			{/if}
			{#if showEdges}
				<button
					type="button"
					class="wb-rail-hit wb-rail-edge wb-rail-start"
					aria-label={m.aria_session_start_edge({ time: fromTime })}
					onclick={() => onSessionEdgeActivate(block.session.id, 'start')}
				></button>
				<button
					type="button"
					class="wb-rail-hit wb-rail-mid"
					aria-label={m.aria_session_block({ from: fromTime, to: toTime, duration: fmtDuration(durationSeconds) })}
					onclick={() => onSessionActivate(block.session.id)}
				></button>
				<button
					type="button"
					class="wb-rail-hit wb-rail-edge wb-rail-end"
					aria-label={m.aria_session_end_edge({ time: toTime })}
					onclick={() => onSessionEdgeActivate(block.session.id, 'end')}
				></button>
			{:else}
				<button
					type="button"
					class="wb-rail-hit wb-rail-mid wb-rail-mid--full"
					aria-label={m.aria_session_block({ from: fromTime, to: toTime, duration: fmtDuration(durationSeconds) })}
					onclick={() => onSessionActivate(block.session.id)}
				></button>
			{/if}
		</div>

		<ol class="wb-col">
			{#each block.segments as segment, i (segment.segment?.id ?? `${block.session.id}-u-${i}`)}
				<li>
					<SegmentBlock
						{segment}
						{density}
						{timeZone}
						{locale}
						{hoveredEntryId}
						{onActivityActivate}
						{onUncoveredActivate}
						{onEntryHover}
					/>
				</li>
			{/each}
		</ol>
	</div>
</section>

<style>
	.wb {
		display: flex;
		flex-direction: column;
		/* HEAD_GAP_PX (timeline-geometry.ts) -- the head-to-segment-column space
		   layOutDay already reserves in its fixed-row budget (Property 2). Desktop 8,
		   mobile 6 below. Without this the DOM's rendered height undershoots what the
		   layout algorithm budgeted for every block by this amount. */
		gap: 8px;
	}
	.wb--mobile {
		gap: 6px;
	}

	.wb-head-btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		height: 29px;
		box-sizing: border-box;
		border: none;
		background: transparent;
		padding: 0;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
		color: var(--text);
	}
	.wb--mobile .wb-head-btn {
		height: 24px;
	}

	.wb-head-main {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
	}

	.wb-head-dot {
		flex-shrink: 0;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-9999);
		background: var(--accent);
	}

	.wb-head-time {
		flex-shrink: 0;
		font-size: 13px;
		font-weight: 500;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.wb--mobile .wb-head-time {
		font-size: 12px;
	}

	.wb-head-sep {
		flex-shrink: 0;
		color: var(--text-faint);
	}

	.wb-head-meta {
		flex-shrink: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		line-height: 1.35;
		color: var(--text-faint);
	}
	.wb--mobile .wb-head-meta {
		font-size: 11px;
	}
	.wb-head-meta--accent {
		color: var(--accent);
	}

	.wb-head-running {
		flex-shrink: 0;
		font-size: 12px;
		font-weight: 500;
		color: var(--accent);
	}

	.wb-body {
		display: flex;
		align-items: stretch;
		gap: 14px;
	}
	.wb--mobile .wb-body {
		gap: 10px;
	}

	.wb-rail {
		position: relative;
		flex-shrink: 0;
		width: 8px;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-4);
		background: var(--rail);
	}
	.wb--mobile .wb-rail {
		width: 6px;
		border-radius: var(--radius-3);
	}
	.wb-rail--square {
		border-radius: var(--radius-4) var(--radius-4) 0 0;
	}
	.wb--mobile .wb-rail--square {
		border-radius: var(--radius-3) var(--radius-3) 0 0;
	}
	.wb-rail--accent {
		background: var(--accent);
	}

	.wb-rail-split-top {
		flex: 0 0 0%;
		border-radius: var(--radius-4) var(--radius-4) 0 0;
		background: var(--accent);
	}
	.wb-rail-split-bottom {
		flex: 0 0 0%;
		border-top: 1px solid var(--hairline);
		background: var(--rail);
		opacity: 0.5;
	}
	.wb-rail--square .wb-rail-split-bottom {
		border-radius: 0;
	}
	.wb-rail:not(.wb-rail--square) .wb-rail-split-bottom {
		border-radius: 0 0 var(--radius-4) var(--radius-4);
	}

	.wb-flex-0 {
		flex-grow: 0;
	}
	.wb-flex-1 {
		flex-grow: 1;
	}
	.wb-flex-2 {
		flex-grow: 2;
	}
	.wb-flex-3 {
		flex-grow: 3;
	}
	.wb-flex-4 {
		flex-grow: 4;
	}
	.wb-flex-5 {
		flex-grow: 5;
	}
	.wb-flex-6 {
		flex-grow: 6;
	}
	.wb-flex-7 {
		flex-grow: 7;
	}
	.wb-flex-8 {
		flex-grow: 8;
	}
	.wb-flex-9 {
		flex-grow: 9;
	}
	.wb-flex-10 {
		flex-grow: 10;
	}

	/* The `continues` notch — a 7 px --rail triangle centred on the bottom edge, in
	   the rail's own ink rather than a project colour (design.md: "the Split_Marker
	   notch in the rail's own ink"). */
	.wb-rail-notch {
		position: absolute;
		left: 50%;
		bottom: -6px;
		width: 0;
		height: 0;
		transform: translateX(-50%);
		pointer-events: none;
		border-left: 3.5px solid transparent;
		border-right: 3.5px solid transparent;
		border-top: 7px solid var(--rail);
	}

	.wb-rail-hit {
		position: absolute;
		left: 0;
		right: 0;
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		--focus-gap: var(--bg);
	}
	.wb-rail-edge {
		height: 12px;
	}
	.wb-rail-start {
		top: 0;
	}
	.wb-rail-end {
		bottom: 0;
	}
	.wb-rail-mid {
		top: 12px;
		bottom: 12px;
	}
	.wb-rail-mid--full {
		top: 0;
		bottom: 0;
	}

	.wb-col {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.wb-col > li {
		display: block;
	}
</style>
