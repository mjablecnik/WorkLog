import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	layOutDay,
	MIN_BLOCK_PX,
	BLOCK_HEAD_PX,
	HEAD_GAP_PX,
	BLOCK_GAP_PX,
	BREAK_MARKER_PX,
	BLOCK_TO_BREAK_PX,
	LONG_BREAK_SECONDS,
	type Density
} from '../../../../src/modules/day/components/timeline-geometry';
import type { ActivityEntry, ActivitySegment, WorkSession } from '../../../../src/lib/contracts/models';

const BASE = new Date('2026-01-01T08:00:00Z').getTime();
// Every session in every generated day is closed (see buildDay), so `now` only has to
// sit safely after the last generated instant — running/capped semantics are a
// separate concern already covered by the unit tests (task 3.2).
const NOW = new Date(BASE + 365 * 24 * 3_600_000);
const MAX_OPEN_SESSION_HOURS = 12;

/**
 * One Activity_Segment inside a session: its own duration (a few seconds up to four
 * hours, to exercise both the proportional split and the floor-lifting logic) and the
 * gap before the next segment of the *same* session. That gap is silent dead time we
 * simply never mention to `layOutDay` (no Uncovered_Time interval is generated for
 * it) — the algorithm only knows about the units it is given, so an unmentioned gap
 * changes nothing about segmentCount/blockCount/breakCount or the geometry. The gap
 * after a session's last segment is unused; the session ends exactly where its last
 * segment does.
 */
const segmentShapeArb = fc.record({
	durationSec: fc.integer({ min: 3, max: 4 * 3600 }),
	gapAfterSec: fc.integer({ min: 0, max: 900 })
});

/**
 * One Work_Session: its own segments (1 to 6 — Activity_Segments only, see the note on
 * `dayShapeArb`), plus the break before it. `breakBeforeSec` is unused for the first
 * session, which simply starts the day at `BASE`.
 */
const sessionShapeArb = fc.record({
	segments: fc.array(segmentShapeArb, { minLength: 1, maxLength: 6 }),
	breakBeforeSec: fc.integer({ min: 60, max: 4 * 3600 })
});

/**
 * A whole day's shape: 1 to 8 sessions, sequential with real gaps between them.
 *
 * Scoping choice: this generator produces **only real Activity_Segments**, never a
 * synthetic sub-`MIN_UNCOVERED_SECONDS` Uncovered_Time stretch. Design.md's own
 * warning — "the premise has to name every term" — means the premise computed below
 * must match exactly what the generator hands `layOutDay`. A real segment always
 * receives its own `LaidOutSegment` regardless of how short it is, so segmentCount
 * and blockCount computed straight from the generated shape are exactly what
 * `layOutDay` will render; a generated Uncovered_Time stretch would reintroduce the
 * "does this stretch clear MIN_UNCOVERED_SECONDS" branch and the premise would have
 * to track it too. Keeping the generator to real segments only avoids that entirely
 * while still exercising the floor (durationSec goes down to 3 seconds) and the
 * proportional split (durationSec goes up to 4 hours).
 */
const dayShapeArb = fc.array(sessionShapeArb, { minLength: 1, maxLength: 8 });

type SegmentShape = { durationSec: number; gapAfterSec: number };
type SessionShape = { segments: SegmentShape[]; breakBeforeSec: number };

type BuiltDay = {
	sessions: WorkSession[];
	entries: ActivityEntry[];
	segmentCount: number;
	blockCount: number;
	/** One entry per break, true when that break is a Long_Break. */
	breakLongFlags: boolean[];
};

/** Turns a generated day shape into real WorkSession/ActivityEntry/ActivitySegment
 *  records, one unsplit entry per segment, laid out sequentially from BASE. */
