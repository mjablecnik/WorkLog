/**
 * The reconciliation core. Pure: it receives every list it needs and returns a
 * description of what should be written. It never decides HTTP status codes — it
 * reports conflicts and leftovers, and the route maps them.
 *
 * `Explicit_Mode` and `Open_Mode` share one code path (`clipExplicit`): `Open_Mode`
 * resolves its interval via `resolveAnchor` and then asks nothing further of this
 * module — it is not a third algorithm, just a third way to arrive at `requested`.
 */
import type { Interval } from '$lib/contracts/models';
import { clamp, intersect, normalize, subtract, take, total } from './interval';

export type ActivityMode = 'explicit' | 'duration' | 'open';
export type UntrackedPolicy = 'clip' | 'extend' | 'reject'; // 'clip' is the default

export type ClipInput = {
	mode: ActivityMode;
	/** Explicit_Mode and Open_Mode only. */
	requested?: Interval;
	/** Duration_Mode only, in milliseconds. */
	durationMs?: number;
	/** Duration_Mode only: resolved placement start. */
	anchor?: Date;
	/**
	 * Duration_Mode and Open_Mode only: bounds the forward search and the reach of
	 * policy `extend`. Absent in Explicit_Mode, where the requested interval is its
	 * own bound and there is no Target_Day to consult (Requirement 6.13).
	 */
	dayBounds?: Interval;
	/** Normalized Work_Session intervals. */
	tracked: Interval[];
	/** Normalized Activity_Segment intervals of OTHER entries. */
	covered: Interval[];
	/**
	 * The Open_Session read UNCAPPED as [startedAt, now), when one exists. Policy
	 * `extend` may not create or lengthen a session inside it (Requirement 6.18) — and
	 * it cannot be inferred from `tracked`, which deliberately omits a Stale_Session's
	 * tail beyond MAX_OPEN_SESSION_HOURS (Requirement 1.12). It is NOT added to
	 * `tracked`: that would place segments in the tail, which 1.12 forbids.
	 */
	openSessionSpan?: Interval;
	policy: UntrackedPolicy;
	/**
	 * MIN_INTERVAL_SECONDS in milliseconds. Passed in rather than read, because the
	 * module may not touch `$env`.
	 */
	minIntervalMs: number;
	/**
	 * The current instant. Policy `extend` may never reach past it (Requirement 6.8),
	 * and `Open_Mode` ends here; without it the pure function cannot tell.
	 */
	now: Date;
};

export type ClipResult = {
	/** What to persist as Activity_Segment rows. Empty means NOTHING_TO_LOG (Req 6.12). */
	segments: Interval[];
	/**
	 * Parts of the request left in Untracked_Time and therefore not persisted — under
	 * `clip` and `reject` alike (the two compute identically at this level; the route
	 * decides what a non-empty value means under `reject`), and under `extend` in
	 * Explicit_Mode and Open_Mode, the parts `extend` was not allowed to cover.
	 */
	discarded: Interval[];
	/**
	 * Parts dropped for being shorter than `minIntervalMs` (Requirement 6.5). Kept
	 * apart from `discarded`: a `reject` must fail on a non-empty `discarded` but must
	 * NOT fail on a sliver, and one list cannot say both.
	 */
	slivers: Interval[];
	/** policy=extend: intervals to add to Tracked_Time. Already bounded by `now`. */
	extend: Interval[];
	/**
	 * Explicit_Mode and Open_Mode: the parts of the request that overlap `covered`.
	 * `clip()` only reports them — the caller decides (409 ACTIVITY_OVERLAP, usually).
	 */
	conflicts: Interval[];
	/**
	 * Duration_Mode only, and always 0 in Explicit_Mode and Open_Mode (Requirement
	 * 6.16). `total(segments) + unplacedMs === durationMs` always holds.
	 */
	unplacedMs: number;
};

function splitByFloor(
	intervals: Interval[],
	minIntervalMs: number
): { kept: Interval[]; slivers: Interval[] } {
	const kept: Interval[] = [];
	const slivers: Interval[] = [];
	for (const iv of normalize(intervals)) {
		if (iv.end.getTime() - iv.start.getTime() >= minIntervalMs) kept.push(iv);
		else slivers.push(iv);
	}
	return { kept, slivers };
}

/**
 * Explicit_Mode (and Open_Mode, which resolves its interval and calls this the same
 * way): set arithmetic over `requested`, `tracked` and `covered`.
 */
