import { describe, expect, it } from 'vitest';
import {
	loadConfig,
	dayStartIsInGaugeGap,
	ConfigError,
	MAX_RANGE_DAYS,
	MAX_INTERVAL_RANGE_DAYS,
	ACTIVITY_PAGE_SIZE,
	ERROR_DETAIL_SAMPLE_SIZE,
	FUTURE_TOLERANCE_SECONDS,
	SUGGESTED_WINDOW_COVERAGE,
	CLEANUP_INTERVAL_MINUTES,
	SERVICE_RETRY_AFTER_SECONDS,
	LOGIN_ATTEMPT_LIMIT,
	LOGIN_ATTEMPT_WINDOW_MINUTES,
	IDEMPOTENCY_RETENTION_HOURS,
	SESSION_TOKEN_BYTES,
	MAX_BODY_BYTES,
	SHUTDOWN_GRACE_SECONDS,
	WORKLOG_ADVISORY_LOCK,
	ARGON2ID
} from '../../../../src/lib/server/core/config';

const VALID_PASSPHRASE_HASH =
	'$argon2id$v=19$m=65536,t=3,p=1$jWLVstK+dpEGHebgQR03THCWFLzW5+fbSP6cOKVAUZU$YIHAbgTXZ0WQ+l5bokL3B08UxSVhy+4QgYVdEwqPXsY';

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
	return {
		DATABASE_URL: 'postgres://localhost/worklog',
		WORKLOG_API_TOKEN: 'a'.repeat(32),
		WORKLOG_PASSPHRASE_HASH: VALID_PASSPHRASE_HASH,
		APP_ENV: 'development',
		...overrides
	};
}