function buildDay(shapes: SessionShape[]): BuiltDay {
	const sessions: WorkSession[] = [];
	const entries: ActivityEntry[] = [];
	const breakLongFlags: boolean[] = [];
	let segmentCount = 0;
	let segmentSeq = 0;
	let cursor = BASE;

	shapes.forEach((shape, sessionIndex) => {
		if (sessionIndex > 0) {
			const breakMs = shape.breakBeforeSec * 1000;
			breakLongFlags.push(shape.breakBeforeSec >= LONG_BREAK_SECONDS);
			cursor += breakMs;
		}

		const sessionStart = cursor;
		let segCursor = cursor;

		shape.segments.forEach((seg, segIndex) => {
			const segStart = segCursor;
			const segEnd = segStart + seg.durationSec * 1000;
			const segmentId = `segment-${segmentSeq}`;
			const entryId = `entry-${segmentSeq}`;

			const segment: ActivitySegment = {
				id: segmentId,
				entryId,
				startedAt: new Date(segStart),
				endedAt: new Date(segEnd)
			};

			entries.push({
				id: entryId,
				projectId: 'project-0',
				projectName: 'Property test project',
				colorIndex: 0,
				category: 'paid',
				description: '',
				mode: 'explicit',
				requestedStartedAt: new Date(segStart),
				requestedEndedAt: new Date(segEnd),
				requestedDurationMinutes: null,
				orphaned: false,
				createdAt: new Date(segStart),
				updatedAt: new Date(segStart),
				segments: [segment]
			});

			segmentCount++;
			segmentSeq++;

			const isLast = segIndex === shape.segments.length - 1;
			segCursor = segEnd + (isLast ? 0 : seg.gapAfterSec * 1000);
		});

		const sessionEnd = segCursor;
		sessions.push({
			id: `session-${sessionIndex}`,
			startedAt: new Date(sessionStart),
			endedAt: new Date(sessionEnd), // always closed — running/capped is a separate concern
			stale: false,
			createdAt: new Date(sessionStart),
			updatedAt: new Date(sessionEnd)
		});

		cursor = sessionEnd;
	});

	return { sessions, entries, segmentCount, blockCount: sessions.length, breakLongFlags };
}

/**
 * Property 2's premise, computed from the built day's own actual segmentCount,
 * blockCount and breakCount — never a fixed constant — exactly as design.md states
 * it:
 *
 *   MIN_BLOCK_PX × segmentCount
 * + BLOCK_HEAD_PX      × blockCount
 * + HEAD_GAP_PX        × blockCount
 * + BLOCK_GAP_PX       × (segmentCount − blockCount)
 * + BREAK_MARKER_PX    × breakCount
 * + BLOCK_TO_BREAK_PX  × 2 × breakCount
 *
 * BREAK_MARKER_PX is itself density-independent but short/long-dependent
 * ({ short, long }), so the per-break term is summed using each generated break's own
 * actual long/short flag rather than a single constant — a tighter and more exact
 * lower bound than picking one of the two values for every break, and it matches
 * exactly what `layOutDay`'s own `fixed` accumulator does internally.
 */
function computePremise(built: BuiltDay, density: Density): number {
	const { segmentCount, blockCount, breakLongFlags } = built;
	const breakCount = breakLongFlags.length;
	const breaksFixedPx = breakLongFlags.reduce(
		(sum, long) => sum + BREAK_MARKER_PX[long ? 'long' : 'short'],
		0
	);

	return (
		MIN_BLOCK_PX[density] * segmentCount +
		BLOCK_HEAD_PX[density] * blockCount +
		HEAD_GAP_PX[density] * blockCount +
		BLOCK_GAP_PX * (segmentCount - blockCount) +
		breaksFixedPx +
		BLOCK_TO_BREAK_PX[density] * 2 * breakCount
	);
}

/**
 * The full generated case: a day shape, a density, and an `availablePx` picked as the
 * premise computed from that exact shape/density pair plus a random non-negative
 * slack — never a fixed `availablePx` independent of the generated shape.
 */
const caseArb = fc
	.tuple(dayShapeArb, fc.constantFrom<Density>('desktop', 'mobile'))
	.chain(([day, density]) => {
		const premise = computePremise(buildDay(day), density);
		return fc
			.integer({ min: premise, max: premise + 5000 })
			.map((availablePx) => ({ day, density, availablePx }));
	});

