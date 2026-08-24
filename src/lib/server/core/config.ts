/**
 * Environment configuration: validation, defaults and every Fixed_Constant the
 * specification names. This is the one place configuration lives — `tx.ts` imports
 * the advisory lock from here rather than declaring its own copy, and no module
 * repeats any of these numbers.
 *
 * `loadConfig()` validates everything and throws once, listing every problem rather
 * than only the first. The caller (`hooks.server.ts`) is responsible for logging that
 * and exiting non-zero (Requirement 13.24) — `loadConfig()` itself only throws, so it
 * stays testable without killing the process it runs in.
 */
// The `with { type: 'json' }` import attribute is required here: Bun and Vite both
// accept a bare JSON import without it (the app, `bun run dev`/`build`/`preview`,
// never noticed), but a plain Node.js ESM loader — which is what actually executes
// this file transitively when Playwright loads `tests/e2e/*.spec.ts` (import chain:
// spec -> `fixtures.ts` -> `tests/setup/db.ts` -> ... -> this file) — throws
// `TypeError: ... needs an import attribute of "type: json"` without it.
//
// Once the attribute is present, though, Bun switches to strict (spec-conformant)
// JSON-module semantics: a JSON module only ever has a `default` export, never named
// exports synthesized per top-level property — `import { version } from ...` (which
// worked with the bare, non-standard import) throws `does not provide an export
// named 'version'` under Bun once the attribute is added. Importing the default and
// reading `.version` off it satisfies both runtimes' strict semantics at once.
import packageJson from '../../../../package.json' with { type: 'json' };
const packageVersion: string = packageJson.version;
import {
	MAX_INTERVAL_RANGE_DAYS,
	MAX_RANGE_DAYS,
	ACTIVITY_PAGE_SIZE
} from '$lib/contracts/constants';

// Re-exported rather than re-declared — see the module doc comment above.
export { MAX_RANGE_DAYS, MAX_INTERVAL_RANGE_DAYS, ACTIVITY_PAGE_SIZE };

export const ERROR_DETAIL_SAMPLE_SIZE = 10; // conflicting records named in details — Req 3.7
export const FUTURE_TOLERANCE_SECONDS = 300; // clock skew allowance — Req 1.13, 4.10
export const SUGGESTED_WINDOW_COVERAGE = 0.9; // share the suggestion must cover — Req 8.13
export const CLEANUP_INTERVAL_MINUTES = 60; // sweep cadence — Requirements 11.21, 13.30
export const SERVICE_RETRY_AFTER_SECONDS = 5; // Retry-After on 503 — Requirement 12.21
export const LOGIN_ATTEMPT_LIMIT = 5; // Requirement 11.13, deliberately not config
export const LOGIN_ATTEMPT_WINDOW_MINUTES = 15; // Requirement 11.13
export const IDEMPOTENCY_RETENTION_HOURS = 24; // Requirement 12.9
export const SESSION_TOKEN_BYTES = 32; // entropy of a Browser_Session token
export const MAX_BODY_BYTES = 1_048_576; // 1 MiB — Requirement 12.6
export const SHUTDOWN_GRACE_SECONDS = 30; // Requirement 13.5
export const WORKLOG_ADVISORY_LOCK = 4919372001; // the one write lock

/**
 * Substituted for `%theme%` when the cookie says `system` or is absent, so a rendered
 * page never carries the placeholder and never paints the wrong palette before
 * hydration (Requirements 12.28, 12.32).
 */
export const DEFAULT_RENDER_THEME = 'dark' as const;

/** Argon2id parameters for the login passphrase (Requirement 11.6). */
export const ARGON2ID = { algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 } as const;

