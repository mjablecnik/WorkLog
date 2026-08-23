/**
 * The `Auth_Hook` and everything that runs before it. Each handle is exported
 * individually so it can be unit tested; `handle` composes them in the fixed order
 * design component 7 specifies.
 *
 * Two kinds of startup failure, handled two different ways: bad configuration is
 * caught synchronously by `loadConfig()`/`getConfig()` at module load — logged in
 * full and the process exits non-zero, since no request could ever be answered
 * correctly. An unmigrated database or a disagreeing Day_Boundary_Config is
 * asynchronous, so the process keeps running and `handleReadiness` answers 503
 * SERVICE_UNAVAILABLE until `scripts/migrate.sh` or the environment is fixed.
 */
import { readdirSync } from 'node:fs';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import {
	CLEANUP_INTERVAL_MINUTES,
	IDEMPOTENCY_RETENTION_HOURS,
	MAX_BODY_BYTES,
	SERVICE_RETRY_AFTER_SECONDS,
	getConfig
} from '$lib/server/core/config';
import { resolveRequestId } from '$lib/server/core/request-id';
import { logger } from '$lib/server/core/logger';
import {
	applyBaseSecurityHeaders,
	resolveRenderTheme,
	substitutePagePlaceholders,
	type Theme
} from '$lib/server/core/security-headers';
import { createDayResolver } from '$lib/server/domain/logical-day';
import { checkLoginLimit, checkRequestLimit, sweepRateLimits } from '$lib/server/core/rate-limit';
import {
	clientAddress,
	hashSessionToken,
	safeRedirectTarget,
	secretsMatch,
	SESSION_COOKIE
} from '$lib/server/core/auth';
import { withReadTx, withTx } from '$lib/server/store/tx';
import {
	deleteAuthSession,
	findAuthSession,
	purgeExpiredAuthSessions
} from '$lib/server/store/auth-sessions';
import { readDayBoundaryConfig, writeDayBoundaryConfig } from '$lib/server/store/day-boundary';
import { purgeIdempotencyKeys } from '$lib/server/store/idempotency';
import { apiError, errorResponse } from '$lib/server/core/errors';

export type AuthResult = { kind: 'browser' } | { kind: 'token' } | { kind: 'none' };

const config = getConfig();
const dayResolver = createDayResolver(config.timezone, config.dayStartHour);

