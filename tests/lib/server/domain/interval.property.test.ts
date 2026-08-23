import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	duration,
	intersect,
	normalize,
	overlaps,
	subtract,
	take,
	total
} from '../../../../src/lib/server/domain/interval';
import type { Interval } from '../../../../src/lib/contracts/models';

const BASE = new Date('2026-01-01T00:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60_000;

/** A raw (possibly empty, possibly reversed) interval within a two-day window. */
const rawInterval = fc
	.tuple(fc.integer({ min: 0, max: DAY_MS * 2 }), fc.integer({ min: 0, max: DAY_MS * 2 }))
	.map(([a, b]): Interval => ({
		start: new Date(BASE + Math.min(a, b)),
		end: new Date(BASE + Math.max(a, b))
	}));

/** Deliberately unsorted, with duplicates and zero-length entries mixed in. */
const intervalList = fc.array(
	fc.oneof(
		rawInterval,
		fc.integer({ min: 0, max: DAY_MS * 2 }).map((a): Interval => ({
			start: new Date(BASE + a),
			end: new Date(BASE + a) // zero-length
		}))
	),
	{ maxLength: 12 }
);

function isSorted(list: Interval[]): boolean {
	for (let i = 1; i < list.length; i++) {
		if (list[i].start.getTime() < list[i - 1].start.getTime()) return false;
	}
	return true;
}

function isPairwiseDisjointAndNonTouching(list: Interval[]): boolean {
	for (let i = 1; i < list.length; i++) {
		if (list[i].start.getTime() <= list[i - 1].end.getTime()) return false;
	}
	return true;
}

describe('Property 4: Interval algebra is conservative', () => {
	it('total(intersect(a,b)) + total(subtract(a,b)) === total(normalize(a))', () => {
		fc.assert(
			fc.property(intervalList, intervalList, (a, b) => {
				const lhs = total(intersect(a, b)) + total(subtract(a, b));
				const rhs = total(normalize(a));
				expect(lhs).toBe(rhs);
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 5: Normalization is idempotent and canonical', () => {
	it('normalize(normalize(x)) === normalize(x), sorted, disjoint, non-touching', () => {
		fc.assert(
			fc.property(intervalList, (x) => {
				const once = normalize(x);
				const twice = normalize(once);
				expect(twice).toEqual(once);
				expect(isSorted(once)).toBe(true);
				expect(isPairwiseDisjointAndNonTouching(once)).toBe(true);
				for (const i of once) expect(i.start.getTime()).toBeLessThan(i.end.getTime());
			}),
			{ numRuns: 100 }
		);
	});
});

describe('Property 6: Take is exact and order-preserving', () => {
	it('conserves total(taken)+remainder, respects the floor, and taken is a subsequence', () => {
		fc.assert(
			fc.property(
				intervalList,
				fc.integer({ min: 0, max: DAY_MS * 3 }),
				fc.integer({ min: 0, max: 60 * 60_000 }),
				(input, ms, minIntervalMs) => {
					const { taken, remainder } = take(input, ms, minIntervalMs);
					expect(total(taken) + remainder).toBe(ms);
					for (const t of taken) expect(duration(t)).toBeGreaterThanOrEqual(minIntervalMs);

					// `taken` is a time-ordered subsequence of normalize(input): every taken
					// interval must be contained within some interval of the normalized input,
					// in order, and only the last taken interval may be a strict truncation.
					const normalized = normalize(input);
					let cursor = 0;
					for (let i = 0; i < taken.length; i++) {
						const t = taken[i];
						let found = -1;
						for (let j = cursor; j < normalized.length; j++) {
							const src = normalized[j];
							if (
								t.start.getTime() >= src.start.getTime() &&
								t.end.getTime() <= src.end.getTime()
							) {
								found = j;
								break;
							}
						}
						expect(found).toBeGreaterThanOrEqual(0);
						cursor = found + 1;
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('sanity: intersect/overlaps agree', () => {
	it('a and b overlap iff intersect(a,b) is non-empty, for single-interval lists', () => {
		fc.assert(
			fc.property(rawInterval, rawInterval, (a, b) => {
				const nonEmptyA = a.start.getTime() < a.end.getTime();
				const nonEmptyB = b.start.getTime() < b.end.getTime();
				if (!nonEmptyA || !nonEmptyB) return;
				expect(intersect([a], [b]).length > 0).toBe(overlaps(a, b));
			}),
			{ numRuns: 100 }
		);
	});
});