export type Config = {
	port: number;
	databaseUrl: string;
	apiToken: string;
	passphraseHash: string;
	timezone: string;
	dayStartHour: number;
	gaugeStart: string;
	gaugeEnd: string;
	eveningHour: number;
	allowDayBoundaryChange: boolean;
	corsOrigins: string[];
	trustedProxyHops: number;
	logLevel: 'debug' | 'info' | 'warn' | 'error';
	dbPoolMax: number;
	appEnv: 'development' | 'test' | 'production';
	publicOrigin: string;
	dbQueryTimeoutMs: number;
	rateLimitPerMinute: number;
	sessionDurationHours: number;
	maxOpenSessionHours: number;
	minIntervalSeconds: number;
	version: string;
};

class ConfigError extends Error {
	constructor(readonly problems: string[]) {
		super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
		this.name = 'ConfigError';
	}
}

function toMinutes(hhmm: string): number | null {
	const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
	if (!m) return null;
	const h = Number(m[1]);
	const mi = Number(m[2]);
	if (h > 23 || mi > 59) return null;
	return h * 60 + mi;
}

/**
 * True when the INSTANT `dayStartHour:00` lies inside the Gauge_Gap — the invariant of
 * Requirements 13.14 and 13.15. Minute precision on both sides, because GAUGE_START
 * and GAUGE_END may carry minutes.
 */
export function dayStartIsInGaugeGap(
	c: Pick<Config, 'dayStartHour' | 'gaugeStart' | 'gaugeEnd'>
): boolean {
	const startMin = toMinutes(c.gaugeStart);
	let endMin = toMinutes(c.gaugeEnd);
	if (startMin === null || endMin === null) return false;
	if (endMin <= startMin) endMin += 1440;
	const dayStartMin = c.dayStartHour * 60;
	const inWindow = (p: number) =>
		(p >= startMin && p < endMin) || (p + 1440 >= startMin && p + 1440 < endMin);
	return !inWindow(dayStartMin);
}

/** The UTC offset, in minutes, of `timeZone` at `instant`: `localTime = instant + offset`. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
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
	const parts = dtf.formatToParts(instant);
	const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
	const hour = get('hour') % 24; // "24" at midnight in some locales
	const asNaiveUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		hour,
		get('minute'),
		get('second')
	);
	// `formatToParts` reports whole seconds, so it loses the sub-second component that
	// `instant.getTime()` still carries when `instant` does not fall on a whole second
	// (which the transition-finding binary search below routinely produces). Rounded
	// to the nearest minute, because every real timezone offset is a whole number of
	// minutes; comparing unrounded values with `===` would almost never match two
	// samples of the "same" offset and would silently break the binary search.
	return Math.round((asNaiveUtc - instant.getTime()) / 60000);
}

export type WallClockTransition = {
	/** 'gap': these wall-clock times never occur. 'fold': they occur twice. */
	kind: 'gap' | 'fold';
	/** Naive local wall-clock bounds, expressed as Date.UTC-style milliseconds. */
	localStartMs: number;
	localEndMs: number;
};

/**
 * Finds every DST-style offset transition of `timeZone` within `days` days of `from`,
 * to minute precision, as the wall-clock ranges they make non-existent or ambiguous.
 * Used by both the day-start-hour and the Gauge_Window startup checks.
 */
