/**
 * The interface's four duration forms, each with exactly one home (Requirement 13.7),
 * plus wall-clock time formatting and parsing in an explicit time zone — never the
 * device's (Requirement 1.12).
 *
 * This module is client-safe: no `$env`, no `$app`, nothing from `src/lib/server/`.
 * `offsetMinutesAt` below is intentionally a small duplicate of the technique in
 * `src/lib/server/domain/logical-day.ts` — that module may not be imported from here,
 * and the two must independently agree on what a time-zone offset is, exactly as that
 * module's own comment explains for its relationship with `core/config.ts`.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([0-9]{1,2}):([0-9]{2})$/;

/** The UTC offset, in minutes, of `timeZone` at `instantMs`: `localTime = instant + offset`. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts = dtf.formatToParts(new Date(instantMs));
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
	const hour = get('hour') % 24;
	const asNaiveUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
	return Math.round((asNaiveUtc - instantMs) / 60_000);
}

/** "5:12:08" — the running clock. Hero readout and tab title while a session is open. */
export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function durationParts(seconds: number): { h: number; min: number } {
	const totalMin = Math.round(Math.abs(seconds) / 60);
	return { h: Math.floor(totalMin / 60), min: totalMin % 60 };
}

/** "2 h 14 min" — never a bare decimal. Under a minute renders as "< 1 min". Everywhere else. */
export function formatDuration(seconds: number, _locale: string): string {
	const abs = Math.abs(seconds);
	if (abs === 0) return '0 min';
	if (abs < 60) return '< 1 min';
	const { h, min } = durationParts(seconds);
	return h > 0 ? `${h} h ${String(min).padStart(2, '0')} min` : `${min} min`;
}

/**
 * "14 h 15" — the minute unit dropped, the hour unit kept. Mobile hero and the three
 * mobile timer figures only (Design_Contract Typography: "Durations read as
 * `14 h 15 min`. Mobile drops the unit … `14 h 15`.").
 */
export function formatDurationShort(seconds: number, _locale: string): string {
	const abs = Math.abs(seconds);
	if (abs === 0) return '0 min';
	if (abs < 60) return '< 1 min';
	const { h, min } = durationParts(seconds);
	return h > 0 ? `${h} h ${String(min).padStart(2, '0')}` : `${min} min`;
}

/** "−2 h 00 min" / "+30 min" — signed, for Change_Preview deltas only. */
export function formatDelta(seconds: number, _locale: string): string {
	const abs = Math.abs(seconds);
	const sign = seconds < 0 ? '−' : '+';
	if (abs === 0) return '+0 min';
	if (abs < 60) return `${sign}< 1 min`;
	const { h, min } = durationParts(seconds);
	return h > 0 ? `${sign}${h} h ${String(min).padStart(2, '0')} min` : `${sign}${min} min`;
}

/**
 * Every wall-clock rendering and every parse goes through these, in the SERVER's
 * zone — never the device's. `/api/health` reports it; the root layout loads it once.
 */
export function formatTimeOfDay(t: Date, _locale: string, timeZone: string): string {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		hour: '2-digit',
		minute: '2-digit'
	});
	const parts = dtf.formatToParts(t);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
	return `${get('hour')}:${get('minute')}`;
}

const WEEKDAY_LONG: Record<string, string[]> = {
	cs: ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'],
	en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};
const WEEKDAY_SHORT: Record<string, string[]> = {
	cs: ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'],
	en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
};
const MONTH_GENITIVE_CS = [
	'ledna',
	'února',
	'března',
	'dubna',
	'května',
	'června',
	'července',
	'srpna',
	'září',
	'října',
	'listopadu',
	'prosince'
];
const MONTH_EN = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

function localeKey(locale: string): 'cs' | 'en' {
	return locale.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

/** Days since the Unix epoch for a YYYY-MM-DD date — pure calendar arithmetic, no zone. */
function dayIndex(date: string): { y: number; m: number; d: number; weekday: number } {
	const match = DATE_RE.exec(date);
	if (!match) throw new RangeError(`invalid date: ${JSON.stringify(date)}`);
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return { y, m, d, weekday };
}

/**
 * `relative` gives `dnes` / `včera` and otherwise falls through to `long`; `long`
 * gives `pátek 21. srpna`; `short` gives `pá 21.` — three call sites that each wanted
 * something else, which is why this is one function with a `form` rather than three.
 */
export function formatDayLabel(
	date: string,
	locale: string,
	today: string,
	form: 'relative' | 'long' | 'short' = 'relative'
): string {
	const lang = localeKey(locale);
	if (form === 'relative') {
		if (date === today) return lang === 'cs' ? 'dnes' : 'today';
		const { y, m, d } = dayIndex(today);
		const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
		if (date === yesterday) return lang === 'cs' ? 'včera' : 'yesterday';
		return formatDayLabel(date, locale, today, 'long');
	}
	const { d, weekday } = dayIndex(date);
	const { m } = dayIndex(date);
	if (form === 'short') {
		return lang === 'cs' ? `${WEEKDAY_SHORT.cs[weekday]} ${d}.` : `${WEEKDAY_SHORT.en[weekday]} ${d}`;
	}
	return lang === 'cs'
		? `${WEEKDAY_LONG.cs[weekday]} ${d}. ${MONTH_GENITIVE_CS[m - 1]}`
		: `${WEEKDAY_LONG.en[weekday]} ${MONTH_EN[m - 1]} ${d}`;
}

/**
 * Parses "HH:MM", entered against `date` in `timeZone`, into the UTC instant it
 * denotes. Two passes: a first guess from the naive UTC reading of the wall-clock
 * value, then a correction from the offset actually in effect near that guess — which
 * only iterates twice because a time zone's offset does not change within the minute
 * spanned by the correction, except inside a DST gap or fold the user typed into by
 * hand, which this function does not attempt to disambiguate further.
 */
export function parseTimeOfDay(text: string, date: string, timeZone: string): Date {
	const timeMatch = TIME_RE.exec(text.trim());
	if (!timeMatch) throw new RangeError(`invalid time: ${JSON.stringify(text)}`);
	const dateMatch = DATE_RE.exec(date);
	if (!dateMatch) throw new RangeError(`invalid date: ${JSON.stringify(date)}`);
	const [, ys, ms, ds] = dateMatch;
	const [, hs, mins] = timeMatch;
	const y = Number(ys);
	const mo = Number(ms);
	const d = Number(ds);
	const h = Number(hs);
	const min = Number(mins);
	if (h > 23 || min > 59) throw new RangeError(`invalid time: ${JSON.stringify(text)}`);

	const naiveUtcMs = Date.UTC(y, mo - 1, d, h, min, 0);
	let instantMs = naiveUtcMs - offsetMinutesAt(naiveUtcMs, timeZone) * 60_000;
	instantMs = naiveUtcMs - offsetMinutesAt(instantMs, timeZone) * 60_000;
	return new Date(instantMs);
}
