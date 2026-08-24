/**
 * The single error envelope every failing request answers with:
 * `{ error, message, messageKey, requestId, details }`. `error` is the UPPER_SNAKE_CASE
 * code, `message` is an English sentence for whoever is reading a shell script's
 * output, `messageKey` is the Paraglide key the interface renders instead, and
 * `details` is optional and code-specific.
 */
import type { z } from 'zod';
import { logger } from './logger';
import { MAX_BODY_BYTES } from './config';

export type ErrorCode =
	| 'VALIDATION_ERROR'
	| 'INVALID_INTERVAL'
	| 'AMBIGUOUS_MODE'
	| 'RANGE_TOO_LARGE'
	| 'UNAUTHORIZED'
	| 'NOT_FOUND'
	| 'SESSION_ALREADY_RUNNING'
	| 'NO_SESSION_RUNNING'
	| 'SESSION_OVERLAP'
	| 'ACTIVITY_OVERLAP'
	| 'OUTSIDE_TRACKED_TIME'
	| 'NO_PLACEMENT_ANCHOR'
	| 'NOTHING_TO_LOG'
	| 'PROJECT_EXISTS'
	| 'PROJECT_IN_USE'
	| 'PROJECT_ARCHIVED'
	| 'FUTURE_TIMESTAMP'
	| 'INTERVAL_TOO_SHORT'
	| 'STALE_PREVIEW'
	| 'IDEMPOTENCY_KEY_REUSED'
	| 'METHOD_NOT_ALLOWED'
	| 'PAYLOAD_TOO_LARGE'
	| 'RATE_LIMITED'
	| 'SERVICE_UNAVAILABLE'
	| 'INTERNAL_ERROR';

const STATUS_FOR_CODE: Record<ErrorCode, number> = {
	VALIDATION_ERROR: 400,
	INVALID_INTERVAL: 400,
	AMBIGUOUS_MODE: 400,
	RANGE_TOO_LARGE: 400,
	UNAUTHORIZED: 401,
	NOT_FOUND: 404,
	SESSION_ALREADY_RUNNING: 409,
	NO_SESSION_RUNNING: 409,
	SESSION_OVERLAP: 409,
	ACTIVITY_OVERLAP: 409,
	OUTSIDE_TRACKED_TIME: 409,
	NO_PLACEMENT_ANCHOR: 409,
	NOTHING_TO_LOG: 409,
	PROJECT_EXISTS: 409,
	PROJECT_IN_USE: 409,
	PROJECT_ARCHIVED: 400,
	FUTURE_TIMESTAMP: 400,
	INTERVAL_TOO_SHORT: 400,
	STALE_PREVIEW: 409,
	IDEMPOTENCY_KEY_REUSED: 409,
	METHOD_NOT_ALLOWED: 405,
	PAYLOAD_TOO_LARGE: 413,
	RATE_LIMITED: 429,
	SERVICE_UNAVAILABLE: 503,
	INTERNAL_ERROR: 500
};

/** The one place the ErrorCode -> messageKey mapping lives — a lookup, never computed. */
const MESSAGE_KEY_FOR_CODE: Record<ErrorCode, string> = {
	VALIDATION_ERROR: 'errors_validation_error',
	INVALID_INTERVAL: 'errors_invalid_interval',
	AMBIGUOUS_MODE: 'errors_ambiguous_mode',
	RANGE_TOO_LARGE: 'errors_range_too_large',
	UNAUTHORIZED: 'errors_unauthorized',
	NOT_FOUND: 'errors_not_found',
	SESSION_ALREADY_RUNNING: 'errors_session_already_running',
	NO_SESSION_RUNNING: 'errors_no_session_running',
	SESSION_OVERLAP: 'errors_session_overlap',
	ACTIVITY_OVERLAP: 'errors_activity_overlap',
	OUTSIDE_TRACKED_TIME: 'errors_outside_tracked_time',
	NO_PLACEMENT_ANCHOR: 'errors_no_placement_anchor',
	NOTHING_TO_LOG: 'errors_nothing_to_log',
	PROJECT_EXISTS: 'errors_project_exists',
	PROJECT_IN_USE: 'errors_project_in_use',
	PROJECT_ARCHIVED: 'errors_project_archived',
	FUTURE_TIMESTAMP: 'errors_future_timestamp',
	INTERVAL_TOO_SHORT: 'errors_interval_too_short',
	STALE_PREVIEW: 'errors_stale_preview',
	IDEMPOTENCY_KEY_REUSED: 'errors_idempotency_key_reused',
	METHOD_NOT_ALLOWED: 'errors_method_not_allowed',
	PAYLOAD_TOO_LARGE: 'errors_payload_too_large',
	RATE_LIMITED: 'errors_rate_limited',
	SERVICE_UNAVAILABLE: 'errors_service_unavailable',
	INTERNAL_ERROR: 'errors_internal_error'
};

