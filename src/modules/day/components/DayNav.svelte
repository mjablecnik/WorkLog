<script lang="ts">
	/**
	 * Task 3.7 (design.md "Day Page, Desktop"/"Day Page, Mobile"; Requirements
	 * 5.1-5.4). Day-to-day navigation has no side effect beyond a route change, so
	 * this component is self-contained: it calls `goto()` itself (`$app/navigation`)
	 * rather than taking `onNavigate` callback props -- there is nothing for a parent
	 * to coordinate.
	 *
	 * SHAPE DIFFERS BY DENSITY, per design.md's own words: on desktop this renders
	 * ONLY the two 34px round icon buttons (design.md: "it goes into the heading
	 * line, left of the date, as two 34 px round icon buttons..."; +page.svelte
	 * renders the date text itself, once, in the shared heading line -- Requirement
	 * 5.6 wants that text in exactly one place, so this component never repeats it).
	 * On mobile this OWNS the whole 44px date row, date text included.
	 *
	 * `metaLabel` -- an addition beyond the task's suggested `{date; today; locale;
	 * density}` prop list: mobile's row carries the `day_heading_meta` line (bounds +
	 * worked total) stacked under the date (design.md: "the date 15/500 centred over
	 * `08:00 - 03:00 . 14 h 15 min`"). That text is computed from
	 * `DayResponse.bounds`/`totals`, which this component does not otherwise need --
	 * the day page computes it once for the desktop heading and passes the same
	 * string down, rather than this component reaching into the full day payload for
	 * one line only rendered on mobile.
	 *
	 * THE DATE PICKER (Requirement 5.2's third control): the artboards draw no
	 * calendar-icon affordance anywhere on the day page (design.md: "The desktop day
	 * page draws no date navigation in the artboards even though Requirement 5.2
	 * needs it"), and desktop's shape is pinned to exactly two round buttons with no
	 * room for a third. Rather than inventing a visible control the design contract
	 * doesn't show, `DatePicker` (task 1.3) is mounted invisibly (`opacity: 0`)
	 * behind the buttons/date, covering this component's full bounding box at a
	 * lower stacking position -- the buttons and (on mobile) the date text sit above
	 * it and keep their own click targets, while any other point in the row (the gap
	 * between the buttons on desktop; anywhere in the centred date on mobile) opens
	 * the native picker. `:has()` below gives the wrapper a visible focus ring when
	 * the otherwise-invisible input itself has keyboard focus, so it is never a
	 * focusable control with no visible focus state.
	 *
	 * `DatePicker`'s own prop contract (task 1.3) has no `onchange`/`aria-label` -- it
	 * forwards only `id`/`aria-describedby`. Rather than widening that shared
	 * component for this one caller, the change is read here through real DOM event
	 * bubbling (the native `<input>` DatePicker renders is a genuine descendant of
	 * this component's root element regardless of the Svelte component boundary, so
	 * a plain `onchange` on that root element still fires), and the accessible name
	 * comes from a real `<label for>` pointing at the input's `id` rather than an
	 * unsupported `aria-label` prop.
	 */
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { formatDayLabel } from '$lib/viz/format';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import DatePicker from '$lib/ui/forms/DatePicker.svelte';
	import type { Density } from './timeline-geometry';

	interface Props {
		/** The Logical_Day being shown. */
		date: string;
		/** The current Logical_Day (`data.today.date`), to disable/label "today". */
		today: string;
		locale: string;
		density: Density;
		/** Addition -- see the doc comment above. Ignored on desktop. */
		metaLabel: string;
	}

	let { date, today, locale, density, metaLabel }: Props = $props();

	const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
	const PICKER_ID = 'day-nav-date-picker';

	function shiftDate(value: string, deltaDays: number): string {
		const match = DATE_RE.exec(value);
		if (!match) return value;
		const y = Number(match[1]);
		const mo = Number(match[2]);
		const d = Number(match[3]);
		const shifted = new Date(Date.UTC(y, mo - 1, d) + deltaDays * 86_400_000);
		const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
		const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(shifted.getUTCDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	const isToday = $derived(date === today);
	const prevDate = $derived(shiftDate(date, -1));
	const nextDate = $derived(shiftDate(date, 1));
	const label = $derived(formatDayLabel(date, locale, today, 'relative'));

	function goPrev(): void {
		void goto(`/day/${prevDate}`);
	}

	function goNext(): void {
		if (isToday) return;
		void goto(`/day/${nextDate}`);
	}

	/** Fired by real DOM bubbling from the invisible `DatePicker`'s native input --
	 * see the doc comment above. */
	function handlePickerChange(event: Event): void {
		const target = event.target as HTMLElement;
		if (target.id !== PICKER_ID) return;
		const value = (target as HTMLInputElement).value;
		if (DATE_RE.test(value) && value !== date) void goto(`/day/${value}`);
	}
</script>

<div class="day-nav day-nav--{density}" onchange={handlePickerChange}>
	<label class="sr-only" for={PICKER_ID}>{m.day_pick()}</label>
	<DatePicker id={PICKER_ID} value={date} class="day-nav__picker" />

	<button type="button" class="day-nav__btn" aria-label={m.day_prev()} onclick={goPrev}>
		<Icon name="chevron-left" size={16} />
	</button>

	{#if density === 'mobile'}
		<div class="day-nav__center" aria-hidden="true">
			<span class="day-nav__date">{label}</span>
			<span class="day-nav__meta">{metaLabel}</span>
		</div>
	{/if}

	<button
		type="button"
		class="day-nav__btn"
		aria-label={m.day_next()}
		disabled={isToday}
		aria-disabled={isToday}
		onclick={goNext}
	>
		<Icon name="chevron-right" size={16} />
	</button>
</div>

<style>
	.day-nav {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.day-nav--mobile {
		justify-content: space-between;
		width: 100%;
		height: 44px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.day-nav :global(.day-nav__picker) {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		min-height: 0;
		padding: 0;
		border-radius: 9999px;
		opacity: 0;
		cursor: pointer;
	}

	.day-nav:has(:global(.day-nav__picker):focus-visible) {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
		border-radius: 9999px;
	}

	.day-nav__btn {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: none;
		border-radius: 9999px;
		background-color: var(--chip);
		color: var(--text-dim);
		cursor: pointer;
		transition: background-color var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.day-nav__btn:hover:not(:disabled) {
		background-color: rgb(from var(--chip) r g b / calc(alpha + 0.03));
		color: var(--text);
	}

	.day-nav__btn:disabled {
		cursor: not-allowed;
		opacity: 0.3;
	}

	.day-nav__center {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		pointer-events: none;
	}

	.day-nav__date {
		font-size: 15px;
		font-weight: 500;
		color: var(--text);
	}

	.day-nav__meta {
		font-size: 10px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
