import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDayResolver } from '../../../../src/lib/server/domain/logical-day';

/**
 * Property 12: Logical day assignment is a partition.
 *
 * For any instant t, dateOf(t) names exactly one Logical_Day, t lies inside
 * bounds(dateOf(t)), and consecutive day windows touch without overlapping —
 * including across both DST transitions.
 *
 * Validates: Requirements 10.5, 10.6
 */
describe('Property 12: Logical day assignment is a partition', () => {
	const resolver = createDayResolver('Europe/Prague', 3);

	// Several years spanning many DST transitions, expressed as instants (ms since
	// epoch) within a wide window so fast-check's shrinking lands on real timestamps.
	const RANGE_START = new Date('2024-01-01T00:00:00Z').getTime();
	const RANGE_END = new Date('2029-01-01T00:00:00Z').getTime();

	it('t always lies inside bounds(dateOf(t))', () => {
		fc.assert(
			fc.property(fc.integer({ min: RANGE_START, max: RANGE_END }), (ms) => {
				const t = new Date(ms);
				const date = resolver.dateOf(t);
				const { start, end } = resolver.bounds(date);
				expect(t.getTime()).toBeGreaterThanOrEqual(start.getTime());
				expect(t.getTime()).toBeLessThan(end.getTime());
			}),
			{ numRuns: 300 }
		);
	});

	it('consecutive day windows touch without overlapping', () => {
		fc.assert(
			fc.property(fc.integer({ min: RANGE_START, max: RANGE_END }), (ms) => {
				const t = new Date(ms);
				const date = resolver.dateOf(t);
				const today = resolver.bounds(date);
				// The day before today ends exactly where today starts.
				const yesterdayDate = new Date(today.start.getTime() - 1);
				const yesterday = resolver.bounds(resolver.dateOf(yesterdayDate));
				expect(yesterday.end.getTime()).toBe(today.start.getTime());
			}),
			{ numRuns: 300 }
		);
	});

	it('both known Prague DST transitions in the sampled years are exercised', () => {
		// Sanity that the sampled range actually crosses both transitions of at least one
		// year, so the property above is not vacuously true over an all-standard-time range.
		const spring = resolver.bounds('2026-03-28');
		const autumn = resolver.bounds('2026-10-24');
		expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
		expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(25);
	});
});
