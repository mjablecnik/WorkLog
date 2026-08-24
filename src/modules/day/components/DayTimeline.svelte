<script lang="ts">
	/**
	 * The `Day_Timeline` (task 3.5, design.md "3. Day Timeline"). Renders `WorkBlock`
	 * and `BreakMarker` in chronological DOM order from `layOutDay`'s output, measures
	 * its own rendered height to feed back into `layOutDay` as `availablePx`, and owns
	 * the one piece of state the block/segment components need but cannot own
	 * themselves: which entry is currently hovered or focused, so a `Split_Marker` can
	 * link a segment to its sibling part across a break in a different `WorkBlock`.
	 *
	 * No `orientation`, no `compact`, no `bounds`, no `editable`, no `onSessionResize` —
	 * all leftovers of a dropped drag feature or properties `layOutDay` never used
	 * (design.md, "3. Day Timeline").
	 *
	 * `timeZone`, `locale` and `eveningHour` are not in design.md's literal
	 * `DayTimelineProps` code block, but `WorkBlock`/`SegmentBlock` (built afterwards,
	 * task 3.4) both require them as non-optional props — this component's shape is
	 * extended faithfully to actually supply what its children need. Likewise `date`:
	 * `aria_timeline({date})` needs a day string this component has no other reliable
	 * source for (an empty day has no session to derive one from), so it is a plain
	 * prop rather than something derived.
	 */
	import type { ActivityEntry, Interval, WorkSession } from '$lib/contracts/models';
	import * as m from '$lib/paraglide/messages';
	import EmptyState from '$lib/ui/components/EmptyState.svelte';
	import WorkBlock from './WorkBlock.svelte';
	import BreakMarker from './BreakMarker.svelte';
	import { layOutDay, type DayLayout, type Density } from './timeline-geometry';

	interface Props {
		sessions: WorkSession[];
		entries: ActivityEntry[];
		uncovered: Interval[];
		maxOpenSessionHours: number;
		/** From the Health_Endpoint — required by every `WorkBlock` to draw the Night
		 * Marker (design.md "The Night Marker"). This component never inspects it. */
		eveningHour: number;
		now: Date;
		density: Density;
		timeZone: string;
		locale: string;
		/** The Logical_Day being shown, for `aria_timeline({date})`. */
		date: string;
		onActivityActivate: (entryId: string) => void;
		onSessionActivate: (sessionId: string) => void;
		onSessionEdgeActivate: (sessionId: string, edge: 'start' | 'end') => void;
		onUncoveredActivate: (range: Interval) => void;
	}

	let {
		sessions,
		entries,
		uncovered,
		maxOpenSessionHours,
		eveningHour,
		now,
		density,
		timeZone,
		locale,
		date,
		onActivityActivate,
		onSessionActivate,
		onSessionEdgeActivate,
		onUncoveredActivate
	}: Props = $props();

	/**
	 * The one piece of shared state `WorkBlock`/`SegmentBlock` explicitly require a
	 * parent to own (their own doc comments: "`DayTimeline` is where the shared
	 * currently hovered/focused entry id state must live"). Fanned back down to every
	 * block as `hoveredEntryId`, updated from every block's `onEntryHover`.
	 */
	let hoveredEntryId = $state<string | null>(null);
	function handleEntryHover(entryId: string | null): void {
		hoveredEntryId = entryId;
	}

	/**
	 * A placeholder used only until the column is measured on mount — this component
	 * has no cookie/viewport prop to seed a server-computed value (design.md's
	 * server-side `availablePx` determinism is a page-level concern, out of this
	 * component's own props). 712 mirrors design.md's own documented desktop fallback
	 * ("1440 × 900" → "availablePx = 712"); it is overwritten by the first real
	 * measurement before the effect's first paint settles.
	 */
	const INITIAL_AVAILABLE_PX = 712;

	let columnEl: HTMLElement | undefined = $state();
	let availablePx = $state(INITIAL_AVAILABLE_PX);

	$effect(() => {
		const el = columnEl;
		if (!el || typeof ResizeObserver === 'undefined') return;

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		function measure(): void {
			availablePx = el!.clientHeight;
		}
		measure();

		// Debounced so a window resize does not re-run layOutDay on every pixel.
		const observer = new ResizeObserver(() => {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			timeoutId = setTimeout(measure, 120);
		});
		observer.observe(el);

		return () => {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			observer.disconnect();
		};
	});

	const layout = $derived<DayLayout>(
		sessions.length > 0
			? layOutDay(sessions, entries, uncovered, availablePx, density, now, maxOpenSessionHours)
			: { blocks: [], breaks: [] }
	);

	/** At most one break follows any given block index (`layOutDay` emits one break
	 * per gap between two adjacent sessions), so a lookup map is exact, not a filter. */
	const breakAfterBlock = $derived.by(() => {
		// A plain Map, not SvelteMap: built once per recompute and never mutated after
		// being returned, so there is no post-construction `.set()`/`.delete()` for
		// Svelte's reactivity to need to observe.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<number, DayLayout['breaks'][number]>();
		for (const brk of layout.breaks) map.set(brk.after, brk);
		return map;
	});
</script>

<section
	class="day-timeline day-timeline--{density}"
	bind:this={columnEl}
	aria-label={m.aria_timeline({ date })}
>
	{#if sessions.length === 0}
		<div class="day-timeline__empty">
			<p class="day-timeline__empty-title">{m.day_empty_title()}</p>
			<EmptyState icon="info" message={m.day_empty_body()} />
		</div>
	{:else}
		{#each layout.blocks as block, i (block.session.id)}
			<WorkBlock
				{block}
				index={i}
				{density}
				{now}
				{timeZone}
				{locale}
				{eveningHour}
				{maxOpenSessionHours}
				{hoveredEntryId}
				{onSessionActivate}
				{onSessionEdgeActivate}
				{onActivityActivate}
				{onUncoveredActivate}
				onEntryHover={handleEntryHover}
			/>
			{@const brk = breakAfterBlock.get(i)}
			{#if brk}
				<BreakMarker {brk} {density} {timeZone} {locale} />
			{/if}
		{/each}
	{/if}
</section>

<style>
	/*
	 * No `gap` here: `BLOCK_TO_BREAK_PX` (block-to-Break_Marker spacing) is already
	 * baked into `BreakMarker`'s own vertical padding, and `WorkBlock` carries no
	 * external margin of its own — adding a container gap on top would double-count
	 * space `layOutDay`'s "fixed" budget never reserved twice.
	 *
	 * `overflow-y: auto` (never `hidden`) is the mobile artboard's `overflow: hidden`
	 * corrected to the real contract (design.md, "2. Timeline Geometry": "That is a
	 * drawing convenience, not the contract — the column scrolls"): when the laid-out
	 * content exceeds the measured `availablePx`, the column scrolls rather than any
	 * block compressing below its computed floor.
	 */
	.day-timeline {
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow-y: auto;
	}

	.day-timeline__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 100%;
		margin: auto 0;
	}

	.day-timeline__empty-title {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
		text-align: center;
	}
</style>
