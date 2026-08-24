/**
 * Pure day-layout geometry — no DOM access, no SvelteKit imports. `layOutDay` turns a
 * day's `Work_Session`s, `Activity_Entry`s (each carrying its own `Activity_Segment`s)
 * and `Uncovered_Time` stretches into pixel heights the component can render as CSS
 * classes, following the five-step algorithm in `002-worklog-ui`'s design ("2. Timeline
 * Geometry"). That algorithm is normative — the artboards illustrate its output, they
 * do not define it — and `layOutDay` does every bit of rounding itself; the component
 * only reads `heightPx` and picks a class (`tl-h-<n>` or `tl-h-fill`).
 *
 * A `Work_Block` gets its own local time axis (Requirement 4.2): proportions hold
 * *within* a block, never across a break, which is exactly why the proportional split
 * below runs against the whole day's segment-seconds in one pass rather than per block
 * — `flex × seconds / totalSeconds` is the same fraction whether it is computed in one
 * step over the whole day or in two steps (a block's own share of `flex`, then a
 * segment's share of the block), because the block terms cancel algebraically. Doing it
 * in one pass avoids carrying an intermediate per-block flex value around.
 */
import type { ActivityEntry, ActivitySegment, Interval, WorkSession } from '$lib/contracts/models';

export const MIN_BLOCK_PX = { desktop: 36, mobile: 26 } as const;
/** Below this a block shows name and times only. Desktop only — mobile never shows one. */
export const DESCRIPTION_MIN_PX = 60;
export const BLOCK_GAP_PX = 4; // between two segments of one block
export const HEAD_GAP_PX = { desktop: 8, mobile: 6 } as const; // head to segment column
export const BLOCK_TO_BREAK_PX = { desktop: 11, mobile: 9 } as const; // block to Break_Marker
export const BLOCK_HEAD_PX = { desktop: 29, mobile: 24 } as const;
export const BLOCK_HEAD_PAD_PX = { desktop: 11, mobile: 7 } as const; // head line box -> segment column
export const BREAK_MARKER_PX = { short: 38, long: 42 } as const;
export const LONG_BREAK_SECONDS = 3600;
export const MIN_UNCOVERED_SECONDS = 300;
/** The ladder step every rendered height is snapped to. */
export const HEIGHT_STEP_PX = 2;

/** A block column taller than this takes `.tl-h-fill` instead of a ladder class. */
const FILL_THRESHOLD_PX = 320;

export type Density = 'desktop' | 'mobile';

/** One layout group per Work_Session, with the breaks between them collapsed. */
export type DayLayout = {
	blocks: {
		session: WorkSession;
		segments: LaidOutSegment[];
		/** Sum of the segment heights plus the gaps between them. */
		heightPx: number;
		/** True when the session is open and still counting. */
		running: boolean;
		/** True when the session is open but past MAX_OPEN_SESSION_HOURS — Requirement 4.9. */
		capped: boolean;
		/** True when the session continues past the displayed Logical_Day — Requirement 4.17. */
		continues: boolean;
	}[];
	breaks: { after: number; interval: Interval; long: boolean }[]; // index of the block it follows
};

export type LaidOutSegment = {
	segment: ActivitySegment | null; // null for an Uncovered_Time stretch
	entry: ActivityEntry | null;
	/** Quantised to HEIGHT_STEP_PX, never below MIN_BLOCK_PX for the density. */
	heightPx: number;
	/** True when heightPx >= DESCRIPTION_MIN_PX and the density is desktop. */
	showsDescription: boolean;
	partIndex: number | null; // "part 2 of 3" when the entry was split
	partCount: number | null;
	/**
	 * Extension beyond the `LaidOutSegment` shape design.md's code block shows literally
	 * (that block has no field for it at all). design.md's "Applying Tokens" section (the
	 * `.tl-h-fill` paragraph) requires *some* signal from `layOutDay` naming the one
	 * segment per block column taller than 320px, so the component can give it
	 * `.tl-h-fill` (`flex: 1 1 auto`) instead of a fixed `.tl-h-<n>` ladder class — there
	 * is no ladder class above 320. True for at most one segment per block: its tallest.
	 */
	fillsColumn: boolean;
};

