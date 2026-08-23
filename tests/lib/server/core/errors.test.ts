import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	ApiError,
	apiError,
	errorResponse,
	fieldMessageKeyFor,
	messageKeyFor,
	type ErrorCode
} from '../../../../src/lib/server/core/errors';

const ALL_CODES: ErrorCode[] = [
	'VALIDATION_ERROR',
	'INVALID_INTERVAL',
	'AMBIGUOUS_MODE',
	'RANGE_TOO_LARGE',
	'UNAUTHORIZED',
	'NOT_FOUND',
	'SESSION_ALREADY_RUNNING',
	'NO_SESSION_RUNNING',
	'SESSION_OVERLAP',
	'ACTIVITY_OVERLAP',
	'OUTSIDE_TRACKED_TIME',
	'NO_PLACEMENT_ANCHOR',
	'NOTHING_TO_LOG',
	'PROJECT_EXISTS',
	'PROJECT_IN_USE',
	'PROJECT_ARCHIVED',
	'FUTURE_TIMESTAMP',
	'INTERVAL_TOO_SHORT',
	'STALE_PREVIEW',
	'IDEMPOTENCY_KEY_REUSED',
	'METHOD_NOT_ALLOWED',
	'PAYLOAD_TOO_LARGE',
	'RATE_LIMITED',
	'SERVICE_UNAVAILABLE',
	'INTERNAL_ERROR'
];

describe('messageKeyFor', () => {
	it('maps every ErrorCode to a distinct key', () => {
		const keys = ALL_CODES.map(messageKeyFor);
		expect(new Set(keys).size).toBe(ALL_CODES.length);
		for (const key of keys) expect(key.startsWith('errors_')).toBe(true);
	});
});

describe('fieldMessageKeyFor', () => {
	function issuesFor(schema: z.ZodTypeAny, input: unknown) {
		const r = schema.safeParse(input, { reportInput: true });
		if (r.success) throw new Error('expected parse to fail');
		return r.error.issues;
	}

	it('fields_required for a missing value', () => {
		const schema = z.object({ a: z.string() }).strict();
		const [issue] = issuesFor(schema, {});
		expect(fieldMessageKeyFor(issue)).toBe('fields_required');
	});

	it('fields_wrong_type for a wrong type', () => {
		const schema = z.object({ a: z.string() }).strict();
		const [issue] = issuesFor(schema, { a: 5 });
		expect(fieldMessageKeyFor(issue)).toBe('fields_wrong_type');
	});

	it('fields_too_short / fields_too_long for strings', () => {
		const schema = z.object({ a: z.string().min(2).max(3) }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'x' })[0])).toBe('fields_too_short');
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'wxyz' })[0])).toBe('fields_too_long');
	});

	it('fields_too_small / fields_too_large for numbers', () => {
		const schema = z.object({ a: z.number().min(2).max(3) }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 1 })[0])).toBe('fields_too_small');
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 4 })[0])).toBe('fields_too_large');
	});

	it('fields_invalid_id for a bad uuid', () => {
		const schema = z.object({ a: z.uuid() }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'nope' })[0])).toBe('fields_invalid_id');
	});

	it('fields_invalid_timestamp for a bad datetime', () => {
		const schema = z.object({ a: z.iso.datetime({ offset: true }) }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'nope' })[0])).toBe(
			'fields_invalid_timestamp'
		);
	});

	it('fields_invalid_date for a bad regex-based date', () => {
		const schema = z.object({ a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'nope' })[0])).toBe('fields_invalid_date');
	});

	it('fields_invalid_choice for a bad enum value', () => {
		const schema = z.object({ a: z.enum(['x', 'y']) }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'z' })[0])).toBe('fields_invalid_choice');
	});

	it('fields_unknown for an unrecognized key', () => {
		const schema = z.object({ a: z.string() }).strict();
		expect(fieldMessageKeyFor(issuesFor(schema, { a: 'x', b: 1 })[0])).toBe('fields_unknown');
	});

	it('fields_bounds_together for the startedAt/endedAt refinement', () => {
		const schema = z
			.object({ startedAt: z.string().optional(), endedAt: z.string().optional() })
			.strict()
			.refine((v) => (v.startedAt === undefined) === (v.endedAt === undefined), {
				path: ['startedAt']
			});
		expect(fieldMessageKeyFor(issuesFor(schema, { startedAt: 'x' })[0])).toBe(
			'fields_bounds_together'
		);
	});

	it('fields_date_required_for_duration for the date refinement', () => {
		const schema = z
			.object({ durationMinutes: z.number().optional(), date: z.string().optional() })
			.strict()
			.refine((v) => v.durationMinutes === undefined || v.date !== undefined, { path: ['date'] });
		expect(fieldMessageKeyFor(issuesFor(schema, { durationMinutes: 5 })[0])).toBe(
			'fields_date_required_for_duration'
		);
	});

	it('falls back to fields_invalid for anything else', () => {
		const schema = z.object({}).strict();
		// unrecognized_keys with an unusual path exercises the default branch too, but a
		// clean way to hit `default` directly is a custom issue at an unrelated path.
		const custom = z
			.object({ a: z.string() })
			.strict()
			.refine(() => false, { path: ['unrelated'] });
		expect(fieldMessageKeyFor(issuesFor(custom, { a: 'x' })[0])).toBe('fields_invalid');
	});
});

describe('errorResponse', () => {
	it('carries error, message, messageKey, requestId and details', async () => {
		const err = apiError('PROJECT_EXISTS', 'A project with that name already exists.', {
			projectId: '1',
			projectName: 'Foo'
		});
		const res = errorResponse(err, 'req-1');
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toEqual({
			error: 'PROJECT_EXISTS',
			message: 'A project with that name already exists.',
			messageKey: 'errors_project_exists',
			requestId: 'req-1',
			details: { projectId: '1', projectName: 'Foo' }
		});
	});

	it('omits details when none were given', async () => {
		const res = errorResponse(apiError('NO_SESSION_RUNNING', 'No session is running.'), 'req-2');
		const body = await res.json();
		expect(body.details).toBeUndefined();
	});

	it('maps an unknown error to 500 INTERNAL_ERROR without leaking its message', async () => {
		const res = errorResponse(
			new Error('a secret filesystem path /etc/shadow leaked here'),
			'req-3'
		);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toBe('INTERNAL_ERROR');
		expect(body.message).not.toContain('/etc/shadow');
		expect(JSON.stringify(body)).not.toContain('/etc/shadow');
	});

	it('never places a stack trace in the body', async () => {
		const res = errorResponse(new Error('boom'), 'req-4');
		const text = await res.text();
		expect(text).not.toContain('at ');
	});

	it('message is prose and messageKey is a key, never swapped', async () => {
		const res = errorResponse(
			apiError('VALIDATION_ERROR', 'The request could not be validated.'),
			'req-5'
		);
		const body = await res.json();
		expect(body.message).toBe('The request could not be validated.');
		expect(body.messageKey).toBe('errors_validation_error');
	});
});

describe('ApiError', () => {
	it('carries status, code, message and details', () => {
		const err = new ApiError(409, 'PROJECT_EXISTS', 'dup', { a: 1 });
		expect(err.status).toBe(409);
		expect(err.code).toBe('PROJECT_EXISTS');
		expect(err.message).toBe('dup');
		expect(err.details).toEqual({ a: 1 });
	});
});