describe('Feature: worklog-ui, Property 2: Layout budget and clickable floor', () => {
	it('fits every head, gap, marker and segment inside availablePx, and never renders a segment under the floor', () => {
		fc.assert(
			fc.property(caseArb, ({ day, density, availablePx }) => {
				const built = buildDay(day);

				const layout = layOutDay(
					built.sessions,
					built.entries,
					[], // no Uncovered_Time — see the scoping note on dayShapeArb
					availablePx,
					density,
					NOW,
					MAX_OPEN_SESSION_HOURS
				);

				// Invariant 2: every rendered segment clears the floor for this density.
				for (const block of layout.blocks) {
					for (const segment of block.segments) {
						expect(segment.heightPx).toBeGreaterThanOrEqual(MIN_BLOCK_PX[density]);
					}
				}

				// Invariant 1: every head, head-gap, inter-segment gap, break marker and
				// break gap, plus every segment height, sums to at most availablePx.
				let total = 0;
				for (const block of layout.blocks) {
					total += BLOCK_HEAD_PX[density] + HEAD_GAP_PX[density];
					for (const segment of block.segments) total += segment.heightPx;
					if (block.segments.length > 1) {
						total += (block.segments.length - 1) * BLOCK_GAP_PX;
					}
				}
				for (const brk of layout.breaks) {
					total += BREAK_MARKER_PX[brk.long ? 'long' : 'short'] + 2 * BLOCK_TO_BREAK_PX[density];
				}

				expect(total).toBeLessThanOrEqual(availablePx);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 7 (003-worklog-time-categories): the timeline height budget still holds with Leisure_Block units present', () => {
	/** One Leisure_Entry segment: its own duration and the gap before the next one —
	 *  mirrors segmentShapeArb, generated well outside any Work_Session so it is never
	 *  clipped or absorbed into a block. */
	const leisureShapeArb = fc.record({
		durationSec: fc.integer({ min: 3, max: 4 * 3600 }),
		gapAfterSec: fc.integer({ min: 60, max: 900 })
	});
	const leisureDayArb = fc.array(leisureShapeArb, { minLength: 0, maxLength: 5 });

	function buildLeisure(shapes: { durationSec: number; gapAfterSec: number }[], startMs: number): ActivityEntry[] {
		let cursor = startMs;
		const entries: ActivityEntry[] = [];
		shapes.forEach((shape, i) => {
			const start = cursor;
			const end = start + shape.durationSec * 1000;
			entries.push({
				id: `leisure-entry-${i}`,
				projectId: null,
				projectName: null,
				colorIndex: null,
				category: 'relax',
				description: '',
				mode: 'explicit',
				requestedStartedAt: new Date(start),
				requestedEndedAt: new Date(end),
				requestedDurationMinutes: null,
				orphaned: false,
				createdAt: new Date(start),
				updatedAt: new Date(start),
				segments: [{ id: `leisure-segment-${i}`, entryId: `leisure-entry-${i}`, startedAt: new Date(start), endedAt: new Date(end) }]
			});
			cursor = end + shape.gapAfterSec * 1000;
		});
		return entries;
	}

	const leisureCaseArb = fc
		.tuple(dayShapeArb, leisureDayArb, fc.constantFrom<Density>('desktop', 'mobile'))
		.chain(([day, leisure, density]) => {
			const built = buildDay(day);
			const blockPremise = computePremise(built, density);
			const leisureCount = leisure.length;
			const leisurePremise =
				MIN_BLOCK_PX[density] * leisureCount + BLOCK_GAP_PX * Math.max(0, leisureCount - 1);
			const premise = blockPremise + leisurePremise;
			return fc
				.integer({ min: premise, max: premise + 5000 })
				.map((availablePx) => ({ day, leisure, density, availablePx }));
		});

	it('fits every Leisure_Block, alongside every Work_Block, inside availablePx, and never floors one under MIN_BLOCK_PX', () => {
		fc.assert(
			fc.property(leisureCaseArb, ({ day, leisure, density, availablePx }) => {
				const built = buildDay(day);
				// Placed a full day after the last built Work_Session instant, so it never
				// overlaps or gets clipped by any session bound.
				const lastInstant =
					built.sessions.length > 0
						? Math.max(...built.sessions.map((s) => (s.endedAt as Date).getTime()))
						: BASE;
				const leisureEntries = buildLeisure(leisure, lastInstant + 24 * 3600_000);
				const entries = [...built.entries, ...leisureEntries];

				const layout = layOutDay(
					built.sessions,
					entries,
					[],
					availablePx,
					density,
					NOW,
					MAX_OPEN_SESSION_HOURS
				);

				expect(layout.leisureBlocks.length).toBe(leisureEntries.length);
				for (const unit of layout.leisureBlocks) {
					expect(unit.heightPx).toBeGreaterThanOrEqual(MIN_BLOCK_PX[density]);
				}

				let total = 0;
				for (const block of layout.blocks) {
					total += BLOCK_HEAD_PX[density] + HEAD_GAP_PX[density];
					for (const segment of block.segments) total += segment.heightPx;
					if (block.segments.length > 1) total += (block.segments.length - 1) * BLOCK_GAP_PX;
				}
				for (const brk of layout.breaks) {
					total += BREAK_MARKER_PX[brk.long ? 'long' : 'short'] + 2 * BLOCK_TO_BREAK_PX[density];
				}
				for (const unit of layout.leisureBlocks) total += unit.heightPx;
				if (layout.leisureBlocks.length > 1) {
					total += (layout.leisureBlocks.length - 1) * BLOCK_GAP_PX;
				}

				expect(total).toBeLessThanOrEqual(availablePx);
			}),
			{ numRuns: 100 }
		);
	});
});
