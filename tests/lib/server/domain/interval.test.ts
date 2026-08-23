import { describe, expect, it } from 'vitest';
import {
	clamp,
	duration,
	gaps,
	intersect,
	isEmpty,
	normalize,
	overlaps,
	subtract,
	take,
	total,
	union
} from '../../../../src/lib/server/domain/interval';
import type { Interval } from '../../../../src/lib/contracts/models';

function iv(startIso: string, endIso: string): Interval {
	return { start: new Date(startIso), end: new Date(endIso) };
}

describe('isEmpty / duration / overlaps', () => {
	it('an interval whose end is not after its start is empty', () => {
		expect(isEmpty(iv('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z'))).toBe(true);
		expect(isEmpty(iv('2026-01-01T10:00:00Z', '2026-01-01T09:00:00Z'))).toBe(true);
		expect(isEmpty(iv('2026-01-01T10:00:00Z', '2026-01-01T10:00:01Z'))).toBe(false);
	});

	it('duration is in milliseconds', () => {
		expect(duration(iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'))).toBe(3_600_000);
	});

	it('overlapping intervals do overlap', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z');
		const b = iv('2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z');
		expect(overlaps(a, b)).toBe(true);
	});

	it('half-open: touching at one instant is not an overlap', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z');
		const b = iv('2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z');
		expect(overlaps(a, b)).toBe(false);
	});
});

describe('normalize', () => {
	it('empty input yields empty output', () => {
		expect(normalize([])).toEqual([]);
	});

	it('a single interval passes through unchanged', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z');
		expect(normalize([a])).toEqual([a]);
	});

	it('merges touching intervals', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z');
		const b = iv('2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z');
		expect(normalize([a, b])).toEqual([iv('2026-01-01T10:00:00Z', '2026-01-01T13:00:00Z')]);
	});

	it('merges overlapping intervals', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z');
		const b = iv('2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z');
		expect(normalize([a, b])).toEqual([iv('2026-01-01T10:00:00Z', '2026-01-01T13:00:00Z')]);
	});

	it('keeps disjoint intervals separate', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z');
		const b = iv('2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z');
		expect(normalize([a, b])).toEqual([a, b]);
		expect(normalize([b, a])).toEqual([a, b]);
	});

	it('drops empty intervals', () => {
		expect(normalize([iv('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z')])).toEqual([]);
	});

	it('is idempotent', () => {
		const a = iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z');
		const b = iv('2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z');
		const once = normalize([a, b]);
		expect(normalize(once)).toEqual(once);
	});
});