export function findWallClockTransitions(
	timeZone: string,
	from: Date,
	days: number
): WallClockTransition[] {
	const transitions: WallClockTransition[] = [];
	let prevOffset = offsetMinutesAt(from, timeZone);
	let prevInstant = from.getTime();
	for (let d = 1; d <= days; d++) {
		const t = from.getTime() + d * 86_400_000;
		const offset = offsetMinutesAt(new Date(t), timeZone);
		if (offset !== prevOffset) {
			let lo = prevInstant;
			let hi = t;
			const loOffset = prevOffset;
			while (hi - lo > 1_000) {
				const mid = Math.floor((lo + hi) / 2);
				const midOffset = offsetMinutesAt(new Date(mid), timeZone);
				if (midOffset === loOffset) lo = mid;
				else hi = mid;
			}
			// `hi` is now within a second of the transition instant. Every real timezone
			// transition lands on a whole minute, so round to the nearest one rather than
			// padding by a fixed margin — padding would either miss a candidate exactly on
			// the near boundary or wrongly include one exactly on the far (exclusive) one.
			const roundedHi = Math.round(hi / 60_000) * 60_000;
			const localAtLo = roundedHi + loOffset * 60_000;
			const localAtHi = roundedHi + offset * 60_000;
			transitions.push({
				kind: offset > loOffset ? 'gap' : 'fold',
				localStartMs: Math.min(localAtLo, localAtHi),
				localEndMs: Math.max(localAtLo, localAtHi)
			});
		}
		prevOffset = offset;
		prevInstant = t;
	}
	return transitions;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/**
 * True when `hour:00` fails to exist or is ambiguous on some date in `timeZone`,
 * within the next year from `now` — Requirement 10.13.
 */
export function dayStartHourIsUnsafe(hour: number, timeZone: string, now: Date): boolean {
	const transitions = findWallClockTransitions(timeZone, now, 366);
	for (const t of transitions) {
		// The calendar date the transition range starts on.
		const d = new Date(t.localStartMs);
		const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0);
		if (candidate >= t.localStartMs && candidate < t.localEndMs) return true;
	}
	return false;
}

/**
 * True when the materialised Gauge_Window `[gaugeStart, gaugeEnd)` contains an hour at
 * which `timeZone` changes its offset, within the next year from `now` — Requirement
 * 13.22. Checked directly, not inferred from the gap invariant: `GAUGE_START=00:00`,
 * `GAUGE_END=22:00`, `DAY_START_HOUR=23` satisfies the gap invariant and still
 * contains a transition.
 */
export function gaugeWindowContainsTransition(
	gaugeStart: string,
	gaugeEnd: string,
	timeZone: string,
	now: Date
): boolean {
	const startMin = toMinutes(gaugeStart);
	let endMin = toMinutes(gaugeEnd);
	if (startMin === null || endMin === null) return false;
	if (endMin <= startMin) endMin += 1440;
	const transitions = findWallClockTransitions(timeZone, now, 366);
	for (const t of transitions) {
		const d = new Date(t.localStartMs);
		// Materialise the window on the transition's date and the day before it, since
		// a window ending after midnight belongs partly to the previous date.
		for (const dayOffset of [-1, 0]) {
			const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset);
			const windowStart = base + startMin * 60_000;
			const windowEnd = base + endMin * 60_000;
			if (intervalsOverlap(windowStart, windowEnd, t.localStartMs, t.localEndMs)) return true;
		}
	}
	return false;
}

