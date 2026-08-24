<script lang="ts">
	/**
	 * `Day_Rhythm_Strip` (design.md "Statistics (Stats)", Requirements 12.6-12.9, 12.17,
	 * 12.20; tasks.md 8.3): one row per `Logical_Day` on a shared axis running from the
	 * server's `dayStartHour` back to it, drawing each day's `covered`/`uncovered`
	 * intervals at the position the work actually fell.
	 *
	 * Renders its own heading and sub-line (`stats_rhythm_title` / `stats_rhythm_sub`),
	 * since both come for free from the `dayStartHour` prop this component already
	 * needs for the axis. It does NOT render the project legend design.md's prose
	 * groups into the same heading row: a legend needs project *names*, and the literal
	 * `DayRhythmProps` shape design.md gives (verbatim below) carries only
	 * `colorIndex`-bearing intervals, not project names — so a legend would need either
	 * an extra prop or a second data source this component has no contract for. Left as
	 * an open question for whichever task assembles the full `Stats` page around this
	 * component; see the task report.
	 *
	 * `DayRhythm` is rendered by its caller only when `intervalsIncluded` is true
	 * (design.md: "The page, not the component, owns that branch") — so this component
	 * never sees a response with the intervals dropped. `covered`/`uncovered` are still
	 * defaulted to `[]` per day below anyway: cheap insurance against a `DaySummary`
	 * that reaches here without them, since both fields are optional on the wire type.
	 */
	import type { DaySummary } from '$lib/contracts/responses';
	import * as m from '$lib/paraglide/messages';
	import { getCurrentLocale } from '$lib/core/i18n';
	import { formatDayLabel, formatDuration, formatTimeOfDay, parseTimeOfDay } from '$lib/viz/format';
	import { projectSlotClass } from '$lib/viz/palette';
	import { positionPercent, widthPercent } from './rhythm-geometry';

	type DayRhythmProps = {
		/** Each carrying its `covered`/`uncovered` intervals. */
		days: DaySummary[];
		/** From the server, never a literal — the axis runs dayStartHour → dayStartHour. */
		dayStartHour: number;
		timeZone: string;
		today: string;
		onDayActivate: (date: string) => void;
	};

	let { days, dayStartHour, timeZone, today, onDayActivate }: DayRhythmProps = $props();

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}

	/**
	 * Formats an hour on the strip's axis (`dayStartHour` plus an offset, wrapping at
	 * 24) as a wall-clock string, via a `Date` built purely to carry that hour through
	 * `formatTimeOfDay` — `today` anchors it (any valid date would do; only the
	 * hour/minute survive the round trip through `timeZone`). `formatTimeOfDay` renders
	 * the same digits regardless of locale (a colon-separated 24h clock), so this passes
	 * `''` exactly like `fmtDuration` above.
	 */
	function axisHourLabel(hourOffset: number): string {
		const hour = (((dayStartHour + hourOffset) % 24) + 24) % 24;
		const at = parseTimeOfDay(`${String(hour).padStart(2, '0')}:00`, today, timeZone);
		return formatTimeOfDay(at, '', timeZone);
	}

	const rangeStartLabel = $derived(axisHourLabel(0));
	// Same instant as rangeStartLabel — the axis runs dayStartHour to dayStartHour, one
	// full 24h turn — kept as its own derived value so the two ends never drift apart
	// if this component is ever asked to show a different span.
	const rangeEndLabel = $derived(axisHourLabel(24));

	const AXIS_TICKS: { offsetHours: number; percent: number; interior: boolean }[] = [
		{ offsetHours: 0, percent: 0, interior: false },
		{ offsetHours: 6, percent: 25, interior: true },
		{ offsetHours: 12, percent: 50, interior: true },
		{ offsetHours: 18, percent: 75, interior: true },
		{ offsetHours: 24, percent: 100, interior: false }
	];

	function rowAriaLabel(day: DaySummary): string {
		return m.aria_rhythm_row({
			date: formatDayLabel(day.date, getCurrentLocale(), today, 'relative'),
			worked: fmtDuration(day.trackedSeconds)
		});
	}
</script>

