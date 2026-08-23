import { describe, expect, it } from 'vitest';
import { createDayResolver } from '../../../../src/lib/server/domain/logical-day';

describe('createDayResolver — Europe/Prague, startHour = 3', () => {
	const resolver = createDayResolver('Europe/Prague', 3);

	it('02:30 belongs to the previous date', () => {
		// 2026-03-28 02:30 CET (before the spring transition) = 01:30Z
		expect(resolver.dateOf(new Date('2026-03-28T01:30:00Z'))).toBe('2026-03-27');
	});

	it('03:00 belongs to the current date', () => {
		expect(resolver.dateOf(new Date('2026-06-15T01:00:00Z'))).toBe('2026-06-15'); // 03:00 CEST
	});

	it('23:59 belongs to the current date', () => {
		expect(resolver.dateOf(new Date('2026-06-15T21:59:00Z'))).toBe('2026-06-15'); // 23:59 CEST
	});

	it('pins the DST dates exactly: 2026-03-28 is 23 hours', () => {
		const { start, end } = resolver.bounds('2026-03-28');
		expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
	});

	it('pins the DST dates exactly: 2026-10-24 is 25 hours', () => {
		const { start, end } = resolver.bounds('2026-10-24');
		expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
	});

	it('the transition dates themselves are 24 hours, not the day before', () => {
		expect(
			(resolver.bounds('2026-03-29').end.getTime() -
				resolver.bounds('2026-03-29').start.getTime()) /
				3_600_000
		).toBe(24);
		expect(
			(resolver.bounds('2026-10-25').end.getTime() -
				resolver.bounds('2026-10-25').start.getTime()) /
				3_600_000
		).toBe(24);
	});

	it('an ordinary date is 24 hours', () => {
		const { start, end } = resolver.bounds('2026-06-15');
		expect((end.getTime() - start.getTime()) / 3_600_000).toBe(24);
	});

	it('consecutive day windows touch without overlapping', () => {
		expect(resolver.bounds('2026-03-28').end.getTime()).toBe(
			resolver.bounds('2026-03-29').start.getTime()
		);
	});

	it('rejects a malformed date string', () => {
		expect(() => resolver.bounds('not-a-date')).toThrow();
		expect(() => resolver.bounds('2026/06/15')).toThrow();
	});

	describe('range', () => {
		it('returns one window per Logical_Day intersecting [from, to)', () => {
			const windows = resolver.range(
				new Date('2026-06-01T00:00:00Z'),
				new Date('2026-06-03T00:00:00Z')
			);
			expect(windows.length).toBe(3);
		});

		it('a to falling exactly on a day boundary does not add a trailing empty day', () => {
			const boundary = resolver.bounds('2026-06-10').start;
			const windows = resolver.range(new Date('2026-06-09T00:00:00Z'), boundary);
			expect(windows[windows.length - 1].end.getTime()).toBe(boundary.getTime());
			expect(windows.some((w) => w.start.getTime() === boundary.getTime())).toBe(false);
		});

		it('from >= to yields an empty array', () => {
			const t = new Date('2026-06-01T00:00:00Z');
			expect(resolver.range(t, t)).toEqual([]);
			expect(resolver.range(new Date('2026-06-02T00:00:00Z'), t)).toEqual([]);
		});
	});
});

describe('createDayResolver — UTC, startHour = 0', () => {
	it('behaves as a plain calendar day', () => {
		const resolver = createDayResolver('UTC', 0);
		const { start, end } = resolver.bounds('2026-01-01');
		expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
		expect(end.toISOString()).toBe('2026-01-02T00:00:00.000Z');
		expect(resolver.dateOf(new Date('2026-01-01T12:00:00Z'))).toBe('2026-01-01');
	});
});

describe('createDayResolver — construction failures', () => {
	it('rejects an unloadable time zone', () => {
		expect(() => createDayResolver('Not/AZone', 3)).toThrow();
	});

	it('rejects startHour outside 0..23', () => {
		expect(() => createDayResolver('UTC', -1)).toThrow();
		expect(() => createDayResolver('UTC', 24)).toThrow();
	});

	it('rejects a startHour that does not exist or is ambiguous in the zone', () => {
		expect(() => createDayResolver('Europe/Prague', 2)).toThrow();
	});

	it('accepts the same startHour in a zone with no such transition', () => {
		expect(() => createDayResolver('UTC', 2)).not.toThrow();
	});
});