function isTimezoneLoadable(tz: string): boolean {
	try {
		new Intl.DateTimeFormat(undefined, { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

function parseIntEnv(
	problems: string[],
	name: string,
	raw: string | undefined,
	def: number,
	min: number,
	max: number
): number {
	if (raw === undefined || raw === '') return def;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) {
		problems.push(
			`${name} must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`
		);
		return def;
	}
	return n;
}

// `tasks.md` (component 1.2/13) requires the flag to be read as one of these values,
// case-insensitively, never as mere presence — an operator following that description
// who sets `ALLOW_DAY_BOUNDARY_CHANGE=1` or `=yes` must not be met with a fatal
// configuration error.
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no']);

function parseBooleanEnv(
	problems: string[],
	name: string,
	raw: string | undefined,
	def: boolean
): boolean {
	if (raw === undefined || raw === '') return def;
	const normalized = raw.trim().toLowerCase();
	if (TRUE_ENV_VALUES.has(normalized)) return true;
	if (FALSE_ENV_VALUES.has(normalized)) return false;
	problems.push(
		`${name} must be one of ${[...TRUE_ENV_VALUES, ...FALSE_ENV_VALUES].join(', ')} (case-insensitive), got ${JSON.stringify(raw)}`
	);
	return def;
}

function parseEnum<T extends string>(
	problems: string[],
	name: string,
	raw: string | undefined,
	def: T,
	allowed: readonly T[]
): T {
	if (raw === undefined || raw === '') return def;
	if (!(allowed as readonly string[]).includes(raw)) {
		problems.push(`${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(raw)}`);
		return def;
	}
	return raw as T;
}

/** Validates every environment variable at once and throws listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const problems: string[] = [];
	const now = new Date();

	const appEnv = parseEnum(problems, 'APP_ENV', env.APP_ENV, 'production', [
		'development',
		'test',
		'production'
	] as const);

	const databaseUrl = env.DATABASE_URL ?? '';
	if (databaseUrl.length === 0) problems.push('DATABASE_URL is required and must be non-empty');

	const apiToken = env.WORKLOG_API_TOKEN ?? '';
	if (apiToken.length < 32) problems.push('WORKLOG_API_TOKEN must be at least 32 characters');

	const passphraseHash = env.WORKLOG_PASSPHRASE_HASH ?? '';
	if (!/^\$argon2id\$/.test(passphraseHash)) {
		problems.push('WORKLOG_PASSPHRASE_HASH must be present and a parseable argon2id hash');
	}

	const timezone = env.TIMEZONE ?? 'Europe/Prague';
	if (!isTimezoneLoadable(timezone)) {
		problems.push(`TIMEZONE ${JSON.stringify(timezone)} is not a loadable time zone`);
	}

	const port = parseIntEnv(problems, 'PORT', env.PORT, 3000, 1, 65535);
	const dayStartHour = parseIntEnv(problems, 'DAY_START_HOUR', env.DAY_START_HOUR, 3, 0, 23);
	const eveningHour = parseIntEnv(problems, 'EVENING_HOUR', env.EVENING_HOUR, 21, 0, 23);
	const trustedProxyHops = parseIntEnv(
		problems,
		'TRUSTED_PROXY_HOPS',
		env.TRUSTED_PROXY_HOPS,
		0,
		0,
		8
	);
	const dbQueryTimeoutMs =
		parseIntEnv(problems, 'DB_QUERY_TIMEOUT_SECONDS', env.DB_QUERY_TIMEOUT_SECONDS, 5, 1, 60) *
		1000;
	const dbPoolMax = parseIntEnv(problems, 'DB_POOL_MAX', env.DB_POOL_MAX, 10, 1, 100);
	const rateLimitPerMinute = parseIntEnv(
		problems,
		'RATE_LIMIT_PER_MINUTE',
		env.RATE_LIMIT_PER_MINUTE,
		120,
		1,
		10000
	);
	const sessionDurationHours = parseIntEnv(
		problems,
		'SESSION_DURATION_HOURS',
		env.SESSION_DURATION_HOURS,
		720,
		1,
		8760
	);
	const maxOpenSessionHours = parseIntEnv(
		problems,
		'MAX_OPEN_SESSION_HOURS',
		env.MAX_OPEN_SESSION_HOURS,
		12,
		1,
		24
	);
	const minIntervalSeconds = parseIntEnv(
		problems,
		'MIN_INTERVAL_SECONDS',
		env.MIN_INTERVAL_SECONDS,
		60,
		1,
		3600
	);
	const logLevel = parseEnum(problems, 'LOG_LEVEL', env.LOG_LEVEL, 'info', [
		'debug',
		'info',
		'warn',
		'error'
	] as const);

	const gaugeStart = env.GAUGE_START ?? '06:00';
	const gaugeEnd = env.GAUGE_END ?? '00:00';
	if (toMinutes(gaugeStart) === null) {
		problems.push(`GAUGE_START must be HH:MM, got ${JSON.stringify(gaugeStart)}`);
	}
	if (toMinutes(gaugeEnd) === null) {
		problems.push(`GAUGE_END must be HH:MM, got ${JSON.stringify(gaugeEnd)}`);
	}
	if (toMinutes(gaugeStart) !== null && toMinutes(gaugeEnd) !== null) {
		const startMin = toMinutes(gaugeStart) as number;
		let endMin = toMinutes(gaugeEnd) as number;
		if (endMin <= startMin) endMin += 1440;
		const lengthMin = endMin - startMin;
		if (lengthMin < 60 || lengthMin > 1440) {
			problems.push(
				`GAUGE_START/GAUGE_END must describe a window between 1 and 24 hours long, got ${lengthMin} minutes`
			);
		}
	}

	const allowDayBoundaryChange = parseBooleanEnv(
		problems,
		'ALLOW_DAY_BOUNDARY_CHANGE',
		env.ALLOW_DAY_BOUNDARY_CHANGE,
		false
	);

	let corsOrigins: string[] = [];
	if (env.CORS_ORIGINS !== undefined && env.CORS_ORIGINS !== '') {
		corsOrigins = env.CORS_ORIGINS.split(',')
			.map((o) => o.trim())
			.filter((o) => o.length > 0);
		if (corsOrigins.includes('*') && appEnv !== 'development') {
			problems.push('CORS_ORIGINS must not be a wildcard outside development');
		}
	}

	const publicOrigin = env.PUBLIC_ORIGIN ?? '';
	if (appEnv === 'production' && publicOrigin.length === 0) {
		problems.push('PUBLIC_ORIGIN is required when APP_ENV is production');
	}

	// Gauge_Window invariants, only meaningful once the pieces above parsed cleanly.
	if (
		problems.length === 0 ||
		(toMinutes(gaugeStart) !== null && toMinutes(gaugeEnd) !== null && isTimezoneLoadable(timezone))
	) {
		if (dayStartIsInGaugeGap({ dayStartHour, gaugeStart, gaugeEnd }) === false) {
			problems.push(
				`DAY_START_HOUR (${dayStartHour}) must fall inside the Gauge_Gap for GAUGE_START=${gaugeStart}, GAUGE_END=${gaugeEnd}`
			);
		}
		if (isTimezoneLoadable(timezone)) {
			if (dayStartHourIsUnsafe(dayStartHour, timezone, now)) {
				problems.push(
					`DAY_START_HOUR (${dayStartHour}) names an hour that does not exist or is ambiguous in ${timezone}`
				);
			}
			if (gaugeWindowContainsTransition(gaugeStart, gaugeEnd, timezone, now)) {
				problems.push(
					`the Gauge_Window ${gaugeStart}-${gaugeEnd} contains an hour at which ${timezone} changes offset`
				);
			}
		}
	}

	if (problems.length > 0) throw new ConfigError(problems);

	return {
		port,
		databaseUrl,
		apiToken,
		passphraseHash,
		timezone,
		dayStartHour,
		gaugeStart,
		gaugeEnd,
		eveningHour,
		allowDayBoundaryChange,
		corsOrigins,
		trustedProxyHops,
		logLevel,
		dbPoolMax,
		appEnv,
		publicOrigin,
		dbQueryTimeoutMs,
		rateLimitPerMinute,
		sessionDurationHours,
		maxOpenSessionHours,
		minIntervalSeconds,
		version: packageVersion
	};
}

export { ConfigError };

let cachedConfig: Config | null = null;

/**
 * A memoized `loadConfig()` over the real process environment, for runtime code that
 * just wants the effective configuration and would otherwise re-validate it (DST scan
 * included) on every call. `loadConfig()` itself stays uncached and takes an explicit
 * `env` so tests can probe many configurations without touching this cache.
 */
export function getConfig(): Config {
	if (cachedConfig === null) cachedConfig = loadConfig();
	return cachedConfig;
}

/** Clears the memoized config — tests only, after changing `process.env`. */
export function resetConfigCache(): void {
	cachedConfig = null;
}