export class ApiError extends Error {
	readonly status: number;
	readonly code: ErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

/** Convenience constructor that fills `status` from the code's fixed table entry. */
export function apiError(
	code: ErrorCode,
	message: string,
	details?: Record<string, unknown>
): ApiError {
	return new ApiError(STATUS_FOR_CODE[code], code, message, details);
}

/** The one place the mapping lives. Enumerated in the table below, never computed. */
export function messageKeyFor(code: ErrorCode): string {
	return MESSAGE_KEY_FOR_CODE[code];
}

/**
 * Per-field message key for a Zod issue (Requirement 12.34). A schema's own `message`
 * is an English sentence and the interface may not put English on screen, so a field
 * error needs a key of its own. The mapping is by issue code, with a small set of
 * path-specific overrides where the generic sentence would be useless.
 */
export function fieldMessageKeyFor(issue: z.core.$ZodIssue): string {
	const path = issue.path.join('.');
	if (path === 'startedAt' || path === 'endedAt') {
		if (issue.code === 'custom') return 'fields_bounds_together';
	}
	if (path === 'date' && issue.code === 'custom') {
		// Two different `date`-field refinements share this path and issue code: the
		// calendar-validity check on `dateString` itself (`schemas.ts`'s
		// `isRealCalendarDate`) and the object-level "date required when a duration is
		// given" rule. They are told apart by message, since Zod gives every `.refine()`
		// issue the same generic `custom` code.
		if ('message' in issue && issue.message === 'must be a real calendar date') {
			return 'fields_invalid_date';
		}
		return 'fields_date_required_for_duration';
	}

	switch (issue.code) {
		case 'invalid_type':
			return issue.input === undefined ? 'fields_required' : 'fields_wrong_type';
		case 'too_small':
			return issue.origin === 'string' ? 'fields_too_short' : 'fields_too_small';
		case 'too_big':
			return issue.origin === 'string' ? 'fields_too_long' : 'fields_too_large';
		case 'invalid_format':
			if (issue.format === 'uuid') return 'fields_invalid_id';
			if (issue.format === 'datetime') return 'fields_invalid_timestamp';
			// `regex` format is shared by `dateString` (schemas.ts) and by the unrelated
			// `Idempotency-Key` shape — both raw strings validated outside any object, so
			// `issue.path` cannot tell them apart (both are '(root)'). The regex source
			// itself can: only `dateString`'s pattern means "not shaped like a date".
			if (issue.format === 'regex' && issue.pattern === '/^\\d{4}-\\d{2}-\\d{2}$/') {
				return 'fields_invalid_date';
			}
			return 'fields_invalid';
		case 'invalid_value':
			return 'fields_invalid_choice';
		case 'unrecognized_keys':
			return 'fields_unknown';
		default:
			return 'fields_invalid';
	}
}

/** Turns a ZodError into the `details.fields` map the envelope carries (Req 12.34). */
export function fieldsFromZodError(
	error: z.ZodError
): Record<string, { reason: string; value?: unknown }> {
	const fields: Record<string, { reason: string; value?: unknown }> = {};
	for (const issue of error.issues) {
		const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
		if (key in fields) continue; // first issue per field wins
		fields[key] = {
			reason: fieldMessageKeyFor(issue),
			value: 'input' in issue ? issue.input : undefined
		};
	}
	return fields;
}

export function apiErrorFromZodError(error: z.ZodError): ApiError {
	return apiError('VALIDATION_ERROR', 'The request could not be validated.', {
		fields: fieldsFromZodError(error)
	});
}

/**
 * Parses `data` against `schema` and throws the standard `VALIDATION_ERROR` ApiError
 * on failure. Every route calls this rather than `schema.parse`/`safeParse` directly,
 * so `reportInput: true` — which `fieldMessageKeyFor` needs to tell a missing field
 * from a wrong-type one — is set in exactly one place.
 */
export function parseRequest<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
	const result = schema.safeParse(data, { reportInput: true });
	if (!result.success) throw apiErrorFromZodError(result.error);
	return result.data;
}