describe('loadConfig', () => {
	it('applies defaults', () => {
		const c = loadConfig(baseEnv());
		expect(c.port).toBe(3000);
		expect(c.timezone).toBe('Europe/Prague');
		expect(c.dayStartHour).toBe(3);
		expect(c.gaugeStart).toBe('06:00');
		expect(c.gaugeEnd).toBe('00:00');
		expect(c.eveningHour).toBe(21);
		expect(c.appEnv).toBe('development');
		expect(c.dbQueryTimeoutMs).toBe(5000);
		expect(c.rateLimitPerMinute).toBe(120);
		expect(c.sessionDurationHours).toBe(720);
		expect(c.maxOpenSessionHours).toBe(12);
		expect(c.minIntervalSeconds).toBe(60);
		expect(c.corsOrigins).toEqual([]);
	});

	it('rejects a missing DATABASE_URL', () => {
		expect(() => loadConfig(baseEnv({ DATABASE_URL: undefined }))).toThrow(ConfigError);
	});

	it('rejects a short WORKLOG_API_TOKEN', () => {
		expect(() => loadConfig(baseEnv({ WORKLOG_API_TOKEN: 'short' }))).toThrow(ConfigError);
	});

	it('rejects a missing WORKLOG_PASSPHRASE_HASH', () => {
		expect(() => loadConfig(baseEnv({ WORKLOG_PASSPHRASE_HASH: undefined }))).toThrow(ConfigError);
	});

	it('rejects DAY_START_HOUR=24', () => {
		expect(() => loadConfig(baseEnv({ DAY_START_HOUR: '24' }))).toThrow(ConfigError);
	});

	it('rejects EVENING_HOUR=24', () => {
		expect(() => loadConfig(baseEnv({ EVENING_HOUR: '24' }))).toThrow(ConfigError);
	});

	it('rejects a bad TIMEZONE', () => {
		expect(() => loadConfig(baseEnv({ TIMEZONE: 'Not/AZone' }))).toThrow(ConfigError);
	});

	it('rejects a wildcard CORS_ORIGINS outside development', () => {
		expect(() =>
			loadConfig(
				baseEnv({ APP_ENV: 'production', PUBLIC_ORIGIN: 'https://x.example', CORS_ORIGINS: '*' })
			)
		).toThrow(ConfigError);
	});

	it('accepts a wildcard CORS_ORIGINS in development', () => {
		const c = loadConfig(baseEnv({ CORS_ORIGINS: '*' }));
		expect(c.corsOrigins).toEqual(['*']);
	});

	it('reports several failures together', () => {
		try {
			loadConfig(
				baseEnv({ DATABASE_URL: undefined, WORKLOG_API_TOKEN: 'short', DAY_START_HOUR: '99' })
			);
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigError);
			const problems = (err as ConfigError).problems;
			expect(problems.length).toBeGreaterThanOrEqual(3);
		}
	});

	it('reads the version from package.json', () => {
		const c = loadConfig(baseEnv());
		expect(c.version).toBe('0.1.0');
	});

	describe('Gauge_Window length', () => {
		it('the default 06:00-00:00 measures 18 hours, not 0', () => {
			expect(() => loadConfig(baseEnv())).not.toThrow();
		});

		it('22:00-02:00 measures 4 hours and is accepted', () => {
			expect(() =>
				loadConfig(baseEnv({ GAUGE_START: '22:00', GAUGE_END: '02:00', DAY_START_HOUR: '3' }))
			).not.toThrow();
		});

		it('rejects a window of 30 minutes', () => {
			expect(() => loadConfig(baseEnv({ GAUGE_START: '06:00', GAUGE_END: '06:30' }))).toThrow(
				ConfigError
			);
		});
	});

	describe('dayStartIsInGaugeGap', () => {
		it('DAY_START_HOUR=3 against the default window passes', () => {
			expect(
				dayStartIsInGaugeGap({ dayStartHour: 3, gaugeStart: '06:00', gaugeEnd: '00:00' })
			).toBe(true);
		});

		it("DAY_START_HOUR=0 also passes — the window is half-open and midnight is the gap's first instant", () => {
			expect(
				dayStartIsInGaugeGap({ dayStartHour: 0, gaugeStart: '06:00', gaugeEnd: '00:00' })
			).toBe(true);
		});

		it('DAY_START_HOUR=12 against the default window is rejected', () => {
			expect(
				dayStartIsInGaugeGap({ dayStartHour: 12, gaugeStart: '06:00', gaugeEnd: '00:00' })
			).toBe(false);
		});

		it('DAY_START_HOUR=6 against GAUGE_START=04:00, GAUGE_END=00:00 is rejected', () => {
			expect(
				dayStartIsInGaugeGap({ dayStartHour: 6, gaugeStart: '04:00', gaugeEnd: '00:00' })
			).toBe(false);
		});
	});

	describe('DST checks in Europe/Prague', () => {
		it('rejects GAUGE_START=00:00, GAUGE_END=22:00, DAY_START_HOUR=23 even though it satisfies the gap invariant', () => {
			expect(
				dayStartIsInGaugeGap({ dayStartHour: 23, gaugeStart: '00:00', gaugeEnd: '22:00' })
			).toBe(true);
			expect(() =>
				loadConfig(
					baseEnv({
						TIMEZONE: 'Europe/Prague',
						GAUGE_START: '00:00',
						GAUGE_END: '22:00',
						DAY_START_HOUR: '23'
					})
				)
			).toThrow(ConfigError);
		});

		it('rejects DAY_START_HOUR=2 in Europe/Prague as non-existent-or-ambiguous', () => {
			expect(() => loadConfig(baseEnv({ TIMEZONE: 'Europe/Prague', DAY_START_HOUR: '2' }))).toThrow(
				ConfigError
			);
		});

		it('accepts DAY_START_HOUR=2 in UTC', () => {
			expect(() => loadConfig(baseEnv({ TIMEZONE: 'UTC', DAY_START_HOUR: '2' }))).not.toThrow();
		});
	});

	it('exports every Fixed_Constant at its specified value', () => {
		expect(MAX_RANGE_DAYS).toBe(366);
		expect(MAX_INTERVAL_RANGE_DAYS).toBe(62);
		expect(ACTIVITY_PAGE_SIZE).toBe(200);
		expect(ERROR_DETAIL_SAMPLE_SIZE).toBe(10);
		expect(FUTURE_TOLERANCE_SECONDS).toBe(300);
		expect(SUGGESTED_WINDOW_COVERAGE).toBe(0.9);
		expect(CLEANUP_INTERVAL_MINUTES).toBe(60);
		expect(SERVICE_RETRY_AFTER_SECONDS).toBe(5);
		expect(LOGIN_ATTEMPT_LIMIT).toBe(5);
		expect(LOGIN_ATTEMPT_WINDOW_MINUTES).toBe(15);
		expect(IDEMPOTENCY_RETENTION_HOURS).toBe(24);
		expect(SESSION_TOKEN_BYTES).toBe(32);
		expect(MAX_BODY_BYTES).toBe(1_048_576);
		expect(SHUTDOWN_GRACE_SECONDS).toBe(30);
		expect(WORKLOG_ADVISORY_LOCK).toBe(4919372001);
		expect(ARGON2ID).toEqual({ algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 });
	});

	describe('numeric ranges enforced at both ends', () => {
		it('rejects PORT=0', () => {
			expect(() => loadConfig(baseEnv({ PORT: '0' }))).toThrow(ConfigError);
		});
		it('rejects DB_QUERY_TIMEOUT_SECONDS=61', () => {
			expect(() => loadConfig(baseEnv({ DB_QUERY_TIMEOUT_SECONDS: '61' }))).toThrow(ConfigError);
		});
		it('rejects MAX_OPEN_SESSION_HOURS=25', () => {
			expect(() => loadConfig(baseEnv({ MAX_OPEN_SESSION_HOURS: '25' }))).toThrow(ConfigError);
		});
		it('rejects TRUSTED_PROXY_HOPS=9', () => {
			expect(() => loadConfig(baseEnv({ TRUSTED_PROXY_HOPS: '9' }))).toThrow(ConfigError);
		});
		it('rejects LOG_LEVEL=verbose', () => {
			expect(() => loadConfig(baseEnv({ LOG_LEVEL: 'verbose' }))).toThrow(ConfigError);
		});
	});

	it('PUBLIC_ORIGIN is required in production', () => {
		expect(() => loadConfig(baseEnv({ APP_ENV: 'production', PUBLIC_ORIGIN: undefined }))).toThrow(
			ConfigError
		);
		expect(() =>
			loadConfig(baseEnv({ APP_ENV: 'production', PUBLIC_ORIGIN: 'https://worklog.example' }))
		).not.toThrow();
	});
});
