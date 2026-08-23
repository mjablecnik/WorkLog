import { describe, expect, it } from 'vitest';
import {
	clip,
	resolveAnchor,
	NoPlacementAnchorError,
	type ClipInput
} from '../../../../src/lib/server/domain/clipping';
import { total } from '../../../../src/lib/server/domain/interval';
import type { Interval } from '../../../../src/lib/contracts/models';

function iv(startIso: string, endIso: string): Interval {
	return { start: new Date(startIso), end: new Date(endIso) };
}

const MIN = 60_000; // MIN_INTERVAL_SECONDS = 60s
const DAY = { start: new Date('2026-06-15T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
const FRAME = [
	iv('2026-06-15T08:00:00Z', '2026-06-15T14:48:00Z'),
	iv('2026-06-15T15:12:00Z', '2026-06-15T18:00:00Z')
];

function baseInput(overrides: Partial<ClipInput>): ClipInput {
	return {
		mode: 'explicit',
		tracked: FRAME,
		covered: [],
		policy: 'clip',
		minIntervalMs: MIN,
		now: new Date('2026-06-15T20:00:00Z'),
		...overrides
	};
}

describe('clip', () => {
	it('worked example, explicit: 13:00-16:00 over a broken frame yields two segments', () => {
		const result = clip(
			baseInput({ mode: 'explicit', requested: iv('2026-06-15T13:00:00Z', '2026-06-15T16:00:00Z') })
		);
		expect(result.segments).toEqual([
			iv('2026-06-15T13:00:00Z', '2026-06-15T14:48:00Z'),
			iv('2026-06-15T15:12:00Z', '2026-06-15T16:00:00Z')
		]);
		// The break itself (14:48-15:12) falls in Untracked_Time and, under the default
		// `clip` policy, is discarded rather than persisted.
		expect(result.discarded).toEqual([iv('2026-06-15T14:48:00Z', '2026-06-15T15:12:00Z')]);
		expect(result.conflicts).toEqual([]);
	});

	it('worked example, duration: 2h anchored at 14:00 totals exactly 120 minutes', () => {
		const result = clip(
			baseInput({
				mode: 'duration',
				anchor: new Date('2026-06-15T14:00:00Z'),
				durationMs: 2 * 3_600_000,
				dayBounds: DAY
			})
		);
		expect(result.segments).toEqual([
			iv('2026-06-15T14:00:00Z', '2026-06-15T14:48:00Z'),
			iv('2026-06-15T15:12:00Z', '2026-06-15T16:24:00Z')
		]);
		expect(total(result.segments)).toBe(2 * 3_600_000);
		expect(result.unplacedMs).toBe(0);
	});

	it('a request wholly inside one Work_Session yields one segment', () => {
		const result = clip(
			baseInput({ requested: iv('2026-06-15T09:00:00Z', '2026-06-15T10:00:00Z') })
		);
		expect(result.segments).toEqual([iv('2026-06-15T09:00:00Z', '2026-06-15T10:00:00Z')]);
		expect(result.discarded).toEqual([]);
	});

	it('a request wholly outside tracked time yields none and reports everything discarded', () => {
		const result = clip(
			baseInput({ requested: iv('2026-06-15T14:50:00Z', '2026-06-15T15:00:00Z') })
		);
		expect(result.segments).toEqual([]);
		expect(result.discarded).toEqual([iv('2026-06-15T14:50:00Z', '2026-06-15T15:00:00Z')]);
	});

	it('a 20-second sliver is reported in slivers, not discarded, and does not fail reject', () => {
		const tracked = [iv('2026-06-15T08:00:00Z', '2026-06-15T09:00:20Z')];
		const result = clip(
			baseInput({
				tracked,
				requested: iv('2026-06-15T09:00:00Z', '2026-06-15T09:00:20Z'),
				policy: 'reject'
			})
		);
		expect(result.segments).toEqual([]);
		expect(result.slivers).toEqual([iv('2026-06-15T09:00:00Z', '2026-06-15T09:00:20Z')]);
		expect(result.discarded).toEqual([]); // reject must not fail on a sliver
	});

	it('a request whose whole interval survives nothing yields empty segments', () => {
		const result = clip(
			baseInput({ requested: iv('2026-06-15T14:49:00Z', '2026-06-15T14:59:00Z') })
		);
		expect(result.segments).toEqual([]);
	});

	describe('Untracked_Policy in Explicit_Mode', () => {
		const requested = iv('2026-06-15T14:00:00Z', '2026-06-15T15:00:00Z'); // spans the break

		it('clip discards the untracked part', () => {
			const result = clip(baseInput({ requested, policy: 'clip' }));
			expect(result.segments).toEqual([iv('2026-06-15T14:00:00Z', '2026-06-15T14:48:00Z')]);
			expect(result.discarded).toEqual([iv('2026-06-15T14:48:00Z', '2026-06-15T15:00:00Z')]);
		});

		it('reject reports the same discarded interval for the caller to act on', () => {
			const result = clip(baseInput({ requested, policy: 'reject' }));
			expect(result.discarded).toEqual([iv('2026-06-15T14:48:00Z', '2026-06-15T15:00:00Z')]);
		});

		it('extend covers the untracked part and reports it as extend', () => {
			const result = clip(baseInput({ requested, policy: 'extend' }));
			expect(result.segments).toEqual([iv('2026-06-15T14:00:00Z', '2026-06-15T15:00:00Z')]);
			expect(result.extend).toEqual([iv('2026-06-15T14:48:00Z', '2026-06-15T15:00:00Z')]);
			expect(result.discarded).toEqual([]);
		});
	});

	it('conflicts is populated on collision with covered time', () => {
		const result = clip(
			baseInput({
				requested: iv('2026-06-15T09:00:00Z', '2026-06-15T10:00:00Z'),
				covered: [iv('2026-06-15T09:30:00Z', '2026-06-15T09:45:00Z')]
			})
		);
		expect(result.conflicts).toEqual([iv('2026-06-15T09:30:00Z', '2026-06-15T09:45:00Z')]);
	});

	it('extend never produces a future interval', () => {
		const result = clip(
			baseInput({
				requested: iv('2026-06-15T19:00:00Z', '2026-06-15T21:00:00Z'),
				policy: 'extend',
				now: new Date('2026-06-15T20:00:00Z')
			})
		);
		expect(result.extend).toEqual([iv('2026-06-15T19:00:00Z', '2026-06-15T20:00:00Z')]);
		expect(result.discarded).toEqual([iv('2026-06-15T20:00:00Z', '2026-06-15T21:00:00Z')]);
	});

	it('extend never crosses dayBounds.end in Duration_Mode', () => {
		const result = clip(
			baseInput({
				mode: 'duration',
				anchor: new Date('2026-06-15T23:00:00Z'),
				durationMs: 3 * 3_600_000,
				dayBounds: DAY,
				tracked: [],
				policy: 'extend',
				now: new Date('2026-06-16T06:00:00Z')
			})
		);
		expect(total(result.extend)).toBe(1 * 3_600_000); // only 23:00-00:00 fits before dayBounds.end
		expect(result.unplacedMs).toBe(2 * 3_600_000);
	});

	it('extend fills the earliest gap first, never crossing an existing Work_Session', () => {
		// The design's own worked example: [09:00-10:00, 12:00-13:00], a 4h duration
		// from 09:00 fills 10:00-12:00 (the gap) before reaching past 13:00 — placing
		// only after the last tracked instant would leave a two-hour hole unfilled.
		const tracked = [
			iv('2026-06-15T09:00:00Z', '2026-06-15T10:00:00Z'),
			iv('2026-06-15T12:00:00Z', '2026-06-15T13:00:00Z')
		];
		const result = clip(
			baseInput({
				mode: 'duration',
				anchor: new Date('2026-06-15T09:00:00Z'),
				durationMs: 4 * 3_600_000,
				dayBounds: DAY,
				tracked,
				policy: 'extend',
				now: new Date('2026-06-15T20:00:00Z')
			})
		);
		expect(result.extend).toEqual([iv('2026-06-15T10:00:00Z', '2026-06-15T12:00:00Z')]);
		expect(result.unplacedMs).toBe(0);
		expect(total(result.segments)).toBe(4 * 3_600_000);
	});

	it('extend with the last tracked instant already at now places nothing and leaves unplacedMs unchanged', () => {
		const now = new Date('2026-06-15T18:00:00Z');
		const result = clip(
			baseInput({
				mode: 'duration',
				anchor: new Date('2026-06-15T18:00:00Z'),
				durationMs: 2 * 3_600_000,
				dayBounds: DAY,
				policy: 'extend',
				now
			})
		);
		expect(result.extend).toEqual([]);
		expect(result.unplacedMs).toBe(2 * 3_600_000);
	});

	describe('resolveAnchor', () => {
		it('the explicit start when given', () => {
			const explicit = new Date('2026-06-15T10:00:00Z');
			expect(resolveAnchor(explicit, [], [], '2026-06-15')).toBe(explicit);
		});

		it('the end of the days latest segment', () => {
			const segments = [
				iv('2026-06-15T08:00:00Z', '2026-06-15T09:00:00Z'),
				iv('2026-06-15T10:00:00Z', '2026-06-15T11:00:00Z')
			];
			const anchor = resolveAnchor(null, segments, [], '2026-06-15');
			expect(anchor.toISOString()).toBe('2026-06-15T11:00:00.000Z');
		});

		it('the start of the days earliest session when no segment exists', () => {
			const anchor = resolveAnchor(null, [], FRAME, '2026-06-15');
			expect(anchor.toISOString()).toBe('2026-06-15T08:00:00.000Z');
		});

		it('throws NoPlacementAnchorError when the day holds neither', () => {
			expect(() => resolveAnchor(null, [], [], '2026-06-15')).toThrow(NoPlacementAnchorError);
			try {
				resolveAnchor(null, [], [], '2026-06-15');
			} catch (err) {
				expect((err as NoPlacementAnchorError).date).toBe('2026-06-15');
			}
		});
	});
});
