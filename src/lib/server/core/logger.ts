/**
 * Structured JSON logging to stdout. One line per call, never multi-line, so a log
 * aggregator can parse it without knowing the schema in advance.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Keys whose values are never written to a log line, whatever the caller passes. */
const SECRET_KEYS = new Set([
	'password',
	'passphrase',
	'token',
	'apiToken',
	'apitoken',
	'authorization',
	'sessionToken',
	'sessiontoken',
	'cookie',
	'passphraseHash',
	'tokenHash'
]);

/**
 * Deep-redacts any field whose key looks like a secret, so a call site cannot
 * accidentally leak the API_Token, the login passphrase or a session identifier
 * (Requirement 11.9) by passing an object that happens to carry one.
 */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > 5 || value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (SECRET_KEYS.has(k.toLowerCase())) {
			out[k] = '[redacted]';
		} else {
			out[k] = redact(v, depth + 1);
		}
	}
	return out;
}

// Read LOG_LEVEL directly rather than through loadConfig(): the logger must work even
// when the rest of the configuration is invalid (loadConfig() is what reports that),
// and it must not repeat the DST-transition scan loadConfig() does for every module
// that happens to import this one.
const VALID_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const rawLevel = typeof process !== 'undefined' ? process.env.LOG_LEVEL : undefined;
const minLevel: LogLevel = VALID_LEVELS.includes(rawLevel as LogLevel)
	? (rawLevel as LogLevel)
	: 'info';

function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
	const line = {
		timestamp: new Date().toISOString(),
		level,
		message,
		...(redact(fields) as Record<string, unknown>)
	};
	// eslint-disable-next-line no-console
	console.log(JSON.stringify(line));
}

export const logger = {
	debug: (message: string, fields?: Record<string, unknown>) => log('debug', message, fields),
	info: (message: string, fields?: Record<string, unknown>) => log('info', message, fields),
	warn: (message: string, fields?: Record<string, unknown>) => log('warn', message, fields),
	error: (message: string, fields?: Record<string, unknown>) => log('error', message, fields)
};
