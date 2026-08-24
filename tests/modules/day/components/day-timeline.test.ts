/**
 * Component tests for `DayTimeline` (task 3.6). `@testing-library/svelte` + jsdom,
 * matching the pattern established by
 * `tests/modules/day/components/change-preview.test.ts` and
 * `tests/modules/timer/components/day-gauge.test.ts`.
 *
 * `DayTimeline.svelte` measures its own rendered height with a `ResizeObserver` inside
 * an `$effect`, guarded by `typeof ResizeObserver === 'undefined'` — and jsdom (this
 * project's test environment; verified empirically by grepping `node_modules/jsdom` for
 * the symbol — it isn't there) never defines that global. The guard therefore returns
 * before ever calling `observer.observe`, and `availablePx` never leaves its documented
 * fallback, `INITIAL_AVAILABLE_PX = 712` (`DayTimeline.svelte`'s own comment: "712
 * mirrors design.md's own documented desktop fallback"). No `ResizeObserver` mock is
 * needed anywhere in this file — every fixture below is sized so its layout makes sense
 * against that fixed 712px budget, and the exact numbers behind each fixture's
 * shape (floor-triggering, tall-enough-for-a-description, etc.) are spelled out in the
 * comment above the test that needs them.
 *
 * Fixtures are built with small local helpers (`dt`, `mkSession`, `mkEntry`) against a
 * fixed reference day, never the real wall clock — matching
 * `tests/modules/day/components/timeline-geometry.test.ts`'s own convention, which this
 * file's helpers are deliberately kept close to since `layOutDay` is the same function
 * under both.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DayTimeline from '../../../../src/modules/day/components/DayTimeline.svelte';
import type { ActivityEntry, ActivitySegment, Interval, WorkSession } from '../../../../src/lib/contracts/models';
import { formatTimeOfDay } from '../../../../src/lib/viz/format';
import * as m from '../../../../src/lib/paraglide/messages';

// --- Fixed reference day, never the real wall clock (matches timeline-geometry.test.ts) --
const BASE_DAY_MS = Date.UTC(2026, 5, 15);
const TZ = 'UTC';
const DATE = '2026-06-15';
const NOW = new Date(BASE_DAY_MS + 20 * 3_600_000); // 20:00 — after every closed fixture below
const EVENING_HOUR = 22; // kept clear of every fixture below except the night-marker test
const MAX_OPEN_SESSION_HOURS = 12;

/** A UTC instant on the reference day, at `hour:minute`. */
function dt(hour: number, minute = 0): Date {
	return new Date(BASE_DAY_MS + hour * 3_600_000 + minute * 60_000);
}

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${idCounter}`;
}

function fmtTime(t: Date): string {
	return formatTimeOfDay(t, '', TZ);
}

// --- Fixture builders, matching timeline-geometry.test.ts's own conventions ------------

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
		description: '',
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

type DayTimelineProps = {
	sessions: WorkSession[];
	entries: ActivityEntry[];
	uncovered: Interval[];
	maxOpenSessionHours: number;
	eveningHour: number;
	now: Date;
	density: 'desktop' | 'mobile';
	timeZone: string;
	locale: string;
	date: string;
	onActivityActivate: (entryId: string) => void;
	onSessionActivate: (sessionId: string) => void;
	onSessionEdgeActivate: (sessionId: string, edge: 'start' | 'end') => void;
	onUncoveredActivate: (range: Interval) => void;
};

function renderTimeline(overrides: Partial<DayTimelineProps> = {}) {
	return render(DayTimeline, {
		props: {
			sessions: [],
			entries: [],
			uncovered: [],
			maxOpenSessionHours: MAX_OPEN_SESSION_HOURS,
			eveningHour: EVENING_HOUR,
			now: NOW,
			density: 'desktop',
			timeZone: TZ,
			locale: '',
			date: DATE,
			onActivityActivate: vi.fn(),
			onSessionActivate: vi.fn(),
			onSessionEdgeActivate: vi.fn(),
			onUncoveredActivate: vi.fn(),
			...overrides
		}
	});
}

// --- Tests ------------------------------------------------------------------------------

describe('DayTimeline', () => {
	it('renders one WorkBlock per session and one SegmentBlock per segment (Requirement 4.1, 4.5)', () => {
		const sessionA = mkSession(dt(9), dt(10));
		const sessionB = mkSession(dt(11), dt(12));
		const entryA1 = mkEntry([{ start: dt(9), end: dt(9, 30) }]);
		const entryA2 = mkEntry([{ start: dt(9, 30), end: dt(10) }]);
		const entryB = mkEntry([{ start: dt(11), end: dt(12) }]);

		const { container } = renderTimeline({
			sessions: [sessionA, sessionB],
			entries: [entryA1, entryA2, entryB]
		});

		expect(container.querySelectorAll('.wb').length).toBe(2);
		expect(container.querySelectorAll('.sb').length).toBe(3);
		expect(container.querySelectorAll('.sb--project').length).toBe(3);
	});

	it('marks an Uncovered_Time stretch at or above MIN_UNCOVERED_SECONDS (Requirement 4.7, 4.25)', () => {
		// Session 09:00-11:00; a 1h segment then a 30 min uncovered gap (>= 5 min floor).
		const session = mkSession(dt(9), dt(11));
		const entry = mkEntry([{ start: dt(9), end: dt(10) }]);
		const uncovered: Interval[] = [{ start: dt(10), end: dt(10, 30) }];

		renderTimeline({ sessions: [session], entries: [entry], uncovered });

		expect(screen.getByText(m.day_uncovered_title())).toBeInTheDocument();
	});

	it('renders WorkBlocks in chronological DOM order regardless of the sessions prop order (Requirement 4.1)', () => {
		const sessionA = mkSession(dt(9), dt(10));
		const sessionB = mkSession(dt(11), dt(12));
		const sessionC = mkSession(dt(13), dt(14));
		const entryA = mkEntry([{ start: dt(9), end: dt(10) }]);
		const entryB = mkEntry([{ start: dt(11), end: dt(12) }]);
		const entryC = mkEntry([{ start: dt(13), end: dt(14) }]);

		// Shuffled, non-chronological prop order.
		const { container } = renderTimeline({
			sessions: [sessionC, sessionA, sessionB],
			entries: [entryA, entryB, entryC]
		});

		const headTimes = Array.from(container.querySelectorAll('.wb-head-time')).map((el) => el.textContent);
		expect(headTimes).toEqual([
			m.day_block_head({ from: fmtTime(dt(9)), to: fmtTime(dt(10)) }),
			m.day_block_head({ from: fmtTime(dt(11)), to: fmtTime(dt(12)) }),
			m.day_block_head({ from: fmtTime(dt(13)), to: fmtTime(dt(14)) })
		]);
	});

	it('gives every block an accessible name containing its formatted start and end times (Requirement 4.6)', () => {
		const sessionA = mkSession(dt(9), dt(10));
		const sessionB = mkSession(dt(11), dt(12, 30));
		const entryA = mkEntry([{ start: dt(9), end: dt(10) }]);
		const entryB = mkEntry([{ start: dt(11), end: dt(12, 30) }]);

		const { container } = renderTimeline({
			sessions: [sessionA, sessionB],
			entries: [entryA, entryB]
		});

		const headButtons = container.querySelectorAll('.wb-head-btn');
		expect(headButtons.length).toBe(2);

		// The head button carries no aria-label of its own — its accessible name comes
		// from its visible text content, which must contain both formatted times.
		expect(headButtons[0].textContent).toContain(fmtTime(dt(9)));
		expect(headButtons[0].textContent).toContain(fmtTime(dt(10)));
		expect(headButtons[1].textContent).toContain(fmtTime(dt(11)));
		expect(headButtons[1].textContent).toContain(fmtTime(dt(12, 30)));
	});

	it('shows the part counter on both parts of a split entry and links them on hover (Requirement 4.8, 4.24)', async () => {
		// One Activity_Entry with two segments in two different Work_Sessions, spanning
		// a 1h break (09:00-10:00, then 11:00-11:30) — exercises DayTimeline's own
		// hoveredEntryId wiring, not just SegmentBlock in isolation.
		const sessionA = mkSession(dt(9), dt(10));
		const sessionB = mkSession(dt(11), dt(11, 30));
		const splitEntry = mkEntry([
			{ start: dt(9), end: dt(10) },
			{ start: dt(11), end: dt(11, 30) }
		]);

		const { container } = renderTimeline({
			sessions: [sessionA, sessionB],
			entries: [splitEntry]
		});

		const parts = container.querySelectorAll(`[data-entry-id="${splitEntry.id}"]`);
		expect(parts.length).toBe(2);

		const [firstPart, secondPart] = Array.from(parts);
		expect(firstPart.querySelector('.sb-meta')?.textContent).toContain(m.day_segment_part({ index: 1, count: 2 }));
		expect(secondPart.querySelector('.sb-meta')?.textContent).toContain(m.day_segment_part({ index: 2, count: 2 }));

		// Neither part is linked before any hover.
		expect(firstPart).not.toHaveClass('sb--linked');
		expect(secondPart).not.toHaveClass('sb--linked');

		// Hovering the first part must light up the second part too, even though it sits
		// in a different WorkBlock across the break — only reachable through DayTimeline's
		// shared hoveredEntryId state, not a pure-CSS sibling selector.
		await fireEvent.mouseEnter(firstPart);
		expect(secondPart).toHaveClass('sb--linked');

		await fireEvent.mouseLeave(firstPart);
		expect(secondPart).not.toHaveClass('sb--linked');
	});

	it('marks a running (open) session (Requirement 4.14)', () => {
		const session = mkSession(dt(19), null); // still open at NOW (20:00)

		renderTimeline({ sessions: [session], now: NOW });

		expect(screen.getByText(m.day_block_running())).toBeInTheDocument();
	});

	it('renders a segment at the floor as one collapsed line, with no description (Requirement 4.15)', () => {
		// One session, two segments from two different entries: a 7h segment and a 1
		// minute segment. Against the 712px fallback budget (41px fixed, 671px flex,
		// 25260s total), the tiny segment's proportional share is ~1.6px — far under
		// MIN_BLOCK_PX.desktop (36) — so layOutDay's floor step lifts it to exactly 36,
		// which SegmentBlock's atFloor = heightPx <= floorPx renders as the collapsed,
		// single-row, no-description variant regardless of the entry's own description.
		const session = mkSession(dt(9), dt(16, 1));
		const bigEntry = mkEntry([{ start: dt(9), end: dt(16) }], {
			projectName: 'Big Project',
			description: 'A long description that would show on a tall block'
		});
		const tinyEntry = mkEntry([{ start: dt(16), end: dt(16, 1) }], {
			projectName: 'Tiny Project',
			description: 'A description that must never appear at the floor'
		});

		const { container } = renderTimeline({
			sessions: [session],
			entries: [bigEntry, tinyEntry]
		});

		const tinyBlock = container.querySelector(`[data-entry-id="${tinyEntry.id}"]`);
		expect(tinyBlock).not.toBeNull();
		expect(tinyBlock).toHaveClass('sb--floor');
		expect(tinyBlock?.querySelector('.sb-desc')).toBeNull();
		expect(tinyBlock?.querySelector('.sb-name')).not.toBeNull();
		expect(tinyBlock?.querySelector('.sb-meta')).not.toBeNull();
		expect(screen.queryByText('A description that must never appear at the floor')).toBeNull();

		// Sanity: the big segment, well above the floor, is not collapsed.
		const bigBlock = container.querySelector(`[data-entry-id="${bigEntry.id}"]`);
		expect(bigBlock).not.toHaveClass('sb--floor');
	});

	it('never renders a description on a mobile block, even when tall enough for one on desktop (Requirement 4.16)', () => {
		// A single segment filling almost the whole 712px budget — well past
		// DESCRIPTION_MIN_PX (60) — which would show a description on desktop. On
		// mobile, layOutDay sets showsDescription = density === 'desktop' && ... , so it
		// is always false regardless of height.
		const session = mkSession(dt(9), dt(17));
		const entry = mkEntry([{ start: dt(9), end: dt(17) }], {
			description: 'This description must never render on mobile'
		});

		renderTimeline({
			sessions: [session],
			entries: [entry],
			density: 'mobile'
		});

		expect(screen.queryByText('This description must never render on mobile')).toBeNull();
	});

	it('marks a session touching the Evening_Hour as night (Requirement 4.21)', () => {
		// EVENING_HOUR is 22 — this session runs 22:00-23:00, so it touches it directly.
		const session = mkSession(dt(EVENING_HOUR), dt(EVENING_HOUR + 1));
		const entry = mkEntry([{ start: dt(EVENING_HOUR), end: dt(EVENING_HOUR + 1) }]);

		renderTimeline({ sessions: [session], entries: [entry] });

		expect(screen.getByText(m.day_block_night())).toBeInTheDocument();
	});

	it('shows the empty state for a day with no sessions, instead of any timeline structure (Requirement 7.1, 7.2)', () => {
		const { container } = renderTimeline({ sessions: [] });

		expect(screen.getByText(m.day_empty_title())).toBeInTheDocument();
		expect(screen.getByText(m.day_empty_body())).toBeInTheDocument();
		expect(container.querySelectorAll('.wb').length).toBe(0);
	});
});
