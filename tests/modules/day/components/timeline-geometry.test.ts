/**
 * Unit tests for `layOutDay` (task 3.2). Pure TypeScript, no DOM — the `components`
 * Vitest project runs this file under jsdom (see `vitest.config.ts`), but nothing here
 * touches `document`/`window`.
 *
 * Fixtures are built with small local helpers (`dt`, `mkSession`, `mkEntry`) against a
 * fixed reference day rather than the real wall clock, per the task's own instruction.
 */
import { describe, expect, it } from 'vitest';
import {
	BLOCK_GAP_PX,
	BLOCK_HEAD_PX,
	BLOCK_TO_BREAK_PX,
	BREAK_MARKER_PX,
	DESCRIPTION_MIN_PX,
	HEAD_GAP_PX,
	MIN_BLOCK_PX,
	layOutDay
} from '../../../../src/modules/day/components/timeline-geometry';
import type { ActivityEntry, ActivitySegment, Interval, WorkSession } from '../../../../src/lib/contracts/models';

// --- Fixture helpers ---------------------------------------------------------------

/** 2026-06-15T00:00:00Z — an arbitrary fixed reference day, never the real wall clock. */
const BASE_DAY_MS = Date.UTC(2026, 5, 15);

/** A UTC instant `dayOffset` days after the reference day, at `hour:minute`. */
function dt(dayOffset: number, hour: number, minute = 0): Date {
	return new Date(BASE_DAY_MS + dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000);
}

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

function mkSession(start: Date, end: Date | null, opts: Partial<WorkSession> = {}): WorkSession {
	return {
		id: nextId('session'),
		startedAt: start,
		endedAt: end,
		stale: false,
		createdAt: start,
		updatedAt: end ?? start,
		...opts
	};
}

/** One Activity_Entry carrying one Activity_Segment per interval given. */
function mkEntry(segments: Interval[], opts: Partial<Omit<ActivityEntry, 'segments'>> = {}): ActivityEntry {
	const id = opts.id ?? nextId('entry');
	const segs: ActivitySegment[] = segments.map((seg) => ({
		id: nextId('segment'),
		entryId: id,
		startedAt: seg.start,
		endedAt: seg.end
	}));
	return {
		id,
		projectId: 'project-1',
		projectName: 'Project',
		colorIndex: 0,
		category: 'paid',
		description: 'work',
		mode: 'explicit',
		requestedStartedAt: segments[0].start,
		requestedEndedAt: segments[segments.length - 1].end,
		requestedDurationMinutes: null,
		orphaned: false,
		createdAt: segments[0].start,
		updatedAt: segments[0].start,
		segments: segs,
		...opts
	};
}

const NOW = dt(0, 20, 0); // a fixed "now" for every case with no open session
const MAX_OPEN_SESSION_HOURS = 12;

// --- 1. One block per session -------------------------------------------------------

