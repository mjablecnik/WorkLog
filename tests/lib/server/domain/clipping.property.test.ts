import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { clip, type ClipInput } from '../../../../src/lib/server/domain/clipping';
import { intersect, normalize, subtract, total } from '../../../../src/lib/server/domain/interval';
import type { Interval } from '../../../../src/lib/contracts/models';

const BASE = new Date('2026-06-15T00:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60_000;
const MIN_MS = 60_000;

const rawInterval = fc
	.tuple(fc.integer({ min: 0, max: DAY_MS }), fc.integer({ min: 0, max: DAY_MS }))
	.map(([a, b]): Interval => ({
		start: new Date(BASE + Math.min(a, b)),
		end: new Date(BASE + Math.max(a, b))
	}));

const intervalList = fc.array(rawInterval, { maxLength: 6 });

describe('Property 1: Segments never cover untracked time', () => {
	it('every produced segment lies entirely within Tracked_Time, for clip and reject', () => {
		fc.assert(
			fc.property(
				intervalList,
				rawInterval,
				fc.constantFrom<'clip' | 'reject'>('clip', 'reject'),
				(tracked, requested, policy) => {
					const result = clip({
						mode: 'explicit',
						requested,
						tracked,
						covered: [],
						policy,
						minIntervalMs: MIN_MS,
						now: new Date(BASE + 2 * DAY_MS)
					});
					const outside = subtract(result.segments, normalize(tracked));
					expect(total(outside)).toBe(0);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 2: Duration mode conserves the requested duration', () => {
	it('total(segments) + unplacedMs === d, and every segment lasts at least minIntervalMs', () => {
		fc.assert(
			fc.property(intervalList, fc.integer({ min: 0, max: 4 * 3_600_000 }), (tracked, d) => {
				const anchor = new Date(BASE);
				const dayBounds = { start: new Date(BASE), end: new Date(BASE + DAY_MS) };
				const result = clip({
					mode: 'duration',
					anchor,
					durationMs: d,
					dayBounds,
					tracked,
					covered: [],
					policy: 'clip',
					minIntervalMs: MIN_MS,
					now: new Date(BASE + 2 * DAY_MS)
				});
				expect(total(result.segments) + result.unplacedMs).toBe(d);
				for (const s of result.segments) {
					expect(s.end.getTime() - s.start.getTime()).toBeGreaterThanOrEqual(MIN_MS);
				}
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 3: Breaks survive inside an entry', () => {
	it('gaps between consecutive segments contain no eligible Tracked_Time — only real breaks or slivers', () => {
		fc.assert(
			fc.property(intervalList, rawInterval, (tracked, requested) => {
				const result = clip({
					mode: 'explicit',
					requested,
					tracked,
					covered: [],
					policy: 'clip',
					minIntervalMs: MIN_MS,
					now: new Date(BASE + 2 * DAY_MS)
				});
				const segs = normalize(result.segments);
				for (let i = 1; i < segs.length; i++) {
					const gap = { start: segs[i - 1].end, end: segs[i].start };
					const trackedInGap = intersect([gap], normalize(tracked));
					// Whatever tracked time falls in the gap must be accounted for entirely
					// by slivers (below the floor) — never eligible, unclaimed Tracked_Time.
					const unaccountedFor = subtract(trackedInGap, result.slivers);
					expect(total(unaccountedFor)).toBe(0);
				}
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 11: The recorded request is preserved (domain-level: clip never mutates its input)', () => {
	it('clip does not mutate the requested interval or the tracked/covered lists', () => {
		fc.assert(
			fc.property(intervalList, rawInterval, (tracked, requested) => {
				const trackedCopy = tracked.map((i) => ({
					start: new Date(i.start),
					end: new Date(i.end)
				}));
				const requestedCopy = { start: new Date(requested.start), end: new Date(requested.end) };
				clip({
					mode: 'explicit',
					requested,
					tracked,
					covered: [],
					policy: 'clip',
					minIntervalMs: MIN_MS,
					now: new Date(BASE + 2 * DAY_MS)
				});
				expect(requested).toEqual(requestedCopy);
				expect(tracked).toEqual(trackedCopy);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 17: No stored interval is shorter than the floor', () => {
	it('holds across Explicit_Mode and Duration_Mode alike', () => {
		fc.assert(
			fc.property(
				intervalList,
				fc.integer({ min: 0, max: 4 * 3_600_000 }),
				fc.constantFrom<'explicit' | 'duration'>('explicit', 'duration'),
				(tracked, d, mode) => {
					const input: ClipInput =
						mode === 'explicit'
							? {
									mode: 'explicit',
									requested: { start: new Date(BASE), end: new Date(BASE + d) },
									tracked,
									covered: [],
									policy: 'clip',
									minIntervalMs: MIN_MS,
									now: new Date(BASE + 2 * DAY_MS)
								}
							: {
									mode: 'duration',
									anchor: new Date(BASE),
									durationMs: d,
									dayBounds: { start: new Date(BASE), end: new Date(BASE + DAY_MS) },
									tracked,
									covered: [],
									policy: 'clip',
									minIntervalMs: MIN_MS,
									now: new Date(BASE + 2 * DAY_MS)
								};
					const result = clip(input);
					for (const s of result.segments) {
						expect(s.end.getTime() - s.start.getTime()).toBeGreaterThanOrEqual(MIN_MS);
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 20: Extending never reaches into the future', () => {
	it('every interval in extend ends at or before now', () => {
		fc.assert(
			fc.property(
				intervalList,
				rawInterval,
				fc.integer({ min: 0, max: DAY_MS }),
				(tracked, requested, nowOffset) => {
					const now = new Date(BASE + nowOffset);
					const result = clip({
						mode: 'explicit',
						requested,
						tracked,
						covered: [],
						policy: 'extend',
						minIntervalMs: MIN_MS,
						now
					});
					for (const e of result.extend) {
						expect(e.end.getTime()).toBeLessThanOrEqual(now.getTime());
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 24: Explicit segments never exceed the request', () => {
	it('every produced segment lies within the requested interval', () => {
		fc.assert(
			fc.property(intervalList, rawInterval, (tracked, requested) => {
				const result = clip({
					mode: 'explicit',
					requested,
					tracked,
					covered: [],
					policy: 'clip',
					minIntervalMs: MIN_MS,
					now: new Date(BASE + 2 * DAY_MS)
				});
				const outsideRequest = subtract(result.segments, [requested]);
				expect(total(outsideRequest)).toBe(0);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 25: Clipping is idempotent over its own output', () => {
	it('re-clipping each produced segment individually returns it unchanged', () => {
		fc.assert(
			fc.property(intervalList, rawInterval, (tracked, requested) => {
				const result = clip({
					mode: 'explicit',
					requested,
					tracked,
					covered: [],
					policy: 'clip',
					minIntervalMs: MIN_MS,
					now: new Date(BASE + 2 * DAY_MS)
				});
				for (const segment of result.segments) {
					const reclip = clip({
						mode: 'explicit',
						requested: segment,
						tracked,
						covered: [], // the entry's own segments excluded from covered, as a PATCH does
						policy: 'clip',
						minIntervalMs: MIN_MS,
						now: new Date(BASE + 2 * DAY_MS)
					});
					expect(reclip.segments).toEqual([segment]);
					expect(reclip.discarded).toEqual([]);
					expect(reclip.slivers).toEqual([]);
					expect(reclip.unplacedMs).toBe(0);
				}
			}),
			{ numRuns: 100 }
		);
	});
});