const SUPPORTED_LOCALES = ['cs', 'en'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function isSupportedLocale(value: string): value is Locale {
	return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Reads every migration filename this image ships, sorted — the readiness probe's
 *  authority for "is the database fully migrated". */
function shippedMigrationFilenames(): string[] {
	try {
		return readdirSync('migrations')
			.filter((f) => f.endsWith('.sql'))
			.sort();
	} catch {
		return [];
	}
}

/**
 * True once the database is reachable, every shipped migration is applied, and the
 * stored Day_Boundary_Config agrees with the environment (writing it when absent).
 * Re-evaluated at most once per CLEANUP_INTERVAL_MINUTES while it keeps failing.
 */
async function probeReadiness(): Promise<{ ready: boolean; reason?: string }> {
	try {
		const applied = await withReadTx((tx) =>
			tx.execute(sql`select filename from schema_migrations`)
		);
		const appliedSet = new Set(
			(applied as unknown as { filename: string }[]).map((r) => r.filename)
		);
		const shipped = shippedMigrationFilenames();
		const missing = shipped.filter((f) => !appliedSet.has(f));
		if (missing.length > 0) {
			return { ready: false, reason: `unapplied migrations: ${missing.join(', ')}` };
		}

		const boundary = await withTx((tx) => readDayBoundaryConfig(tx));
		if (boundary === null) {
			await withTx((tx) =>
				writeDayBoundaryConfig(tx, { timezone: config.timezone, dayStartHour: config.dayStartHour })
			);
			return { ready: true };
		}
		const disagrees =
			boundary.timezone !== config.timezone || boundary.dayStartHour !== config.dayStartHour;
		if (disagrees) {
			if (config.allowDayBoundaryChange) {
				logger.warn('overwriting Day_Boundary_Config', {
					from: boundary,
					to: { timezone: config.timezone, dayStartHour: config.dayStartHour }
				});
				await withTx((tx) =>
					writeDayBoundaryConfig(tx, {
						timezone: config.timezone,
						dayStartHour: config.dayStartHour
					})
				);
				return { ready: true };
			}
			return {
				ready: false,
				reason: `Day_Boundary_Config disagrees with the environment (stored ${boundary.timezone}/${boundary.dayStartHour}, configured ${config.timezone}/${config.dayStartHour})`
			};
		}
		return { ready: true };
	} catch (err) {
		return { ready: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

let readinessPromise: Promise<{ ready: boolean; reason?: string }> | null = null;
let readinessCheckedAt = 0;

/** Re-runs the probe at most once per CLEANUP_INTERVAL_MINUTES while it is failing. */
async function getReadiness(): Promise<{ ready: boolean; reason?: string }> {
	const now = Date.now();
	if (readinessPromise === null || now - readinessCheckedAt > CLEANUP_INTERVAL_MINUTES * 60_000) {
		readinessCheckedAt = now;
		readinessPromise = probeReadiness();
		const result = await readinessPromise;
		if (!result.ready) readinessPromise = null; // force a fresh probe next time
		return result;
	}
	return readinessPromise;
}

let lastSweepAt = 0;
function maybeSweep(now: number): void {
	if (now - lastSweepAt < CLEANUP_INTERVAL_MINUTES * 60_000) return;
	lastSweepAt = now;
	sweepRateLimits(now, config.rateLimitPerMinute);
	void withTx((tx) => purgeExpiredAuthSessions(tx, new Date(now))).catch((err) =>
		logger.error('sweep: purge expired auth sessions failed', { error: String(err) })
	);
	void withTx((tx) =>
		purgeIdempotencyKeys(tx, new Date(now - IDEMPOTENCY_RETENTION_HOURS * 3_600_000))
	).catch((err) => logger.error('sweep: purge idempotency keys failed', { error: String(err) }));
}

export const handleRequestId: Handle = async ({ event, resolve }) => {
	const requestId = resolveRequestId(event.request.headers);
	event.locals.requestId = requestId;
	const response = await resolve(event);
	response.headers.set('x-request-id', requestId);
	return response;
};

export const handleReadiness: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/api/health') return resolve(event);
	const { ready, reason } = await getReadiness();
	if (!ready) {
		logger.warn('service not ready', { requestId: event.locals.requestId, reason });
		return errorResponse(
			apiError('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.', {
				retryAfterSeconds: SERVICE_RETRY_AFTER_SECONDS
			}),
			event.locals.requestId
		);
	}
	maybeSweep(Date.now());
	return resolve(event);
};

export const handleRequestLog: Handle = async ({ event, resolve }) => {
	const start = Date.now();
	const response = await resolve(event);
	logger.info('request', {
		requestId: event.locals.requestId,
		method: event.request.method,
		path: event.url.pathname,
		status: response.status,
		durationMs: Date.now() - start
	});
	return response;
};

/** Locale, in order: the `worklog_locale` cookie, else Accept-Language, else `cs`. */
function resolveLocale(event: RequestEvent): Locale {
	const cookie = event.cookies.get('worklog_locale');
	if (cookie !== undefined && isSupportedLocale(cookie)) return cookie;

	const header = event.request.headers.get('accept-language');
	if (header !== null) {
		const weighted = header
			.split(',')
			.map((part) => {
				const [tag, qPart] = part.trim().split(';q=');
				const q = qPart !== undefined ? Number(qPart) : 1;
				return { tag: tag.trim().slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 1 };
			})
			.sort((a, b) => b.q - a.q);
		for (const { tag } of weighted) {
			if (isSupportedLocale(tag)) return tag;
		}
	}
	return 'cs';
}

export const handleLocals: Handle = async ({ event, resolve }) => {
	const now = new Date();
	const date = dayResolver.dateOf(now);
	event.locals.today = { date, bounds: dayResolver.bounds(date) };
	event.locals.locale = resolveLocale(event);

	const preference = event.cookies.get('worklog_theme');
	const theme: 'dark' | 'light' | 'system' =
		preference === 'light' || preference === 'dark' ? preference : 'system';
	event.locals.theme = theme;

	return resolve(event);
};

export const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const isPage = !event.url.pathname.startsWith('/api');
	// Resolved from the same two cookies handleLocals read `locals.theme`'s preference
	// from — called again here rather than smuggled through locals, since App.Locals
	// carries only the preference (`system` | `light` | `dark`), never the resolved
	// render value; `%theme%` is the one place that resolved value is ever needed.
	const renderTheme = resolveRenderTheme(
		event.cookies.get('worklog_theme'),
		event.cookies.get('worklog_theme_resolved')
	);
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			substitutePagePlaceholders(html, event.locals.locale, renderTheme)
	});
	applyBaseSecurityHeaders(response, config.appEnv === 'production');
	if (!isPage) {
		// The CSP is set by kit.csp on rendered pages only — a JSON response executes
		// nothing, so a policy on it protects nothing (Requirement 12.12).
		response.headers.delete('content-security-policy');
	}
	return response;
};

function matchesOrigin(origin: string, allowed: string[]): boolean {
	return allowed.includes(origin);
}

export const handleCors: Handle = async ({ event, resolve }) => {
	const origin = event.request.headers.get('origin');
	const isPreflight =
		event.request.method === 'OPTIONS' &&
		event.request.headers.get('access-control-request-method') !== null;

	if (isPreflight) {
		const headers = new Headers();
		if (origin !== null && matchesOrigin(origin, config.corsOrigins)) {
			headers.set('access-control-allow-origin', origin);
			headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
			headers.set(
				'access-control-allow-headers',
				'Authorization, Content-Type, Idempotency-Key, X-Request-Id'
			);
			headers.set('access-control-max-age', '600');
			headers.set('access-control-allow-credentials', 'false');
		}
		return new Response(null, { status: 204, headers });
	}

	const response = await resolve(event);
	if (origin !== null && matchesOrigin(origin, config.corsOrigins)) {
		response.headers.set('access-control-allow-origin', origin);
		response.headers.set('access-control-allow-credentials', 'false');
	}
	return response;
};

export const handleRateLimit: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/api/health') return resolve(event);

	const addr = clientAddress(event, config.trustedProxyHops);
	const now = Date.now();

	if (event.url.pathname === '/login' && event.request.method === 'POST') {
		const result = checkLoginLimit(addr, now);
		if (!result.allowed) {
			return errorResponse(
				apiError('RATE_LIMITED', 'Too many requests. Try again shortly.', {
					retryAfterSeconds: result.retryAfterSeconds,
					scope: 'login'
				}),
				event.locals.requestId
			);
		}
	}

	const result = checkRequestLimit(addr, config.rateLimitPerMinute, now);
	if (!result.allowed) {
		return errorResponse(
			apiError('RATE_LIMITED', 'Too many requests. Try again shortly.', {
				retryAfterSeconds: result.retryAfterSeconds,
				scope: 'request'
			}),
			event.locals.requestId
		);
	}
	return resolve(event);
};

