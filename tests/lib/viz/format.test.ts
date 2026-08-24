/**
 * Task 1.14. Runs under the `domain` Vitest project (node), per `vitest.config.ts`'s
 * explicit `tests/lib/viz/**` include.
 *
 * `formatDuration`/`formatDurationShort`/`formatDelta` all take a `_locale` parameter
 * they currently ignore — the "h"/"min" units are locale-invariant by design (source
 * comment: "never a bare decimal"), so the "both locales" tests below assert the two
 * locale arguments produce IDENTICAL output, which is the real, documented behavior —
 * not a bug to route around. `formatDayLabel` is the one function here that genuinely
 * localizes, and is tested with both locale arguments producing DIFFERENT strings.
 */
import { describe, expect, it } from 'vitest';
import {
	formatClock,
	formatDayLabel,
	formatDelta,
	formatDuration,
	formatDurationShort,
	formatTimeOfDay,
	parseTimeOfDay
} from '../../../src/lib/viz/format';

const LOCALES = ['cs', 'en'];

describe('formatClock', () => {
	it('renders h:mm:ss, zero-padded past the hour', () => {
		expect(formatClock(0)).toBe('0:00:00');
		expect(formatClock(3688)).toBe('1:01:28'); // 1h 1m 28s
	});

	it('never goes negative', () => {
		expect(formatClock(-5)).toBe('0:00:00');
	});
});

describe('formatDuration', () => {
	it('renders 0 min for zero, in both locales', () => {
		for (const locale of LOCALES) expect(formatDuration(0, locale)).toBe('0 min');
	});

	it('renders "< 1 min" under a minute, in both locales', () => {
		for (const locale of LOCALES) expect(formatDuration(30, locale)).toBe('< 1 min');
	});

	it('renders hours and minutes over a day, in both locales', () => {
		// 90000s = 1500 min = 25h 00min
		for (const locale of LOCALES) expect(formatDuration(90000, locale)).toBe('25 h 00 min');
	});

	it('drops the hour unit under an hour', () => {
		expect(formatDuration(600, 'en')).toBe('10 min'); // 10 min, no hours
	});

	it('is identical regardless of the locale argument (units are locale-invariant)', () => {
		for (const seconds of [0, 30, 600, 5400, 90000]) {
			expect(formatDuration(seconds, 'cs')).toBe(formatDuration(seconds, 'en'));
		}
	});
});

describe('formatDurationShort', () => {
	it('drops "min" but keeps "h" when there is at least one hour', () => {
		expect(formatDurationShort(90000, 'en')).toBe('25 h 00'); // no "min" suffix
	});

	it('keeps "min" when there is no hour', () => {
		expect(formatDurationShort(600, 'en')).toBe('10 min');
	});

	it('handles zero and under-a-minute like the long form', () => {
		expect(formatDurationShort(0, 'en')).toBe('0 min');
		expect(formatDurationShort(30, 'en')).toBe('< 1 min');
	});

	it('is identical regardless of the locale argument', () => {
		for (const seconds of [0, 30, 600, 90000]) {
			expect(formatDurationShort(seconds, 'cs')).toBe(formatDurationShort(seconds, 'en'));
		}
	});
});

describe('formatDelta', () => {
	it('signs a positive delta with +', () => {
		expect(formatDelta(1800, 'en')).toBe('+30 min');
	});

	it('signs a negative delta with the true minus sign', () => {
		expect(formatDelta(-7200, 'en')).toBe('−2 h 00 min');
	});

	it('treats zero as +0 min, not signed either way', () => {
		expect(formatDelta(0, 'en')).toBe('+0 min');
	});

	it('is identical regardless of the locale argument', () => {
		for (const seconds of [0, -30, 1800, -7200]) {
			expect(formatDelta(seconds, 'cs')).toBe(formatDelta(seconds, 'en'));
		}
	});
});

describe('formatTimeOfDay — server zone, not the device zone', () => {
	// A January instant (outside any DST transition, in either zone) so the offsets
	// used below are unambiguous: Europe/Prague is UTC+1 (CET), America/New_York is
	// UTC-5 (EST).
	const instant = new Date(Date.UTC(2026, 0, 15, 12, 0)); // 12:00 UTC

	it('renders the SAME instant differently depending on the explicit timeZone argument', () => {
		const prague = formatTimeOfDay(instant, 'en', 'Europe/Prague');
		const newYork = formatTimeOfDay(instant, 'en', 'America/New_York');

		expect(prague).toBe('13:00');
		expect(newYork).toBe('07:00');
		expect(prague).not.toBe(newYork);
	});

	it('is controlled entirely by the timeZone argument, not any ambient/device zone', () => {
		// UTC itself, as a sanity anchor.
		expect(formatTimeOfDay(instant, 'en', 'UTC')).toBe('12:00');
	});
});

describe('formatDayLabel', () => {
	const today = '2026-06-15';
	const yesterday = '2026-06-14';

	it('says "today"/"dnes" for the current Logical_Day, per locale', () => {
		expect(formatDayLabel(today, 'cs', today, 'relative')).toBe('dnes');
		expect(formatDayLabel(today, 'en', today, 'relative')).toBe('today');
	});

	it('says "yesterday"/"včera" for one day back, per locale', () => {
		expect(formatDayLabel(yesterday, 'cs', today, 'relative')).toBe('včera');
		expect(formatDayLabel(yesterday, 'en', today, 'relative')).toBe('yesterday');
	});

	it('genuinely localizes: cs and en differ for the same date/form', () => {
		expect(formatDayLabel(today, 'cs', today, 'relative')).not.toBe(
			formatDayLabel(today, 'en', today, 'relative')
		);
		expect(formatDayLabel(yesterday, 'cs', today, 'relative')).not.toBe(
			formatDayLabel(yesterday, 'en', today, 'relative')
		);
	});

	it('falls through to the long form for any other date', () => {
		// 2026-06-10 is a Wednesday.
		expect(formatDayLabel('2026-06-10', 'en', today, 'relative')).toBe('Wednesday June 10');
		expect(formatDayLabel('2026-06-10', 'cs', today, 'relative')).toBe('středa 10. června');
	});

	it('short form drops the weekday name to its abbreviation', () => {
		expect(formatDayLabel('2026-06-10', 'en', today, 'short')).toBe('Wed 10');
		expect(formatDayLabel('2026-06-10', 'cs', today, 'short')).toBe('st 10.');
	});
});

describe('parseTimeOfDay <-> formatTimeOfDay round trip', () => {
	const date = '2026-01-15'; // outside DST in both test zones
	const tz = 'Europe/Prague'; // UTC+1 in January

	it.each(['00:00', '09:05', '13:00', '23:59'])('round-trips %s', (time) => {
		const parsed = parseTimeOfDay(time, date, tz);
		expect(formatTimeOfDay(parsed, 'en', tz)).toBe(time);
	});

	it('parses against the given zone, not any ambient zone', () => {
		const parsed = parseTimeOfDay('13:00', date, tz);
		// 13:00 CET (UTC+1) is 12:00 UTC.
		expect(parsed.getTime()).toBe(Date.UTC(2026, 0, 15, 12, 0));
	});
});