describe('one block per session', () => {
	it('returns N blocks for N sessions, in chronological order regardless of input order', () => {
		const sessionA = mkSession(dt(0, 8), dt(0, 9));
		const sessionB = mkSession(dt(0, 10), dt(0, 11));
		const sessionC = mkSession(dt(0, 12), dt(0, 13));
		const entryA = mkEntry([{ start: sessionA.startedAt, end: sessionA.endedAt! }]);
		const entryB = mkEntry([{ start: sessionB.startedAt, end: sessionB.endedAt! }]);
		const entryC = mkEntry([{ start: sessionC.startedAt, end: sessionC.endedAt! }]);

		// Deliberately shuffled input order.
		const layout = layOutDay(
			[sessionC, sessionA, sessionB],
			[entryC, entryA, entryB],
			[],
			1000,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		expect(layout.blocks).toHaveLength(3);
		expect(layout.blocks.map((b) => b.session.id)).toEqual([sessionA.id, sessionB.id, sessionC.id]);
		for (const block of layout.blocks) {
			expect(block.segments).toHaveLength(1);
		}
	});
});

// --- 2. Breaks between blocks --------------------------------------------------------

describe('breaks between blocks', () => {
	it('a gap between two sessions produces exactly one break marker', () => {
		const sessionA = mkSession(dt(0, 8), dt(0, 9));
		const sessionB = mkSession(dt(0, 9, 45), dt(0, 10, 45)); // 45 min gap
		const layout = layOutDay(
			[sessionA, sessionB],
			[],
			[],
			1000,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		expect(layout.breaks).toHaveLength(1);
		expect(layout.breaks[0].after).toBe(0);
		expect(layout.breaks[0].interval).toEqual({ start: sessionA.endedAt, end: sessionB.startedAt });
	});

	it('marks a break of LONG_BREAK_SECONDS (3600s) or more as long', () => {
		const sessionA = mkSession(dt(0, 8), dt(0, 9));
		const sessionB = mkSession(dt(0, 10), dt(0, 11)); // exactly 3600s gap
		const layout = layOutDay(
			[sessionA, sessionB],
			[],
			[],
			1000,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		expect(layout.breaks[0].long).toBe(true);
	});

	it('does not mark a break just under LONG_BREAK_SECONDS as long', () => {
		const sessionA = mkSession(dt(0, 8), dt(0, 9));
		const justUnderAnHour = new Date(sessionA.endedAt!.getTime() + 3599 * 1000);
		const sessionB = mkSession(justUnderAnHour, new Date(justUnderAnHour.getTime() + 3_600_000));
		const layout = layOutDay(
			[sessionA, sessionB],
			[],
			[],
			1000,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		expect(layout.breaks[0].long).toBe(false);
	});
});

// --- 3. Heights proportional within a block ------------------------------------------

describe('heights proportional within a block', () => {
	it('splits two segments of a 2:1 duration ratio into roughly a 2:1 height ratio', () => {
		const session = mkSession(dt(0, 8), dt(0, 9)); // 3600s
		const segA: Interval = { start: dt(0, 8), end: dt(0, 8, 40) }; // 2400s
		const segB: Interval = { start: dt(0, 8, 40), end: dt(0, 9) }; // 1200s
		const entryA = mkEntry([segA]);
		const entryB = mkEntry([segB]);

		// fixed = BLOCK_HEAD_PX.desktop(29) + HEAD_GAP_PX.desktop(8) + BLOCK_GAP_PX(4) = 41
		// availablePx 641 -> flex 600, well above MIN_BLOCK_PX.desktop(36) for both shares,
		// so the floor never engages and this isolates pure proportionality.
		const availablePx = 641;
		const layout = layOutDay(
			[session],
			[entryA, entryB],
			[],
			availablePx,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		const [heightA, heightB] = layout.blocks[0].segments.map((s) => s.heightPx);
		// Quantisation rounds each height down to HEIGHT_STEP_PX (2px) and hands the
		// remainder back to the block's tallest segment, so the ratio can drift by a
		// couple of pixels from the mathematically exact 2:1 — tolerance covers that,
		// not a design defect.
		expect(Math.abs(heightA / heightB - 2)).toBeLessThan(0.05);
	});
});

// --- 4. A twenty-minute segment still gets MIN_BLOCK_PX, at both densities ----------

describe('the floor for a twenty-minute segment', () => {
	function buildFloorCase(density: 'desktop' | 'mobile', availablePx: number) {
		const session = mkSession(dt(0, 8), dt(0, 18, 20)); // 10h20m
		const bigSeg: Interval = { start: dt(0, 8), end: dt(0, 18) }; // 10h — dominates the split
		const smallSeg: Interval = { start: dt(0, 18), end: dt(0, 18, 20) }; // 20min
		const entryBig = mkEntry([bigSeg]);
		const entrySmall = mkEntry([smallSeg]);

		return layOutDay(
			[session],
			[entryBig, entrySmall],
			[],
			availablePx,
			density,
			NOW,
			MAX_OPEN_SESSION_HOURS
		);
	}

	it('raises the 20-minute segment to MIN_BLOCK_PX.desktop when its proportional share would be well under the floor', () => {
		// Proportional share of the 20-minute segment here is ~14.8px against a 36px
		// floor — a genuinely under-floor case, not an edge rounding artefact.
		const layout = buildFloorCase('desktop', 500);
		const smallSegment = layout.blocks[0].segments[1];
		expect(smallSegment.heightPx).toBe(MIN_BLOCK_PX.desktop);
	});

	it('raises the 20-minute segment to MIN_BLOCK_PX.mobile when its proportional share would be well under the floor', () => {
		// Proportional share here is ~11.8px against a 26px floor.
		const layout = buildFloorCase('mobile', 400);
		const smallSegment = layout.blocks[0].segments[1];
		expect(smallSegment.heightPx).toBe(MIN_BLOCK_PX.mobile);
	});
});

// --- 5. showsDescription: true only at 60px+ AND desktop ----------------------------

describe('showsDescription', () => {
	it('is true at exactly 60px on desktop', () => {
		// A single-segment block: its height equals flex exactly (100% of the block's
		// seconds), so availablePx = fixed + 60 makes the segment land on exactly 60px.
		const fixed = BLOCK_HEAD_PX.desktop + HEAD_GAP_PX.desktop; // 1 segment: no BLOCK_GAP_PX
		const session = mkSession(dt(0, 8), dt(0, 9));
		const entry = mkEntry([{ start: session.startedAt, end: session.endedAt! }]);
		const layout = layOutDay(
			[session],
			[entry],
			[],
			fixed + DESCRIPTION_MIN_PX,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		const segment = layout.blocks[0].segments[0];
		expect(segment.heightPx).toBe(DESCRIPTION_MIN_PX);
		expect(segment.showsDescription).toBe(true);
	});

	it('is false at 59px on desktop', () => {
		const fixed = BLOCK_HEAD_PX.desktop + HEAD_GAP_PX.desktop;
		const session = mkSession(dt(0, 8), dt(0, 9));
		const entry = mkEntry([{ start: session.startedAt, end: session.endedAt! }]);
		const layout = layOutDay(
			[session],
			[entry],
			[],
			fixed + (DESCRIPTION_MIN_PX - 1),
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		const segment = layout.blocks[0].segments[0];
		expect(segment.heightPx).toBe(DESCRIPTION_MIN_PX - 1);
		expect(segment.showsDescription).toBe(false);
	});

	it('is false at any height on mobile, including a very tall block', () => {
		const fixed = BLOCK_HEAD_PX.mobile + HEAD_GAP_PX.mobile;
		const session = mkSession(dt(0, 8), dt(0, 9));
		const entry = mkEntry([{ start: session.startedAt, end: session.endedAt! }]);
		const tallHeight = 500; // well above DESCRIPTION_MIN_PX
		const layout = layOutDay(
			[session],
			[entry],
			[],
			fixed + tallHeight,
			'mobile',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		const segment = layout.blocks[0].segments[0];
		expect(segment.heightPx).toBe(tallHeight);
		expect(segment.showsDescription).toBe(false);
	});
});

// --- 6. An uncovered stretch under MIN_UNCOVERED_SECONDS produces no block of its own -

describe('an uncovered stretch under MIN_UNCOVERED_SECONDS', () => {
	const session = mkSession(dt(0, 8), dt(0, 9)); // 3600s
	const segA: Interval = { start: dt(0, 8), end: dt(0, 8, 20) }; // 1200s
	const shortGap: Interval = { start: dt(0, 8, 20), end: dt(0, 8, 22) }; // 120s (< 300s)
	const segB: Interval = { start: dt(0, 8, 22), end: dt(0, 9) }; // 2280s
	const entryA = mkEntry([segA]);
	const entryB = mkEntry([segB]);
	const availablePx = 641;

	it('produces no block of its own for the sub-threshold stretch', () => {
		const layout = layOutDay(
			[session],
			[entryA, entryB],
			[shortGap],
			availablePx,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		// Two segments only — the 120s gap gets no LaidOutSegment of its own.
		expect(layout.blocks[0].segments).toHaveLength(2);
		expect(layout.blocks[0].segments.every((s) => s.segment !== null)).toBe(true);
	});

	it('still counts the gap seconds in the proportional split, so the drawn heights sum to the session', () => {
		const layout = layOutDay(
			[session],
			[entryA, entryB],
			[shortGap],
			availablePx,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		const fixed = BLOCK_HEAD_PX.desktop + HEAD_GAP_PX.desktop + BLOCK_GAP_PX; // 2 rendered segments
		const flex = availablePx - fixed;
		const summedHeights = layout.blocks[0].segments.reduce((sum, s) => sum + s.heightPx, 0);
		// Same quantisation tolerance as the proportionality test above: at most a
		// couple of pixels can move to rounding remainders, never seconds lost outright.
		expect(Math.abs(summedHeights - flex)).toBeLessThanOrEqual(4);
	});
});

// --- 7. A stale open session ends at startedAt + maxOpenSessionHours, not now -------

describe('a stale open session', () => {
	it('caps the effective end at startedAt + maxOpenSessionHours, however long ago it opened, and marks the block capped', () => {
		const start = dt(0, 8, 0);
		const cap = dt(0, 20, 0); // start + 12h (MAX_OPEN_SESSION_HOURS below)
		// "now" is many days after the cap, to prove the layout does not fall back to it.
		const farFutureNow = dt(5, 8, 0);

		const session = mkSession(start, null, { stale: true });
		// A: fully inside the cap. B: starts before the cap but runs past it — only the
		// portion up to the cap should count towards its proportional height.
		const segA: Interval = { start, end: dt(0, 18, 0) }; // 10h = 36000s
		const segB: Interval = { start: dt(0, 18, 0), end: dt(0, 22, 0) }; // 4h requested, clipped to 2h at the cap
		const entryA = mkEntry([segA]);
		const entryB = mkEntry([segB]);

		// fixed = 29 + 8 + 4 = 41; availablePx 641 -> flex 600.
		const layout = layOutDay(
			[session],
			[entryA, entryB],
			[],
			641,
			'desktop',
			farFutureNow,
			12
		);

		const block = layout.blocks[0];
		expect(block.running).toBe(true);
		expect(block.capped).toBe(true);

		// LaidOutSegment.segment keeps the entry's ORIGINAL (unclipped) timestamps — the
		// cap is only visible indirectly, through the proportional heights: if the
		// implementation used `now` instead of the cap for a stale session, B's clipped
		// share would be ~4h instead of ~2h and the ratio below would be far from 5:1.
		const [heightA, heightB] = block.segments.map((s) => s.heightPx);
		// A:B clipped-seconds ratio is 36000:7200 = 5:1.
		expect(Math.abs(heightA / heightB - 5)).toBeLessThan(0.1);
		void cap; // documents the expected cap instant used in the comment above
	});
});

// --- 7b. `continues` against a real (non-UTC-midnight) Logical_Day boundary --------

describe('continues, against an explicit dayBounds', () => {
	// DAY_START_HOUR=3 in production, so a Logical_Day's real boundary is never UTC
	// midnight — .agents/ISSUES.md, "timeline-geometry.ts's `continues` flag uses a
	// UTC-midnight approximation". `dayBounds` here mirrors what `dayResolver.bounds(date)`
	// would return for a day starting at 03:00: [dt(0,3), dt(1,3)).
	const dayBounds: Interval = { start: dt(0, 3, 0), end: dt(1, 3, 0) };

	it('is false for an open session on the still-current day, even though it started before UTC midnight of "now"', () => {
		// Started the previous UTC calendar date (dt(-1, 22) = 22:00 the day before the
		// reference day), but that is still WITHIN the Logical_Day [dt(0,3), dt(1,3))
		// this dayBounds describes, and "now" has not reached the day's own end yet — the
		// UTC-midnight approximation would have flagged this session `continues: true`
		// (different UTC calendar date), which is wrong for a 03:00 day start.
		const session = mkSession(dt(-1, 22, 0), null);
		const entry = mkEntry([{ start: session.startedAt, end: dt(0, 4, 0) }]);
		const now = dt(0, 6, 0); // well inside [dt(0,3), dt(1,3))

		const layout = layOutDay(
			[session],
			[entry],
			[],
			1000,
			'desktop',
			now,
			MAX_OPEN_SESSION_HOURS,
			dayBounds
		);

		expect(layout.blocks[0].running).toBe(true);
		expect(layout.blocks[0].continues).toBe(false);
	});

	it('is true once "now" has passed the real boundary end, viewing a past day the session has run past', () => {
		const session = mkSession(dt(-1, 22, 0), null);
		const entry = mkEntry([{ start: session.startedAt, end: dt(0, 4, 0) }]);
		const now = dt(2, 6, 0); // well past dayBounds.end (dt(1, 3, 0))

		const layout = layOutDay(
			[session],
			[entry],
			[],
			1000,
			'desktop',
			now,
			MAX_OPEN_SESSION_HOURS,
			dayBounds
		);

		expect(layout.blocks[0].running).toBe(true);
		expect(layout.blocks[0].continues).toBe(true);
	});

	it('falls back to the UTC-calendar-date approximation when dayBounds is omitted', () => {
		const session = mkSession(dt(-1, 22, 0), null);
		const entry = mkEntry([{ start: session.startedAt, end: dt(0, 4, 0) }]);
		const now = dt(0, 6, 0); // different UTC calendar date from the session's start

		const layout = layOutDay([session], [entry], [], 1000, 'desktop', now, MAX_OPEN_SESSION_HOURS);

		expect(layout.blocks[0].continues).toBe(true);
	});
});

// --- 8. 08:00–03:00 day with a four-hour evening break fits the available height ---

describe('a day of 08:00–03:00 with a four-hour evening break', () => {
	it('lays out without exceeding the available height', () => {
		const sessionA = mkSession(dt(0, 8), dt(0, 18)); // 10h
		const sessionB = mkSession(dt(0, 22), dt(1, 3)); // 5h, crossing midnight
		const entryA = mkEntry([{ start: sessionA.startedAt, end: sessionA.endedAt! }]);
		const entryB = mkEntry([{ start: sessionB.startedAt, end: sessionB.endedAt! }]);

		// design.md's own worked number: 900 (viewport) - 84 (shell) - 56 (heading) - 48
		// (padding) = 712, which is exactly Property 2's premise for this shape (two
		// single-segment blocks, one long break) — see the algorithm section.
		const availablePx = 712;
		const layout = layOutDay(
			[sessionA, sessionB],
			[entryA, entryB],
			[],
			availablePx,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		expect(layout.breaks).toHaveLength(1);
		expect(layout.breaks[0].long).toBe(true); // the 4h evening break

		const totalHeight =
			layout.blocks.reduce(
				(sum, b) => sum + b.heightPx + BLOCK_HEAD_PX.desktop + HEAD_GAP_PX.desktop,
				0
			) +
			layout.breaks.reduce(
				(sum, brk) =>
					sum + BREAK_MARKER_PX[brk.long ? 'long' : 'short'] + 2 * BLOCK_TO_BREAK_PX.desktop,
				0
			);

		expect(totalHeight).toBeLessThanOrEqual(availablePx);
	});
});

// --- 9. The three extremes from design.md's table -----------------------------------

describe('the three extremes', () => {
	it('fifty short entries: every segment is pinned at the floor, and the total legitimately exceeds a small budget', () => {
		const session = mkSession(dt(0, 8), dt(0, 8, 50)); // 50 minutes
		const entries: ActivityEntry[] = [];
		for (let i = 0; i < 50; i++) {
			const start = dt(0, 8, i);
			const end = dt(0, 8, i + 1);
			entries.push(mkEntry([{ start, end }]));
		}

		// Tiny budget: nowhere near enough even for 50 segments at the floor.
		const availablePx = 200;
		const layout = layOutDay([session], entries, [], availablePx, 'desktop', NOW, MAX_OPEN_SESSION_HOURS);

		const segments = layout.blocks[0].segments;
		expect(segments).toHaveLength(50);
		for (const s of segments) {
			expect(s.heightPx).toBe(MIN_BLOCK_PX.desktop);
		}

		// The floor outranks the budget: layOutDay returns the larger total rather than
		// clamping or throwing.
		const totalHeight =
			layout.blocks[0].heightPx + BLOCK_HEAD_PX.desktop + HEAD_GAP_PX.desktop;
		expect(totalHeight).toBeGreaterThan(availablePx);
	});

	it('one entry spanning the whole day takes (approximately) all of flex', () => {
		const session = mkSession(dt(0, 0), dt(0, 24)); // the whole day
		const entry = mkEntry([{ start: session.startedAt, end: session.endedAt! }]);

		const availablePx = 900;
		const fixed = BLOCK_HEAD_PX.desktop + HEAD_GAP_PX.desktop; // one segment, no inter-gap
		const flex = availablePx - fixed;

		const layout = layOutDay([session], [entry], [], availablePx, 'desktop', NOW, MAX_OPEN_SESSION_HOURS);

		const segment = layout.blocks[0].segments[0];
		expect(segment.heightPx).toBe(flex);
	});

	it('one session, one break, one session: two blocks, one break marker, flex split by worked seconds', () => {
		const sessionA = mkSession(dt(0, 8), dt(0, 10)); // 2h = 7200s
		const sessionB = mkSession(dt(0, 10, 30), dt(0, 11, 30)); // 1h = 3600s, 30-min gap
		const entryA = mkEntry([{ start: sessionA.startedAt, end: sessionA.endedAt! }]);
		const entryB = mkEntry([{ start: sessionB.startedAt, end: sessionB.endedAt! }]);

		const availablePx = 634;
		const layout = layOutDay(
			[sessionA, sessionB],
			[entryA, entryB],
			[],
			availablePx,
			'desktop',
			NOW,
			MAX_OPEN_SESSION_HOURS
		);

		expect(layout.blocks).toHaveLength(2);
		expect(layout.breaks).toHaveLength(1);
		expect(layout.breaks[0].long).toBe(false);

		const heightA = layout.blocks[0].segments[0].heightPx;
		const heightB = layout.blocks[1].segments[0].heightPx;
		// Worked-seconds ratio is 7200:3600 = 2:1; a couple of quantisation pixels are
		// the same tolerance as the proportionality test above.
		expect(Math.abs(heightA / heightB - 2)).toBeLessThan(0.05);
	});
});