type RawUnit = {
	blockIndex: number;
	startMs: number;
	endMs: number;
	seconds: number;
	kind: 'segment' | 'uncovered';
	segment: ActivitySegment | null;
	entry: ActivityEntry | null;
};

/** Half-open interval intersection; null when they do not overlap at all. */
function intersect(aStart: number, aEnd: number, bStart: number, bEnd: number): [number, number] | null {
	const start = Math.max(aStart, bStart);
	const end = Math.min(aEnd, bEnd);
	return end > start ? [start, end] : null;
}

export function layOutDay(
	sessions: WorkSession[],
	entries: ActivityEntry[],
	uncovered: Interval[],
	availablePx: number,
	density: Density,
	now: Date,
	maxOpenSessionHours: number
): DayLayout {
	if (sessions.length === 0) {
		return { blocks: [], breaks: [] };
	}

	const orderedSessions = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

	// --- Per-session bounds, and the three display flags that depend only on the session. ---
	const bounds = orderedSessions.map((session) => {
		const startMs = session.startedAt.getTime();
		let endMs: number;
		let running: boolean;
		let capped: boolean;
		if (session.endedAt !== null) {
			endMs = session.endedAt.getTime();
			running = false;
			capped = false;
		} else {
			running = true;
			capped = session.stale;
			endMs = capped ? startMs + maxOpenSessionHours * 3_600_000 : now.getTime();
		}

		// `continues` (Requirement 4.17) means the session runs past the displayed
		// Logical_Day. `layOutDay` is given no day boundary (no DAY_START_HOUR, no time
		// zone) and no explicit "which day is this" marker — the function only ever sees
		// the sessions, entries and uncovered stretches a caller already scoped to one
		// day, plus `now`. `capped` excludes `continues` by design (a session that
		// stopped counting inside the day it started in does not reach the next one), so
		// only an open, non-stale session can qualify. For that remaining case the best
		// signal available here is a UTC calendar-date comparison between the session's
		// start and `now`: a running session whose start and "now" fall on the same UTC
		// calendar date is being drawn on its own still-current day (not continuing past
		// it); one that started on an earlier UTC date and is still open — "a timer
		// started yesterday evening and still going", design.md's own example — is being
		// viewed on a past day it has run past. This is an approximation of the real
		// Logical_Day boundary (which uses DAY_START_HOUR and a configured time zone, not
		// UTC midnight) and should be reconciled once the day-page load function (a later
		// task) is written and can pass the real boundary instead.
		const sameUtcCalendarDate =
			session.startedAt.getUTCFullYear() === now.getUTCFullYear() &&
			session.startedAt.getUTCMonth() === now.getUTCMonth() &&
			session.startedAt.getUTCDate() === now.getUTCDate();
		const continues = running && !capped && !sameUtcCalendarDate;

		return { startMs, endMs, running, capped, continues };
	});

	// --- Assign every Activity_Segment to its owning session (they never overlap). ---
	const rawSegments: { segment: ActivitySegment; entry: ActivityEntry }[] = [];
	for (const entry of entries) {
		for (const segment of entry.segments) {
			rawSegments.push({ segment, entry });
		}
	}
	rawSegments.sort((a, b) => a.segment.startedAt.getTime() - b.segment.startedAt.getTime());

	function ownerBlockIndex(segStartMs: number): number {
		// The session with the latest startedAt at or before the segment's own start —
		// segments are clipped server-side to the session they overlap, so this is
		// unambiguous as long as sessions themselves never overlap.
		let owner = 0;
		for (let i = 0; i < orderedSessions.length; i++) {
			if (orderedSessions[i].startedAt.getTime() <= segStartMs) owner = i;
			else break;
		}
		return owner;
	}

	const unitsByBlock: RawUnit[][] = orderedSessions.map(() => []);

	for (const { segment, entry } of rawSegments) {
		const blockIndex = ownerBlockIndex(segment.startedAt.getTime());
		const { startMs, endMs } = bounds[blockIndex];
		const clipped = intersect(segment.startedAt.getTime(), segment.endedAt.getTime(), startMs, endMs);
		if (!clipped) continue; // entirely past a capped session's cut-off — not drawn
		const [start, end] = clipped;
		unitsByBlock[blockIndex].push({
			blockIndex,
			startMs: start,
			endMs: end,
			seconds: (end - start) / 1000,
			kind: 'segment',
			segment,
			entry
		});
	}

	for (const interval of uncovered) {
		const blockIndex = ownerBlockIndex(interval.start.getTime());
		const { startMs, endMs } = bounds[blockIndex];
		const clipped = intersect(interval.start.getTime(), interval.end.getTime(), startMs, endMs);
		if (!clipped) continue;
		const [start, end] = clipped;
		unitsByBlock[blockIndex].push({
			blockIndex,
			startMs: start,
			endMs: end,
			seconds: (end - start) / 1000,
			kind: 'uncovered',
			segment: null,
			entry: null
		});
	}

	for (const units of unitsByBlock) units.sort((a, b) => a.startMs - b.startMs);

	// --- Breaks: the gap between one (always closed) session and the next. ---
	const breaks: DayLayout['breaks'] = [];
	for (let i = 0; i < orderedSessions.length - 1; i++) {
		const prevEnd = bounds[i].endMs;
		const nextStart = orderedSessions[i + 1].startedAt.getTime();
		if (nextStart <= prevEnd) continue; // no gap, or sessions touch — no marker
		const seconds = (nextStart - prevEnd) / 1000;
		breaks.push({
			after: i,
			interval: { start: new Date(prevEnd), end: new Date(nextStart) },
			long: seconds >= LONG_BREAK_SECONDS
		});
	}

	// --- Step 1: reserve the fixed rows. ---
	const headPx = BLOCK_HEAD_PX[density];
	const headGapPx = HEAD_GAP_PX[density];
	const blockToBreakPx = BLOCK_TO_BREAK_PX[density];
	const floorPx = MIN_BLOCK_PX[density];

	// Rendered units are every segment plus every uncovered stretch at or above
	// MIN_UNCOVERED_SECONDS; a shorter uncovered stretch draws no block of its own
	// (Requirement 4.25) but its seconds still count towards the day's total below.
	const renderableByBlock: RawUnit[][] = unitsByBlock.map((units) =>
		units.filter((u) => u.kind === 'segment' || u.seconds >= MIN_UNCOVERED_SECONDS)
	);

	let fixed = 0;
	for (const renderable of renderableByBlock) {
		fixed += headPx + headGapPx;
		if (renderable.length > 1) fixed += (renderable.length - 1) * BLOCK_GAP_PX;
	}
	for (const brk of breaks) {
		fixed += BREAK_MARKER_PX[brk.long ? 'long' : 'short'] + 2 * blockToBreakPx;
	}
	const flex = availablePx - fixed;

	// --- Step 2: distribute proportionally, absorbing sub-threshold uncovered stretches
	// into the segment that follows them within the same block. ---
	let totalSeconds = 0;
	for (const units of unitsByBlock) for (const u of units) totalSeconds += u.seconds;

	type Sizeable = RawUnit & { height: number; pinned: boolean };
	const sizeableByBlock: Sizeable[][] = unitsByBlock.map(() => []);

	for (let blockIndex = 0; blockIndex < unitsByBlock.length; blockIndex++) {
		const units = unitsByBlock[blockIndex];
		let pendingSeconds = 0;
		const rendered: Sizeable[] = [];
		for (const u of units) {
			const isRendered = u.kind === 'segment' || u.seconds >= MIN_UNCOVERED_SECONDS;
			if (!isRendered) {
				pendingSeconds += u.seconds;
				continue;
			}
			const seconds = u.seconds + pendingSeconds;
			pendingSeconds = 0;
			const height = totalSeconds > 0 ? flex * (seconds / totalSeconds) : 0;
			rendered.push({ ...u, height, pinned: false });
		}
		if (pendingSeconds > 0) {
			// The whole block was sub-threshold uncovered stretches with nothing to
			// absorb into — pathological (a session under MIN_UNCOVERED_SECONDS long
			// with no logged activity at all). Fall back to the block's last rendered
			// unit so the seconds are not silently lost from the drawn total; if the
			// block rendered nothing at all, there is nowhere to put it and the block
			// simply draws no segments.
			if (rendered.length > 0) {
				const extraHeight = totalSeconds > 0 ? flex * (pendingSeconds / totalSeconds) : 0;
				rendered[rendered.length - 1].height += extraHeight;
			}
		}
		sizeableByBlock[blockIndex] = rendered;
	}

	const allSizeable = sizeableByBlock.flat();

	// --- Step 3: lift below-floor segments to the floor, repaying the deficit from the
	// unpinned segments in descending height, one HEIGHT_STEP_PX at a time, before any
	// quantisation happens. ---
	let deficit = 0;
	for (const s of allSizeable) {
		if (s.height < floorPx) {
			deficit += floorPx - s.height;
			s.height = floorPx;
			s.pinned = true;
		}
	}

	while (deficit > 0) {
		let tallest: Sizeable | null = null;
		for (const s of allSizeable) {
			if (s.pinned) continue;
			if (tallest === null || s.height > tallest.height) tallest = s;
		}
		if (tallest === null) break; // every segment pinned — the floor outranks the budget

		const room = tallest.height - floorPx;
		const take = Math.min(HEIGHT_STEP_PX, deficit, room);
		if (take <= 0) {
			// No room left to give without going under the floor — pin it and move on.
			tallest.pinned = true;
			continue;
		}
		tallest.height -= take;
		deficit -= take;
		if (tallest.height <= floorPx) {
			tallest.height = floorPx;
			tallest.pinned = true;
		}
	}

	// --- Step 4: quantise down to HEIGHT_STEP_PX, giving each block's rounding
	// remainder back to that block's own tallest segment so its total stays exact. ---
	for (const rendered of sizeableByBlock) {
		let remainder = 0;
		let tallestIndex = -1;
		let tallestFlooredHeight = -1;
		for (let i = 0; i < rendered.length; i++) {
			const s = rendered[i];
			const floored = Math.floor(s.height / HEIGHT_STEP_PX) * HEIGHT_STEP_PX;
			remainder += s.height - floored;
			s.height = floored;
			if (floored > tallestFlooredHeight) {
				tallestFlooredHeight = floored;
				tallestIndex = i;
			}
		}
		if (tallestIndex >= 0 && remainder > 0) {
			// The remainder is itself a fraction of a pixel-ladder step; round it to the
			// nearest whole pixel so the block's total lands back on an integer.
			rendered[tallestIndex].height += Math.round(remainder);
		}
	}

	// --- Assemble LaidOutSegments, part markers, description visibility and the
	// fill-column mark. ---
	function partInfo(entry: ActivityEntry, segment: ActivitySegment): { index: number | null; count: number | null } {
		if (entry.segments.length <= 1) return { index: null, count: null };
		const sorted = [...entry.segments].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
		const index = sorted.findIndex((s) => s.id === segment.id);
		return { index: index >= 0 ? index + 1 : null, count: entry.segments.length };
	}

	const blocks: DayLayout['blocks'] = orderedSessions.map((session, blockIndex) => {
		const rendered = sizeableByBlock[blockIndex];

		let fillIndex = -1;
		let fillHeight = FILL_THRESHOLD_PX;
		for (let i = 0; i < rendered.length; i++) {
			if (rendered[i].height > fillHeight) {
				fillHeight = rendered[i].height;
				fillIndex = i;
			}
		}

		const segments: LaidOutSegment[] = rendered.map((s, i) => {
			const showsDescription = density === 'desktop' && s.height >= DESCRIPTION_MIN_PX;
			const { index, count } = s.entry && s.segment ? partInfo(s.entry, s.segment) : { index: null, count: null };
			return {
				segment: s.segment,
				entry: s.entry,
				heightPx: s.height,
				showsDescription,
				partIndex: index,
				partCount: count,
				fillsColumn: i === fillIndex
			};
		});

		const heightPx =
			segments.reduce((sum, s) => sum + s.heightPx, 0) +
			(segments.length > 1 ? (segments.length - 1) * BLOCK_GAP_PX : 0);

		const b = bounds[blockIndex];
		return {
			session,
			segments,
			heightPx,
			running: b.running,
			capped: b.capped,
			continues: b.continues
		};
	});

	return { blocks, breaks };
}