/** Looks a Browser_Session cookie up through withReadTx — never the write lock. */
export async function authenticate(event: RequestEvent): Promise<AuthResult> {
	const bearer = event.request.headers.get('authorization');
	if (bearer !== null && bearer.startsWith('Bearer ')) {
		const token = bearer.slice('Bearer '.length);
		if (secretsMatch(token, config.apiToken)) return { kind: 'token' };
	}

	// A Browser_Session cookie is never valid cross-origin: SameSite=Strict already
	// keeps the browser from sending it, and this is a second, explicit check.
	const origin = event.request.headers.get('origin');
	const isCrossOrigin =
		origin !== null && origin !== config.publicOrigin && config.appEnv === 'production';
	if (isCrossOrigin) return { kind: 'none' };

	const cookieValue = event.cookies.get(SESSION_COOKIE);
	if (cookieValue === undefined) return { kind: 'none' };
	const tokenHash = hashSessionToken(cookieValue);
	const session = await withReadTx((tx) => findAuthSession(tx, tokenHash));
	if (session === null) return { kind: 'none' };
	if (session.expiresAt.getTime() <= Date.now()) {
		void withTx((tx) => deleteAuthSession(tx, tokenHash)).catch(() => undefined);
		return { kind: 'none' };
	}
	return { kind: 'browser' };
}

const STATIC_ASSET_PREFIXES = ['/_app/', '/favicon', '/fonts/'];

function isStaticAsset(pathname: string): boolean {
	return STATIC_ASSET_PREFIXES.some((p) => pathname.startsWith(p));
}

export const handleAuth: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	const exempt =
		pathname === '/api/health' ||
		pathname === '/login' ||
		pathname === '/logout' ||
		isStaticAsset(pathname);

	if (exempt) {
		event.locals.auth = { kind: 'none' };
		return resolve(event);
	}

	const auth = await authenticate(event);
	event.locals.auth = auth;

	if (auth.kind === 'none') {
		if (pathname.startsWith('/api')) {
			return errorResponse(
				apiError('UNAUTHORIZED', 'You must be signed in to do that.'),
				event.locals.requestId
			);
		}
		const next = encodeURIComponent(pathname + event.url.search);
		return new Response(null, { status: 303, headers: { location: `/login?next=${next}` } });
	}

	return resolve(event);
};

/** Enforces MAX_BODY_BYTES while the request stream is being read (Requirement 12.6). */
function withBodySizeLimit(request: Request): Request {
	if (request.body === null) return request;
	let seen = 0;
	const limited = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			seen += chunk.byteLength;
			if (seen > MAX_BODY_BYTES) {
				controller.error(new Error('PAYLOAD_TOO_LARGE'));
				return;
			}
			controller.enqueue(chunk);
		}
	});
	const body = request.body.pipeThrough(limited);
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body,
		// @ts-expect-error -- duplex is required by undici for a streamed body but not
		// yet in the DOM lib types this project compiles against.
		duplex: 'half'
	});
}

export const handleBodySizeLimit: Handle = async ({ event, resolve }) => {
	const contentLength = event.request.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
		return errorResponse(
			apiError('PAYLOAD_TOO_LARGE', 'The request body is too large.', { maxBytes: MAX_BODY_BYTES }),
			event.locals.requestId
		);
	}
	event.request = withBodySizeLimit(event.request);
	try {
		return await resolve(event);
	} catch (err) {
		if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
			return errorResponse(
				apiError('PAYLOAD_TOO_LARGE', 'The request body is too large.', {
					maxBytes: MAX_BODY_BYTES
				}),
				event.locals.requestId
			);
		}
		throw err;
	}
};

export const handle = sequence(
	handleRequestId,
	handleReadiness,
	handleRequestLog,
	handleLocals,
	handleSecurityHeaders,
	handleCors,
	handleBodySizeLimit,
	handleRateLimit,
	handleAuth
);