describe('union', () => {
	it('is the normalized concatenation', () => {
		const a = [iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')];
		const b = [iv('2026-01-01T10:30:00Z', '2026-01-01T12:00:00Z')];
		expect(union(a, b)).toEqual([iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')]);
	});
});

describe('intersect', () => {
	it('the parts of a that also lie in b', () => {
		const a = [iv('2026-01-01T10:00:00Z', '2026-01-01T14:00:00Z')];
		const b = [iv('2026-01-01T12:00:00Z', '2026-01-01T16:00:00Z')];
		expect(intersect(a, b)).toEqual([iv('2026-01-01T12:00:00Z', '2026-01-01T14:00:00Z')]);
	});

	it('is empty for disjoint lists', () => {
		const a = [iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')];
		const b = [iv('2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z')];
		expect(intersect(a, b)).toEqual([]);
	});

	it('handles multiple overlapping stretches', () => {
		const a = [iv('2026-01-01T08:00:00Z', '2026-01-01T18:00:00Z')];
		const b = [
			iv('2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z'),
			iv('2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z')
		];
		expect(intersect(a, b)).toEqual(b);
	});
});

describe('subtract', () => {
	it('a hole in the middle', () => {
		const a = [iv('2026-01-01T08:00:00Z', '2026-01-01T18:00:00Z')];
		const b = [iv('2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z')];
		expect(subtract(a, b)).toEqual([
			iv('2026-01-01T08:00:00Z', '2026-01-01T12:00:00Z'),
			iv('2026-01-01T13:00:00Z', '2026-01-01T18:00:00Z')
		]);
	});

	it('a hole at the head', () => {
		const a = [iv('2026-01-01T08:00:00Z', '2026-01-01T18:00:00Z')];
		const b = [iv('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z')];
		expect(subtract(a, b)).toEqual([iv('2026-01-01T09:00:00Z', '2026-01-01T18:00:00Z')]);
	});

	it('a hole at the tail', () => {
		const a = [iv('2026-01-01T08:00:00Z', '2026-01-01T18:00:00Z')];
		const b = [iv('2026-01-01T17:00:00Z', '2026-01-01T18:00:00Z')];
		expect(subtract(a, b)).toEqual([iv('2026-01-01T08:00:00Z', '2026-01-01T17:00:00Z')]);
	});

	it('eliminates an interval entirely', () => {
		const a = [iv('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z')];
		const b = [iv('2026-01-01T07:00:00Z', '2026-01-01T10:00:00Z')];
		expect(subtract(a, b)).toEqual([]);
	});
});

describe('clamp', () => {
	it('clips to the window and drops what falls entirely outside it', () => {
		const input = [
			iv('2026-01-01T06:00:00Z', '2026-01-01T08:00:00Z'),
			iv('2026-01-01T10:00:00Z', '2026-01-01T20:00:00Z')
		];
		const window = iv('2026-01-01T09:00:00Z', '2026-01-01T18:00:00Z');
		expect(clamp(input, window)).toEqual([iv('2026-01-01T10:00:00Z', '2026-01-01T18:00:00Z')]);
	});
});

describe('total', () => {
	it('sums normalized durations', () => {
		const input = [
			iv('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z'),
			iv('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z')
		];
		expect(total(input)).toBe(3_600_000 + 1_800_000);
	});
});

describe('take', () => {
	const MIN = 60_000;

	it('zero milliseconds takes nothing', () => {
		const input = [iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')];
		const { taken, remainder } = take(input, 0, MIN);
		expect(taken).toEqual([]);
		expect(remainder).toBe(0);
	});

	it('less than the first interval', () => {
		const input = [iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')];
		const { taken, remainder } = take(input, 30 * 60_000, MIN);
		expect(taken).toEqual([iv('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z')]);
		expect(remainder).toBe(0);
	});

	it('exactly the first interval', () => {
		const input = [iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')];
		const { taken, remainder } = take(input, 60 * 60_000, MIN);
		expect(taken).toEqual(input);
		expect(remainder).toBe(0);
	});

	it('spanning two intervals', () => {
		const input = [
			iv('2026-01-01T14:00:00Z', '2026-01-01T14:48:00Z'),
			iv('2026-01-01T15:12:00Z', '2026-01-01T18:00:00Z')
		];
		const { taken, remainder } = take(input, 2 * 60 * 60_000, MIN);
		expect(taken).toEqual([
			iv('2026-01-01T14:00:00Z', '2026-01-01T14:48:00Z'),
			iv('2026-01-01T15:12:00Z', '2026-01-01T16:24:00Z')
		]);
		expect(remainder).toBe(0);
	});

	it('exceeding the total reports the shortfall as remainder', () => {
		const input = [iv('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')];
		const { taken, remainder } = take(input, 90 * 60_000, MIN);
		expect(taken).toEqual(input);
		expect(remainder).toBe(30 * 60_000);
	});

	it('the floor case: a would-be 20-second tail is reported as remainder, not taken', () => {
		const input = [
			iv('2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z'),
			iv('2026-01-01T13:00:00Z', '2026-01-01T16:00:00Z')
		];
		const ms = 60 * 60_000 + 20_000; // 1h0min20s
		const { taken, remainder } = take(input, ms, MIN);
		expect(taken).toEqual([iv('2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z')]);
		expect(remainder).toBe(20_000);
	});

	it('skips a stretch already below the floor and continues past it', () => {
		const input = [
			iv('2026-01-01T10:00:00Z', '2026-01-01T10:00:30Z'), // 30s sliver, below the floor
			iv('2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')
		];
		const { taken, remainder } = take(input, 2 * 60 * 60_000, MIN);
		expect(taken).toEqual([iv('2026-01-01T11:00:00Z', '2026-01-01T13:00:00Z')]);
		expect(remainder).toBe(0);
	});
});

describe('gaps', () => {
	it('window wider than the input', () => {
		const input = [iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')];
		const window = iv('2026-01-01T08:00:00Z', '2026-01-01T18:00:00Z');
		expect(gaps(input, window)).toEqual([
			iv('2026-01-01T08:00:00Z', '2026-01-01T10:00:00Z'),
			iv('2026-01-01T12:00:00Z', '2026-01-01T18:00:00Z')
		]);
	});

	it('window narrower than the input', () => {
		const input = [iv('2026-01-01T08:00:00Z', '2026-01-01T18:00:00Z')];
		const window = iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z');
		expect(gaps(input, window)).toEqual([]);
	});

	it('window equal to the input', () => {
		const input = [iv('2026-01-01T10:00:00Z', '2026-01-01T12:00:00Z')];
		expect(gaps(input, input[0])).toEqual([]);
	});
});
