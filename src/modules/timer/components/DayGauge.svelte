<script lang="ts">
	/**
	 * The timer page's centrepiece (task 6.5, design.md section "4. Day Gauge",
	 * Requirement 16). Draws the 24h dial, the Gauge_Track/Gauge_Gap, every
	 * Work_Session and Activity_Segment arc, Uncovered_Time, and the Overtime_Arc
	 * decorations — and positions whatever the caller hands it (typically
	 * `TimerControl`, task 6.7, not yet built) dead-centre over the dial via the
	 * `center` snippet.
	 *
	 * Prop shape (design.md gives this component no literal `type … Props` block
	 * the way it does for `ActivityDialog`/`ChangePreview`'s siblings, so this is
	 * inferred, per the task brief):
	 *
	 * - `sessions` / `entries` / `uncovered` — the raw `DayResponse` shapes
	 *   (`sessions`, `entries` with their `segments`, `coverage.uncovered`). This
	 *   component derives every duration it needs (worked/described/undescribed
	 *   totals for the `aria-label`) from these with plain arithmetic — summing an
	 *   already-resolved list of intervals, exactly like `ChangePreview.svelte`'s
	 *   `segmentsSeconds`/`intervalSeconds` helpers do — never a second opinion
	 *   about which intervals exist, which stays entirely server-side (Clipping,
	 *   the session union). No separate `trackedSeconds`/`coveredSeconds`/
	 *   `uncoveredSeconds` props are taken: they would just be the same sums
	 *   computed a second time at the call site.
	 * - `window` — the `Gauge_Window` from `/api/health` (`gaugeStart`/`gaugeEnd`).
	 *   Destructured as `gaugeWindow` internally so it never shadows the global
	 *   `window`.
	 * - `date` / `timeZone` — bind one `gaugeGeometry` instance, exactly as
	 *   `createGaugeGeometry`'s own signature wants them.
	 * - `now` — the instant an Open_Session's arc is drawn to. Passed in rather
	 *   than read from `Date.now()` here so a parent's single ticking clock (the
	 *   `elapsed.svelte.ts` store) is the one source of "now" a render used, and a
	 *   re-render of this component alone never disagrees with the hero readout
	 *   above it.
	 * - `density` — `desktop` (340×340) or `mobile` (300×300); the `viewBox` stays
	 *   `-22 -22 364 364` either way, so every geometric number below is a
	 *   `viewBox` unit scaled by the box, never a CSS pixel.
	 * - `center` — a Svelte 5 snippet, not a `TimerControl`-shaped prop set.
	 *   `TimerControl` is task 6.7 and does not exist yet; a snippet lets this
	 *   component position *whatever* the caller renders at the exact centre
	 *   without depending on that component's props, size or halo — all of which
	 *   design.md treats as `TimerControl`'s own concern. The centre of the
	 *   `viewBox` (160,160) is, by construction, the exact midpoint of
	 *   `-22..342`, i.e. 50%/50% of the rendered box at *either* density — so the
	 *   wrapper needs no density-specific pixel math (`Main.dc.html`'s literal
	 *   `left:170px;top:170px` is exactly 50% of the desktop 340px box).
	 *
	 * DEVIATION FROM `gauge-geometry.ts`'s `arc()`, DOCUMENTED THERE AND IN
	 * `.agents/ISSUES.md` ("gauge-geometry.ts's arc() is scoped to single-calendar
	 * -day spans only" / "design.md's Property 1 wording contradicts angleOf's
	 * required periodicity"): `angleOf(t)` is periodic on wall-clock
	 * time-of-day — it always returns a value in `[45, 405)` no matter which
	 * calendar day `t` falls on. Two consequences this component must handle
	 * itself, since `gauge-geometry.ts` is explicitly out of scope to change:
	 *
	 * 1. `arc()` throws for any span whose *end* has an earlier time-of-day than
	 *    its *start* (a session or segment crossing a real wall-clock midnight —
	 *    common, e.g. 22:00→02:00). `splitAtLocalMidnights` below splits such a
	 *    span into per-day pieces before calling `arc()`, exactly as its own
	 *    JSDoc instructs callers to. Because the exact midnight instant itself
	 *    canonicalises to the *same* angle as that day's own start (45°, not
	 *    405°), ending a piece precisely at midnight would make `arc()`'s
	 *    from/to angles go backwards again — so the split lands 1ms *before*
	 *    midnight for the outgoing piece and exactly at midnight for the
	 *    incoming one, a sub-millisecond, sub-pixel seam.
	 * 2. A span of exactly or more than 24 hours at the same wall-clock
	 *    start/end time makes `angleOf(to) - angleOf(from)` evaluate to `0`, so
	 *    `arc()` would silently draw a near-invisible 1.5°-floored sliver instead
	 *    of the full turn it actually is. `spansFullDayOrMore` below detects this
	 *    *before* calling `arc()` at all and this component emits a `<circle>`
	 *    directly, per Requirement 16.12's own text ("a closed ring cannot be
	 *    drawn as an arc back to its own start point"). Applied to: the outer
	 *    ring's Open_Session (point 5 in the paint order below — `GaugeNonstop`
	 *    is the reference), the outer ring's closed sessions collectively
	 *    (`closedSessionsFormFullDay`, a contiguous-merge ≥24h heuristic — no
	 *    artboard shows this combination, it is Requirement 16.12 applied to the
	 *    "all closed" half of `GaugeNormal`'s caption), and, defensively, any
	 *    single inner Activity_Segment or Uncovered_Time interval that alone
	 *    reaches 24h — the same underlying bug applies to every ring, even though
	 *    only the outer one is named in the requirement text.
	 *
	 * Paint order (fixed, see design.md's "floored arcs may overlap" paragraph):
	 * outer groove → inner groove → graduations → closed Work_Session arcs →
	 * Open_Session arc (+ the Overtime_Arc dot/label decorations, which this
	 * component paints right after the outer ring since they only ever occupy
	 * the bare Gauge_Gap and cannot overlap anything painted before or after) →
	 * inner Activity_Segment arcs in chronological order → Uncovered_Time dashes,
	 * last of all.
	 *
	 * Accessibility: the `<svg>` itself carries `role="img"` and the
	 * `timer_gauge_label` summary; everything decorative sits inside one
	 * `aria-hidden="true"` `<g>`. `timer_gauge_label`'s compiled selector matches
	 * `i?.running === "true"` — a *string* comparison, not a boolean — so
	 * `running` is passed as `'true' | 'false'` rather than a boolean.
	 *
	 * Hover: an inner arc segment responds to `pointerenter`/`pointerleave` with a
	 * small SVG-native tooltip — a `<rect>` + `<text>` pair positioned by
	 * `pointAt`, not an HTML overlay. `Tooltip.svelte`'s API (a sibling-hover
	 * `<span>` trigger wrapping `children`) does not fit an SVG `<path>` trigger
	 * whose anchor point is a computed polar coordinate, and an HTML overlay
	 * would need inline `style` to position at that coordinate, which
	 * Requirement 17.13 forbids for anything outside the SVG's own presentation
	 * attributes. Keeping the whole tooltip inside the SVG sidesteps both
	 * problems and keeps it exempt from the no-inline-style rule like the rest of
	 * this component.
	 */
	import type { Snippet } from 'svelte';
	import type { ActivityEntry, ActivitySegment, Interval, WorkSession } from '$lib/contracts/models';
	import * as m from '$lib/paraglide/messages';
	import { formatDuration, formatTimeOfDay, parseTimeOfDay } from '$lib/viz/format';
	import { projectSlotClass } from '$lib/viz/palette';
	import { createGaugeGeometry, type GaugeArc } from './gauge-geometry';

	interface Props {
		sessions: WorkSession[];
		entries: ActivityEntry[];
		uncovered: Interval[];
		window: { start: string; end: string };
		date: string;
		timeZone: string;
		now: Date;
		density?: 'desktop' | 'mobile';
		center?: Snippet;
		class?: string;
	}

	let {
		sessions,
		entries,
		uncovered,
		window: gaugeWindow,
		date,
		timeZone,
		now,
		density = 'desktop',
		center,
		class: className = ''
	}: Props = $props();

	// -- Geometry constants, all viewBox units (design.md § "4. Day Gauge") -----
	const CX = 160;
	const CY = 160;
	const OUTER_R = 138;
	const OUTER_STROKE = 10;
	const INNER_R = 118;
	const INNER_STROKE = 6;
	const TICK_START_R = 146;
	const OVERTIME_LABEL_R = 162;
	const OVERTIME_DOT_R = 4;
	const MS_PER_DAY = 24 * 60 * 60 * 1000;

	const GRADUATION: Record<1 | 3 | 6, { end: number; width: number; ink: string }> = {
		1: { end: 150, width: 1.1, ink: 'var(--dial-hour)' },
		3: { end: 154, width: 1.3, ink: 'var(--dial-3h)' },
		6: { end: 156, width: 1.5, ink: 'var(--dial-6h)' }
	};

	const boxPx = $derived(density === 'desktop' ? 340 : 300);

	const geometry = $derived(createGaugeGeometry(gaugeWindow, date, timeZone, CX, CY));
	const marks = $derived(geometry.graduations());
	const grooveIsFullCircle = $derived(geometry.trackEnd - geometry.trackStart >= 360);

	// -- Local duplicates of the midnight-crossing / periodicity workarounds ----
	// (see the module doc above for why gauge-geometry.ts's arc() needs these).

	function localDateString(t: Date, tz: string): string {
		const dtf = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		const parts = dtf.formatToParts(t);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return `${get('year')}-${get('month')}-${get('day')}`;
	}

	function addDays(dateStr: string, days: number): string {
		const [y, mo, d] = dateStr.split('-').map(Number);
		return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
	}

	function nextLocalMidnightAfter(t: Date, tz: string): Date {
		const ds = localDateString(t, tz);
		return parseTimeOfDay('00:00', addDays(ds, 1), tz);
	}

	/** Splits `[from, to)` at every local wall-clock midnight it crosses, so each
	 * piece can be handed to `geometry.arc()` without tripping its "angleOf(to)
	 * must be >= angleOf(from)" guard. The outgoing piece of each split ends 1ms
	 * before midnight rather than exactly at it — see the module doc. */
	function splitAtLocalMidnights(from: Date, to: Date, tz: string): [Date, Date][] {
		const pieces: [Date, Date][] = [];
		let cursor = from;
		let guard = 0;
		while (cursor < to && guard < 8) {
			guard++;
			const boundary = nextLocalMidnightAfter(cursor, tz);
			if (boundary >= to) {
				pieces.push([cursor, to]);
				return pieces;
			}
			pieces.push([cursor, new Date(boundary.getTime() - 1)]);
			cursor = boundary;
		}
		if (cursor < to) pieces.push([cursor, to]);
		return pieces;
	}

	function spansFullDayOrMore(from: Date, to: Date): boolean {
		return to.getTime() - from.getTime() >= MS_PER_DAY;
	}

	/** `geometry.arc()`, pre-split at local midnights. Never called on a span
	 * `spansFullDayOrMore` already flagged — callers emit a `<circle>` instead. */
	function splitAndDraw(
		from: Date,
		to: Date,
		radius: number
	): { from: Date; to: Date; arc: GaugeArc }[] {
		if (to <= from) return [];
		return splitAtLocalMidnights(from, to, timeZone).map(([f, t]) => ({
			from: f,
			to: t,
			arc: geometry.arc(f, t, radius)
		}));
	}

	/** A raw degree-to-degree arc path (grooves only) — `geometry.arc()` is
	 * Date-based and floors short sweeps, neither of which the track grooves
	 * want; they always span the whole (fixed, non-degenerate unless
	 * `grooveIsFullCircle`) `Gauge_Window`. */
	function boundedArcPath(fromDeg: number, toDeg: number, radius: number): string {
		const large = toDeg - fromDeg > 180 ? 1 : 0;
		const p1 = geometry.pointAt(fromDeg, radius);
		const p2 = geometry.pointAt(toDeg, radius);
		return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${large} 1 ${p2.x} ${p2.y}`;
	}

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}
	function fmtTime(t: Date): string {
		return formatTimeOfDay(t, '', timeZone);
	}

	// -- Sessions: open vs closed, and the ≥24h full-circle detections ---------

	const openSession = $derived(sessions.find((s) => s.endedAt === null) ?? null);
	const closedSessions = $derived(sessions.filter((s) => s.endedAt !== null));

	const openIsFullCircle = $derived(
		openSession !== null && spansFullDayOrMore(openSession.startedAt, now)
	);

	/** Contiguous-merge ≥24h heuristic: true when the closed sessions, merged by
	 * real elapsed time wherever one starts before or exactly when the previous
	 * one ends, form a single unbroken block of 24h or more. A single closed
	 * session of ≥24h trivially satisfies this as its own one-session block. */
	function closedSessionsFormFullDay(closed: WorkSession[]): boolean {
		if (closed.length === 0) return false;
		const sorted = [...closed].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
		let blockStart = sorted[0].startedAt.getTime();
		let blockEnd = (sorted[0].endedAt as Date).getTime();
		for (let i = 1; i < sorted.length; i++) {
			const startMs = sorted[i].startedAt.getTime();
			const endMs = (sorted[i].endedAt as Date).getTime();
			if (startMs > blockEnd) {
				if (blockEnd - blockStart >= MS_PER_DAY) return true;
				blockStart = startMs;
				blockEnd = endMs;
			} else if (endMs > blockEnd) {
				blockEnd = endMs;
			}
		}
		return blockEnd - blockStart >= MS_PER_DAY;
	}

	const closedIsFullCircle = $derived(closedSessionsFormFullDay(closedSessions));
	const showFullCircleOuter = $derived(closedIsFullCircle || openIsFullCircle);

	const closedPieces = $derived.by(() => {
		if (closedIsFullCircle) return [];
		const pieces: { key: string; path: string }[] = [];
		for (const s of closedSessions) {
			const parts = splitAndDraw(s.startedAt, s.endedAt as Date, OUTER_R);
			parts.forEach((p, i) => pieces.push({ key: `${s.id}-${i}`, path: p.arc.path }));
		}
		return pieces;
	});

	const openPieces = $derived.by(() => {
		if (openSession === null || openIsFullCircle) return [];
		return splitAndDraw(openSession.startedAt, now, OUTER_R).map((p, i) => ({
			key: `${openSession.id}-${i}`,
			path: p.arc.path
		}));
	});

	// -- Overtime_Arc decorations (outer ring only — see the report) -----------

	const trackStartInstant = $derived(parseTimeOfDay(gaugeWindow.start, date, timeZone));
	const trackEndInstant = $derived.by(() => {
		const end = parseTimeOfDay(gaugeWindow.end, date, timeZone);
		return end <= trackStartInstant ? new Date(end.getTime() + MS_PER_DAY) : end;
	});

	const earliestStart = $derived.by(() => {
		if (sessions.length === 0) return null;
		return sessions.reduce((a, b) => (b.startedAt < a ? b.startedAt : a), sessions[0].startedAt);
	});
	const latestEnd = $derived.by(() => {
		if (sessions.length === 0) return null;
		const ends = sessions.map((s) => s.endedAt ?? now);
		return ends.reduce((a, b) => (b > a ? b : a), ends[0]);
	});

	const overtimeBefore = $derived.by(() => {
		if (showFullCircleOuter || earliestStart === null) return null;
		if (earliestStart >= trackStartInstant) return null;
		return { time: fmtTime(earliestStart), labelAngle: geometry.angleOf(earliestStart) };
	});
	const overtimeAfter = $derived.by(() => {
		if (showFullCircleOuter || latestEnd === null) return null;
		if (latestEnd <= trackEndInstant) return null;
		return { time: fmtTime(latestEnd), labelAngle: geometry.angleOf(latestEnd) };
	});

	// -- Inner arcs (Activity_Segment), chronological, with hover metadata -----

	type InnerPiece = {
		key: string;
		segmentId: string;
		projectName: string;
		segStart: Date;
		segEnd: Date;
		colorClass: string;
		midAngle: number;
		kind: 'path' | 'circle';
		path?: string;
	};

	const innerSegmentsSorted = $derived(
		entries
			.flatMap((entry) => entry.segments.map((seg) => ({ seg, entry })))
			.sort((a, b) => a.seg.startedAt.getTime() - b.seg.startedAt.getTime())
	);

	const innerPieces = $derived.by(() => {
		const pieces: InnerPiece[] = [];
		for (const { seg, entry } of innerSegmentsSorted as { seg: ActivitySegment; entry: ActivityEntry }[]) {
			const colorClass = projectSlotClass(entry.colorIndex);
			if (spansFullDayOrMore(seg.startedAt, seg.endedAt)) {
				pieces.push({
					key: `${seg.id}-circle`,
					segmentId: seg.id,
					projectName: entry.projectName,
					segStart: seg.startedAt,
					segEnd: seg.endedAt,
					colorClass,
					midAngle: 270,
					kind: 'circle'
				});
				continue;
			}
			const parts = splitAndDraw(seg.startedAt, seg.endedAt, INNER_R);
			parts.forEach((p, i) => {
				const midAngle = (geometry.angleOf(p.from) + geometry.angleOf(p.to)) / 2;
				pieces.push({
					key: `${seg.id}-${i}`,
					segmentId: seg.id,
					projectName: entry.projectName,
					segStart: seg.startedAt,
					segEnd: seg.endedAt,
					colorClass,
					midAngle,
					kind: 'path',
					path: p.arc.path
				});
			});
		}
		return pieces;
	});

	let hoveredKey: string | null = $state(null);
	const hoveredPiece = $derived(innerPieces.find((p) => p.key === hoveredKey) ?? null);
	const tooltipText = $derived(
		hoveredPiece === null
			? ''
			: `${hoveredPiece.projectName} · ${fmtTime(hoveredPiece.segStart)}–${fmtTime(hoveredPiece.segEnd)}`
	);
	const tooltipAnchor = $derived.by(() => {
		if (hoveredPiece === null) return null;
		return geometry.pointAt(hoveredPiece.midAngle, INNER_R + 22);
	});
	const tooltipWidth = $derived(Math.max(46, tooltipText.length * 6.1 + 16));

	function onSegmentEnter(key: string): void {
		hoveredKey = key;
	}
	function onSegmentLeave(key: string): void {
		if (hoveredKey === key) hoveredKey = null;
	}

	// -- Uncovered_Time dashes, painted last of all -----------------------------

	const uncoveredPieces = $derived.by(() => {
		const pieces: { key: string; kind: 'path' | 'circle'; path?: string }[] = [];
		uncovered.forEach((iv, idx) => {
			if (spansFullDayOrMore(iv.start, iv.end)) {
				pieces.push({ key: `u-${idx}-circle`, kind: 'circle' });
				return;
			}
			splitAndDraw(iv.start, iv.end, INNER_R).forEach((p, i) => {
				pieces.push({ key: `u-${idx}-${i}`, kind: 'path', path: p.arc.path });
			});
		});
		return pieces;
	});

	// -- The day's totals, for the accessible text alternative -----------------
	// Plain sums over intervals the server already returned — no domain rule is
	// re-derived, exactly like ChangePreview.svelte's segmentsSeconds/intervalSeconds.

	const workedSeconds = $derived(
		sessions.reduce((sum, s) => sum + ((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 1000, 0)
	);
	const coveredSeconds = $derived(
		entries.reduce(
			(sum, entry) =>
				sum +
				entry.segments.reduce((s2, seg) => s2 + (seg.endedAt.getTime() - seg.startedAt.getTime()) / 1000, 0),
			0
		)
	);
	const uncoveredSecondsTotal = $derived(
		uncovered.reduce((sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()) / 1000, 0)
	);
	const running = $derived(openSession !== null);

	const ariaLabel = $derived(
		m.timer_gauge_label({
			date,
			worked: fmtDuration(workedSeconds),
			covered: fmtDuration(coveredSeconds),
			uncovered: fmtDuration(uncoveredSecondsTotal),
			running: running ? 'true' : 'false'
		})
	);
</script>

<div class="day-gauge day-gauge--{density} {className}">
	<svg
		class="day-gauge__svg"
		width={boxPx}
		height={boxPx}
		viewBox="-22 -22 364 364"
		role="img"
		aria-label={ariaLabel}
	>
		<g aria-hidden="true">
			<!-- 1. Outer groove -->
			{#if grooveIsFullCircle}
				<circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="var(--groove-outer)" stroke-width={OUTER_STROKE} />
			{:else}
				<path
					d={boundedArcPath(geometry.trackStart, geometry.trackEnd, OUTER_R)}
					fill="none"
					stroke="var(--groove-outer)"
					stroke-width={OUTER_STROKE}
					stroke-linecap="round"
				/>
			{/if}

			<!-- 2. Inner groove -->
			{#if grooveIsFullCircle}
				<circle cx={CX} cy={CY} r={INNER_R} fill="none" stroke="var(--groove-inner)" stroke-width={INNER_STROKE} />
			{:else}
				<path
					d={boundedArcPath(geometry.trackStart, geometry.trackEnd, INNER_R)}
					fill="none"
					stroke="var(--groove-inner)"
					stroke-width={INNER_STROKE}
					stroke-linecap="round"
				/>
			{/if}

			<!-- 3. Graduations -->
			{#each marks as mark (mark.hour)}
				{@const spec = GRADUATION[mark.level]}
				{@const p1 = geometry.pointAt(mark.angle, TICK_START_R)}
				{@const p2 = geometry.pointAt(mark.angle, spec.end)}
				<line
					x1={p1.x}
					y1={p1.y}
					x2={p2.x}
					y2={p2.y}
					stroke={spec.ink}
					stroke-width={spec.width}
					stroke-linecap="round"
				/>
				{#if mark.label !== null}
					{@const lp = geometry.pointAt(mark.angle, spec.end + 12)}
					<text
						x={lp.x}
						y={lp.y}
						dy="0.35em"
						class="day-gauge__numeral"
						fill="var(--dial-numeral)"
						font-size="12"
						text-anchor="middle">{mark.label}</text
					>
				{/if}
			{/each}

			<!-- 4. Closed Work_Session arcs -->
			{#if closedIsFullCircle}
				<circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="var(--arc-closed)" stroke-width={OUTER_STROKE} />
			{:else}
				{#each closedPieces as piece (piece.key)}
					<path d={piece.path} fill="none" stroke="var(--arc-closed)" stroke-width={OUTER_STROKE} />
				{/each}
			{/if}

			<!-- 5. Open_Session arc, painted after the closed ones -->
			{#if openIsFullCircle}
				<circle cx={CX} cy={CY} r={OUTER_R} fill="none" stroke="var(--accent)" stroke-width={OUTER_STROKE} />
			{:else}
				{#each openPieces as piece (piece.key)}
					<path d={piece.path} fill="none" stroke="var(--accent)" stroke-width={OUTER_STROKE} />
				{/each}
			{/if}

			<!-- Overtime_Arc decorations: dot at the track end it left, label at its far end -->
			{#if overtimeBefore !== null}
				{@const dot = geometry.pointAt(geometry.trackStart, OUTER_R)}
				{@const lp = geometry.pointAt(overtimeBefore.labelAngle, OVERTIME_LABEL_R)}
				<circle cx={dot.x} cy={dot.y} r={OVERTIME_DOT_R} fill="var(--accent)" />
				<text
					x={lp.x}
					y={lp.y}
					dy="0.35em"
					class="day-gauge__overtime-label"
					fill="var(--accent)"
					font-size="12"
					font-weight="500"
					text-anchor="middle">{overtimeBefore.time}</text
				>
			{/if}
			{#if overtimeAfter !== null}
				{@const dot = geometry.pointAt(geometry.trackEnd, OUTER_R)}
				{@const lp = geometry.pointAt(overtimeAfter.labelAngle, OVERTIME_LABEL_R)}
				<circle cx={dot.x} cy={dot.y} r={OVERTIME_DOT_R} fill="var(--accent)" />
				<text
					x={lp.x}
					y={lp.y}
					dy="0.35em"
					class="day-gauge__overtime-label"
					fill="var(--accent)"
					font-size="12"
					font-weight="500"
					text-anchor="middle">{overtimeAfter.time}</text
				>
			{/if}

			<!-- 6. Inner Activity_Segment arcs, chronological order of interval start -->
			{#each innerPieces as piece (piece.key)}
				{#if piece.kind === 'circle'}
					<circle
						cx={CX}
						cy={CY}
						r={INNER_R}
						fill="none"
						stroke="var(--pj)"
						stroke-width={INNER_STROKE}
						class={piece.colorClass}
						role="presentation"
						onmouseenter={() => onSegmentEnter(piece.key)}
						onmouseleave={() => onSegmentLeave(piece.key)}
					/>
				{:else}
					<path
						d={piece.path}
						fill="none"
						stroke="var(--pj)"
						stroke-width={INNER_STROKE}
						class={piece.colorClass}
						role="presentation"
						onmouseenter={() => onSegmentEnter(piece.key)}
						onmouseleave={() => onSegmentLeave(piece.key)}
					/>
				{/if}
			{/each}

			<!-- 7. Uncovered_Time dashes, last of all -->
			{#each uncoveredPieces as piece (piece.key)}
				{#if piece.kind === 'circle'}
					<circle
						cx={CX}
						cy={CY}
						r={INNER_R}
						fill="none"
						stroke="var(--uncovered-dash)"
						stroke-width={INNER_STROKE}
						stroke-dasharray="3 6"
						stroke-linecap="round"
					/>
				{:else}
					<path
						d={piece.path}
						fill="none"
						stroke="var(--uncovered-dash)"
						stroke-width={INNER_STROKE}
						stroke-dasharray="3 6"
						stroke-linecap="round"
					/>
				{/if}
			{/each}

			<!-- Pointer-only tooltip for the hovered inner arc -->
			{#if hoveredPiece !== null && tooltipAnchor !== null}
				<g class="day-gauge__tooltip">
					<rect
						x={tooltipAnchor.x - tooltipWidth / 2}
						y={tooltipAnchor.y - 12}
						width={tooltipWidth}
						height="24"
						rx="6"
						fill="var(--dialog)"
					/>
					<text
						x={tooltipAnchor.x}
						y={tooltipAnchor.y}
						dy="0.35em"
						class="day-gauge__tooltip-text"
						fill="var(--text)"
						font-size="11"
						text-anchor="middle">{tooltipText}</text
					>
				</g>
			{/if}
		</g>
	</svg>

	<div class="day-gauge__center">
		{@render center?.()}
	</div>
</div>

<style>
	.day-gauge {
		position: relative;
		flex-shrink: 0;
	}
	.day-gauge--desktop {
		width: 340px;
		height: 340px;
	}
	.day-gauge--mobile {
		width: 300px;
		height: 300px;
	}

	.day-gauge__svg {
		display: block;
	}

	.day-gauge__numeral,
	.day-gauge__overtime-label,
	.day-gauge__tooltip-text {
		font-variant-numeric: tabular-nums;
	}

	.day-gauge__tooltip {
		pointer-events: none;
	}

	.day-gauge__center {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