function clipExplicit(input: ClipInput): ClipResult {
	const requested = input.requested as Interval;
	const reqList = [requested];
	const trackedNorm = normalize(input.tracked);
	const coveredNorm = normalize(input.covered);

	const inside = intersect(reqList, trackedNorm);
	const outside = subtract(reqList, trackedNorm);
	const conflicts = intersect(inside, coveredNorm);

	if (input.policy !== 'extend') {
		// `clip` and `reject` compute identically here; the caller decides what a
		// non-empty `discarded` means under `reject` (Requirement 6.9's flowchart is a
		// route-level decision, not a domain one — this module never throws).
		const { kept, slivers } = splitByFloor(inside, input.minIntervalMs);
		return { segments: kept, discarded: outside, slivers, extend: [], conflicts, unplacedMs: 0 };
	}

	// extend: never past `now`, never past the request's own bound (they are the same
	// bound here — Requirement 6.13), never inside the Open_Session's uncapped span,
	// never as a session shorter than the floor (Requirements 6.8, 6.17, 6.18).
	const upperBound = input.now.getTime() < requested.end.getTime() ? input.now : requested.end;
	let extendable = intersect(outside, [{ start: requested.start, end: upperBound }]);
	if (input.openSessionSpan) extendable = subtract(extendable, [input.openSessionSpan]);
	const { kept: extendKept } = splitByFloor(extendable, input.minIntervalMs);

	const notCovered = subtract(outside, extendKept);
	const newTracked = normalize([...trackedNorm, ...extendKept]);
	const finalInside = intersect(reqList, newTracked);
	const { kept: finalSegments, slivers: finalSlivers } = splitByFloor(
		finalInside,
		input.minIntervalMs
	);

	return {
		segments: finalSegments,
		discarded: notCovered,
		slivers: finalSlivers,
		extend: extendKept,
		conflicts,
		unplacedMs: 0
	};
}

/** Duration_Mode: walk forward from `anchor`, consuming eligible time. */
function clipDuration(input: ClipInput): ClipResult {
	const anchor = input.anchor as Date;
	const dayBounds = input.dayBounds as Interval;
	const durationMs = input.durationMs as number;
	const trackedNorm = normalize(input.tracked);
	const coveredNorm = normalize(input.covered);

	const window: Interval = { start: anchor, end: dayBounds.end };
	const eligible = subtract(clamp(trackedNorm, window), coveredNorm);
	const { taken, remainder, slivers } = take(eligible, durationMs, input.minIntervalMs);

	if (input.policy !== 'extend' || remainder <= 0) {
		return {
			segments: taken,
			discarded: [],
			slivers,
			extend: [],
			conflicts: [],
			unplacedMs: remainder
		};
	}

	// extend: place what it lawfully can anywhere in the window not already tracked,
	// earliest gap first — not only after the last tracked instant (Requirement 6.13's
	// Duration_Mode bound is `dayBounds`, since there is no requested interval here).
	const upperBound = input.now.getTime() < window.end.getTime() ? input.now : window.end;
	let extendable = subtract([{ start: window.start, end: upperBound }], trackedNorm);
	if (input.openSessionSpan) extendable = subtract(extendable, [input.openSessionSpan]);

	const {
		taken: extendTaken,
		remainder: stillRemaining,
		slivers: extendSlivers
	} = take(extendable, remainder, input.minIntervalMs);

	// Reduce unplacedMs only by what was actually placed (Requirement 6.15) — `take`
	// already guarantees this: `stillRemaining` is exactly `remainder` minus what
	// `extendTaken` covers, never more.
	const segments = normalize([...taken, ...extendTaken]);

	return {
		segments,
		discarded: [],
		slivers: [...slivers, ...extendSlivers],
		extend: extendTaken,
		conflicts: [],
		unplacedMs: stillRemaining
	};
}

/**
 * Total: never throws for well-formed input. Callers inspect `conflicts` and
 * `unplacedMs` — and, for `reject`, `discarded` — to decide whether to accept the
 * result.
 */
export function clip(input: ClipInput): ClipResult {
	if (input.mode === 'duration') return clipDuration(input);
	return clipExplicit(input);
}

/**
 * Picks the Placement_Anchor for Duration_Mode and Open_Mode per Requirements
 * 5.4-5.7 and 15.2-15.4: the explicit start when given, else the end of the day's
 * latest segment, else the start of its earliest session. `targetDay` is carried on
 * `NoPlacementAnchorError` only — the caller already knows which day it resolved
 * `segments`/`sessions` for, and the route needs that date in the 409 body.
 */
export function resolveAnchor(
	explicit: Date | null,
	segments: Interval[],
	sessions: Interval[],
	targetDay: string
): Date {
	if (explicit !== null) return explicit;

	const normSegments = normalize(segments);
	if (normSegments.length > 0) {
		return normSegments.reduce(
			(latest, s) => (s.end.getTime() > latest.getTime() ? s.end : latest),
			normSegments[0].end
		);
	}

	const normSessions = normalize(sessions);
	if (normSessions.length > 0) {
		return normSessions.reduce(
			(earliest, s) => (s.start.getTime() < earliest.getTime() ? s.start : earliest),
			normSessions[0].start
		);
	}

	throw new NoPlacementAnchorError(targetDay);
}

/**
 * Thrown by `resolveAnchor` when the Target_Day holds neither an Activity_Segment nor
 * a Work_Session (Requirements 5.7, 15.8). It is a domain error, not an `ErrorCode`:
 * the route catches it and answers 409 `NO_PLACEMENT_ANCHOR`. The domain never names
 * an HTTP status.
 */
export class NoPlacementAnchorError extends Error {
	constructor(readonly date: string) {
		super(`no Placement_Anchor available${date ? ` for ${date}` : ''}`);
		this.name = 'NoPlacementAnchorError';
	}
}

// `total` is re-exported for callers that need to sum a ClipResult field without a
// second import of the interval module.
export { total };