/**
 * Reads a request body as JSON, treating an empty body as `{}` — every request schema
 * in this project has every field optional or defaulted, so a bare `POST` with no body
 * (starting a timer "now", for instance) is a valid request, not a parse failure.
 * Malformed JSON becomes the standard `VALIDATION_ERROR` (Requirement 12.4).
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
	const raw = await request.text();
	if (raw.length === 0) return {};
	try {
		return JSON.parse(raw);
	} catch {
		throw apiError('VALIDATION_ERROR', 'The request body is not valid JSON.');
	}
}

/**
 * Throws `FUTURE_TIMESTAMP` when `value` lies more than `toleranceSeconds` past `now`
 * (Requirements 1.13, 4.10). Shared by the session routes and the activity services,
 * which is why the tolerance travels as a parameter rather than being read from
 * `$env` here — this module stays free of that dependency.
 */
export function assertNotTooFarInFuture(
	field: string,
	value: Date,
	now: Date,
	toleranceSeconds: number
): void {
	const maxAllowed = new Date(now.getTime() + toleranceSeconds * 1000);
	if (value.getTime() > maxAllowed.getTime()) {
		throw apiError('FUTURE_TIMESTAMP', 'That lies too far in the future.', {
			field,
			value: value.toISOString(),
			maxAllowed: maxAllowed.toISOString()
		});
	}
}

/**
 * Throws `INVALID_INTERVAL` when `end` does not fall strictly after `start`, else
 * `INTERVAL_TOO_SHORT` when `[start, end)` is shorter than `minIntervalSeconds`. The
 * reversed/equal case is checked first — a negative duration is not a short one.
 */
export function assertIntervalNotTooShort(
	start: Date,
	end: Date,
	minIntervalSeconds: number
): void {
	if (end.getTime() <= start.getTime()) {
		throw apiError('INVALID_INTERVAL', 'The interval is invalid.', {
			start: start.toISOString(),
			end: end.toISOString()
		});
	}
	const actualSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
	if (actualSeconds < minIntervalSeconds) {
		throw apiError('INTERVAL_TOO_SHORT', 'That interval is too short.', {
			minSeconds: minIntervalSeconds,
			actualSeconds
		});
	}
}

export type ErrorBody = {
	error: ErrorCode;
	message: string;
	messageKey: string;
	requestId: string;
	details?: Record<string, unknown>;
};

/**
 * Serializes any thrown value to the standard envelope. An unknown error becomes 500
 * INTERNAL_ERROR; the real cause is logged with the requestId and never placed in the
 * body — no stack traces, no SQL text, no filesystem paths (Requirement 12.3).
 */
export function errorResponse(err: unknown, requestId: string): Response {
	// The streaming body-size guard (`withBodySizeLimit` in hooks.server.ts) errors the
	// request's own ReadableStream with a plain Error rather than an ApiError — a route
	// reading `request.json()`/`request.text()` sees that rejection first, before the
	// hook's own catch ever runs, so it must be classified here too (Requirement 12.15).
	// A `status: 413` on the thrown value is adapter-node's OWN body-size ceiling
	// (`BODY_SIZE_LIMIT`, a `SvelteKitError`) firing ahead of this app's own check —
	// normally never reached in production, where the Dockerfile sets that limit above
	// `MAX_BODY_BYTES`, but still classified correctly rather than leaking as a 500 if
	// some environment leaves it at adapter-node's low default.
	const isBodyTooLarge =
		(err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') ||
		(err instanceof Error && 'status' in err && (err as { status?: unknown }).status === 413);

	const apiErr = err instanceof ApiError
		? err
		: isBodyTooLarge
			? apiError('PAYLOAD_TOO_LARGE', 'The request body is too large.', { maxBytes: MAX_BODY_BYTES })
			: apiError('INTERNAL_ERROR', 'Something went wrong.', undefined);

	if (!(err instanceof ApiError) && !isBodyTooLarge) {
		logger.error('unhandled error', {
			requestId,
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined
		});
	}

	const body: ErrorBody = {
		error: apiErr.code,
		message: apiErr.message,
		messageKey: messageKeyFor(apiErr.code),
		requestId,
		...(apiErr.details !== undefined ? { details: apiErr.details } : {})
	};

	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (apiErr.code === 'RATE_LIMITED' || apiErr.code === 'SERVICE_UNAVAILABLE') {
		const retryAfter = apiErr.details?.retryAfterSeconds;
		if (typeof retryAfter === 'number') headers['retry-after'] = String(retryAfter);
	}
	if (apiErr.code === 'METHOD_NOT_ALLOWED') {
		const allowed = apiErr.details?.allowed;
		if (Array.isArray(allowed)) headers['allow'] = allowed.join(', ');
	}

	return new Response(JSON.stringify(body), { status: apiErr.status, headers });
}