<div class="day-rhythm">
	<div class="day-rhythm__head">
		<span class="day-rhythm__title">{m.stats_rhythm_title()}</span>
		<span class="day-rhythm__sub">{m.stats_rhythm_sub({ from: rangeStartLabel, to: rangeEndLabel })}</span>
	</div>

	<!-- Declares the uncovered hatch once; every row's own <svg> below references it by
	     id, which resolves across sibling <svg> elements in the same document. -->
	<svg class="day-rhythm__defs" width="0" height="0" aria-hidden="true">
		<defs>
			<pattern id="day-rhythm-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
				<rect width="3" height="6" class="day-rhythm__hatch-fill" fill-opacity="0.5" />
			</pattern>
		</defs>
	</svg>

	<div class="day-rhythm__rows">
		{#each days as day (day.date)}
			{@const isToday = day.date === today}
			{@const covered = day.covered ?? []}
			{@const uncovered = day.uncovered ?? []}
			<button
				type="button"
				class="day-rhythm__row"
				onclick={() => onDayActivate(day.date)}
				aria-label={rowAriaLabel(day)}
			>
				<span class="day-rhythm__label" class:day-rhythm__label--today={isToday}>
					{formatDayLabel(day.date, getCurrentLocale(), today, 'short')}
				</span>
				<svg class="day-rhythm__strip" role="presentation" aria-hidden="true">
					<rect class="day-rhythm__track" x="0" y="0" width="100%" height="100%" rx="5" ry="5" />
					<rect class="day-rhythm__tick day-rhythm__tick--quarter" x="25%" y="0" width="1" height="100%" />
					<rect class="day-rhythm__tick" x="50%" y="0" width="1" height="100%" />
					<rect class="day-rhythm__tick day-rhythm__tick--quarter" x="75%" y="0" width="1" height="100%" />
					{#each covered as interval, i (i)}
						<rect
							class="day-rhythm__segment {projectSlotClass(interval.colorIndex)}"
							x="{positionPercent(interval.start, dayStartHour, timeZone)}%"
							width="{widthPercent(interval.start, interval.end)}%"
							y="0"
							height="100%"
							rx="4"
							ry="4"
						/>
					{/each}
					{#each uncovered as interval, i (i)}
						<rect
							class="day-rhythm__segment day-rhythm__segment--uncovered"
							x="{positionPercent(interval.start, dayStartHour, timeZone)}%"
							width="{widthPercent(interval.start, interval.end)}%"
							y="0"
							height="100%"
							rx="4"
							ry="4"
							fill="url(#day-rhythm-hatch)"
						/>
					{/each}
					{#if isToday}
						<rect
							class="day-rhythm__today-ring"
							x="0"
							y="0"
							width="100%"
							height="100%"
							rx="5"
							ry="5"
						/>
					{/if}
				</svg>
				<span class="day-rhythm__total" class:day-rhythm__total--today={isToday}>
					{day.trackedSeconds > 0 ? fmtDuration(day.trackedSeconds) : '—'}
				</span>
			</button>
		{/each}

		<div class="day-rhythm__axis-row" aria-hidden="true">
			<span class="day-rhythm__axis-gutter"></span>
			<svg class="day-rhythm__axis" role="presentation">
				{#each AXIS_TICKS as tick (tick.offsetHours)}
					<text
						class="day-rhythm__axis-label"
						class:day-rhythm__axis-label--interior={tick.interior}
						class:day-rhythm__axis-label--quarter={tick.percent === 25 || tick.percent === 75}
						x="{tick.percent}%"
						y="11"
						text-anchor={tick.percent === 0 ? 'start' : tick.percent === 100 ? 'end' : 'middle'}
					>
						{axisHourLabel(tick.offsetHours)}
					</text>
				{/each}
			</svg>
			<span class="day-rhythm__axis-gutter"></span>
		</div>
	</div>
</div>

<style>
	.day-rhythm {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 22px;
		background: var(--panel);
		border-radius: var(--radius-14);
	}

	.day-rhythm__head {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.day-rhythm__title {
		font-size: 14px;
		font-weight: 500;
	}
	.day-rhythm__sub {
		font-size: 11.5px;
		color: var(--text-faint);
	}

	.day-rhythm__defs {
		display: block;
		width: 0;
		height: 0;
		overflow: hidden;
	}
	.day-rhythm__hatch-fill {
		fill: var(--accent);
	}

	.day-rhythm__rows {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.day-rhythm__row {
		display: grid;
		grid-template-columns: 40px 1fr 46px;
		align-items: center;
		gap: 14px;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		width: 100%;
	}
	.day-rhythm__row:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap),
			0 0 0 4px var(--accent);
		border-radius: var(--radius-9);
	}

	.day-rhythm__label {
		font-size: 12px;
		color: var(--text-faint);
	}
	.day-rhythm__label--today {
		/* Confirmed via axe-core (tests/e2e/a11y.spec.ts): plain --accent on this row's
		   background is only 4.31:1 in the light theme, just under 4.5:1. See
		   theme.css's --accent-on-tint doc comment. */
		color: var(--accent-on-tint);
	}

	.day-rhythm__strip {
		display: block;
		width: 100%;
		height: 18px;
	}
	.day-rhythm__track {
		fill: var(--track);
	}
	/* No dedicated gridline token exists (theme.css owns tokens; this component may not
	   add one) — reuse --text-faint, already themed correctly in both palettes, at a low
	   opacity so the tick reads as recessive rather than as a second axis. */
	.day-rhythm__tick {
		fill: var(--text-faint);
		opacity: 0.14;
	}
	.day-rhythm__today-ring {
		fill: none;
		stroke: rgba(209, 138, 106, 0.3);
		stroke-width: 1;
	}

	.day-rhythm__total {
		font-size: 12.5px;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
		text-align: right;
	}
	.day-rhythm__total--today {
		color: var(--accent);
	}

	.day-rhythm__axis-row {
		display: grid;
		grid-template-columns: 40px 1fr 46px;
		align-items: center;
		gap: 14px;
		padding-top: 4px;
	}
	.day-rhythm__axis {
		display: block;
		width: 100%;
		height: 14px;
	}
	.day-rhythm__axis-label {
		font-size: 11px;
		fill: var(--text-faint);
	}
	/* Mobile default: "three labels instead of five" — same even divisions of the span,
	   only the count drops because five do not fit at this width. */
	.day-rhythm__axis-label--quarter {
		display: none;
	}

	@media (min-width: 768px) {
		.day-rhythm__row,
		.day-rhythm__axis-row {
			grid-template-columns: 58px 1fr 62px;
		}
		.day-rhythm__strip {
			height: 22px;
		}
		.day-rhythm__axis-label--quarter {
			display: inline;
		}
	}
</style>
