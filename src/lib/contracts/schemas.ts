/**
 * Every Zod schema validating a JSON request body or a query string, for both the REST
 * routes and `002-worklog-ui`'s form actions (through superforms). This module imports
 * only `zod` and its own pure constants — no database client, no `$env`, no
 * `$app/server`, no SvelteKit runtime, no Drizzle. It must be safe to ship to the
 * browser.
 *
 * JSON bodies use camelCase; query parameters use snake_case (Requirement 12.1). Every
 * schema is `.strict()`, so an unknown field is rejected wherever the body is parsed.
 */
import { z } from 'zod';
import { ACTIVITY_PAGE_SIZE } from './constants';

/**
 * RFC 3339 with an explicit offset (Requirement 10.2), truncated toward the past to a
 * whole second. A timestamp carrying milliseconds is accepted and stored truncated,
 * never rejected and never rounded up.
 */
export const isoOffset = z.iso
	.datetime({ offset: true })
	.transform((s) => new Date(Math.floor(new Date(s).getTime() / 1000) * 1000));

const dryRunFields = {
	dryRun: z.boolean().default(false),
	previewToken: z.string().optional()
};

/** True for a string that is not just YYYY-MM-DD shaped but names a real date — a
 *  regex alone accepts "2026-02-30", which `new Date(...)`-style parsing downstream
 *  would silently roll forward into March rather than reject. */
function isRealCalendarDate(value: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!m) return false;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const date = new Date(Date.UTC(y, mo - 1, d));
	return (
		date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
	);
}

const dateString = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine(isRealCalendarDate, { message: 'must be a real calendar date' });

/**
 * Every `{id}` path parameter (`/api/projects/{id}`, `/api/sessions/{id}`,
 * `/api/activities/{id}`) is validated against this before it ever reaches a query —
 * a malformed value (not a UUID at all) must be a 400 `VALIDATION_ERROR`, never a raw
 * "invalid input syntax for type uuid" surfacing as a 500 (Requirement 12.3: no
 * internals leak in an error response).
 */
export const idParam = z.uuid();

const untrackedPolicy = z.enum(['clip', 'extend', 'reject']).default('clip');

// POST /api/activities — one schema covers all three modes; the handler picks the mode.
export const createActivitySchema = z
	.object({
		/** Absent creates a Leisure_Entry (Requirement 2.3). */
		projectId: z.uuid().optional(),
		description: z.string().max(2000).default(''),
		/** Target_Day for Duration_Mode and Open_Mode. Defaults to the current Logical_Day. */
		date: dateString.optional(),
		startedAt: isoOffset.optional(),
		endedAt: isoOffset.optional(),
		durationMinutes: z.number().int().positive().optional(),
		untrackedPolicy,
		...dryRunFields
	})
	.strict();

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

/**
 * PATCH also carries the orphan rescue path (Requirements 7.16-7.19). Supplying both
 * bounds clears `requestedDurationMinutes` and sets `mode` to `explicit`.
 */
const patchActivityFields = {
	/**
	 * Three states, all meaningful (Requirements 4.1, 4.2): absent leaves projectId
	 * unchanged; null clears it, converting to a Leisure_Entry; a uuid sets/changes
	 * it, converting to (or keeping) a Work_Entry. Reachable only over the JSON
	 * API — the form-action path uses `clearProject` instead.
	 */
	projectId: z.uuid().nullable().optional(),
	description: z.string().max(2000).optional(),
	startedAt: isoOffset.optional(),
	endedAt: isoOffset.optional(),
	durationMinutes: z.number().int().positive().optional(),
	/** Required whenever `durationMinutes` is sent — Requirement 7.21. */
	date: dateString.optional(),
	untrackedPolicy,
	...dryRunFields
};

// Requirement 7.20: the two bounds travel together or not at all.
const patchActivityBoundsRefine = (v: { startedAt?: Date; endedAt?: Date }) =>
	(v.startedAt === undefined) === (v.endedAt === undefined);
// Requirement 7.21: a duration must say which Target_Day to walk.
const patchActivityDurationDateRefine = (v: { durationMinutes?: number; date?: string }) =>
	v.durationMinutes === undefined || v.date !== undefined;
// Requirement 7.25: a PATCH names exactly one mode, as a create does.
const patchActivityModeRefine = (v: { durationMinutes?: number; endedAt?: Date }) =>
	!(v.durationMinutes !== undefined && v.endedAt !== undefined);

export const patchActivitySchema = z
	.object(patchActivityFields)
	.strict()
	.refine(patchActivityBoundsRefine, {
		message: 'startedAt and endedAt must be supplied together',
		path: ['startedAt']
	})
	.refine(patchActivityDurationDateRefine, {
		message: 'date is required when durationMinutes is supplied',
		path: ['date']
	})
	.refine(patchActivityModeRefine, {
		message: 'endedAt and durationMinutes must not be supplied together',
		path: ['durationMinutes']
	});

export type PatchActivityInput = z.infer<typeof patchActivitySchema>;

/**
 * The form-action variant, and the ONLY schema carrying `clearProject` — the
 * form-action encoding of "convert to a Leisure_Entry" (Requirement 4.9). A FormData
 * body carries no null and cannot distinguish an absent field from an empty one, so
 * `patchActivitySchema`'s `projectId: null` is unrepresentable on that path.
 * `patchActivityAction` translates a true value into `projectId: null` before calling
 * the service; the service itself never sees this field.
 *
 * Declared as a separate schema rather than a field on the shared one deliberately:
 * `patchActivitySchema` is `.strict()`, so keeping `clearProject` out of it makes the
 * JSON route REJECT the field with `VALIDATION_ERROR` instead of accepting and
 * silently dropping it. `projectId: null` stays the one JSON encoding of the
 * conversion (Requirement 4.10).
 */
export const patchActivityFormSchema = z
	.object({ ...patchActivityFields, clearProject: z.coerce.boolean().optional() })
	.strict()
	.refine(patchActivityBoundsRefine, {
		message: 'startedAt and endedAt must be supplied together',
		path: ['startedAt']
	})
	.refine(patchActivityDurationDateRefine, {
		message: 'date is required when durationMinutes is supplied',
		path: ['date']
	})
	.refine(patchActivityModeRefine, {
		message: 'endedAt and durationMinutes must not be supplied together',
		path: ['durationMinutes']
	});
export type PatchActivityFormInput = z.infer<typeof patchActivityFormSchema>;

export const createSessionSchema = z
	.object({
		startedAt: isoOffset,
		endedAt: isoOffset,
		...dryRunFields
	})
	.strict();

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// start and stop create and modify a Work_Session, so Requirement 14.2 applies to them
// exactly as it does to POST and PATCH — they carry the dry-run fields too.
export const startSessionSchema = z
	.object({ startedAt: isoOffset.optional(), ...dryRunFields })
	.strict();
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const stopSessionSchema = z
	.object({ endedAt: isoOffset.optional(), ...dryRunFields })
	.strict();
export type StopSessionInput = z.infer<typeof stopSessionSchema>;

export const patchSessionSchema = z
	.object({
		startedAt: isoOffset.optional(),
		endedAt: isoOffset.nullable().optional(),
		...dryRunFields
	})
	.strict();
export type PatchSessionInput = z.infer<typeof patchSessionSchema>;

/**
 * DELETE carries its dry-run flags as QUERY parameters, not a body (Requirement
 * 14.12): a request body on DELETE is not reliably transmitted by every client or
 * proxy. There is no `deleteSessionSchema` — this is the whole shape.
 */
export const deleteSessionQuery = z
	.object({
		dry_run: z.enum(['true', 'false']).default('false'),
		preview_token: z.string().optional()
	})
	.strict();
export type DeleteSessionQuery = z.infer<typeof deleteSessionQuery>;

export const createProjectSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		/** Defaults to true (Requirement 1.1). */
		billable: z.boolean().default(true)
	})
	.strict();
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const patchProjectSchema = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		archived: z.boolean().optional(),
		colorIndex: z.number().int().min(0).max(7).optional(),
		billable: z.boolean().optional()
	})
	.strict();
export type PatchProjectInput = z.infer<typeof patchProjectSchema>;

export const listActivitiesQuery = z
	.object({
		from: isoOffset.optional(),
		to: isoOffset.optional(),
		project_id: z.uuid().optional(),
		cursor: z.string().optional(), // Requirement 7.14
		order: z.enum(['asc', 'desc']).default('asc'), // Requirement 7.23
		limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_SIZE).default(ACTIVITY_PAGE_SIZE) // Requirement 7.24
	})
	.strict()
	.refine((v) => (v.from === undefined) === (v.to === undefined), {
		message: 'from and to must be supplied together',
		path: ['from']
	});
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuery>;

/** DELETE takes its dry-run flags as query parameters, for the reason given above. */
export const deleteActivityQuery = z
	.object({
		dry_run: z.enum(['true', 'false']).default('false'),
		preview_token: z.string().optional()
	})
	.strict();
export type DeleteActivityQuery = z.infer<typeof deleteActivityQuery>;

export const daysQuery = z
	.object({
		from: isoOffset.optional(),
		to: isoOffset.optional(),
		/** The only accepted value; anything else is a VALIDATION_ERROR. */
		include: z.literal('intervals').optional()
	})
	.strict()
	.refine((v) => (v.from === undefined) === (v.to === undefined), {
		message: 'from and to must be supplied together',
		path: ['from']
	});
export type DaysQuery = z.infer<typeof daysQuery>;

export const dayDateParam = dateString;

/** GET /api/sessions — Requirements 2.2, 2.3, 2.4. */
export const listSessionsQuery = z
	.object({
		from: isoOffset.optional(),
		to: isoOffset.optional()
	})
	.strict()
	.refine((v) => (v.from === undefined) === (v.to === undefined), {
		message: 'from and to must be supplied together',
		path: ['from']
	});
export type ListSessionsQuery = z.infer<typeof listSessionsQuery>;

/** GET /api/projects — Requirements 3.4, 3.5. */
export const listProjectsQuery = z
	.object({
		include_archived: z.enum(['true', 'false']).default('false')
	})
	.strict();
export type ListProjectsQuery = z.infer<typeof listProjectsQuery>;

export const coverageQuery = z
	.object({
		from: isoOffset.optional(),
		to: isoOffset.optional(),
		min_gap_seconds: z.coerce.number().int().min(0).default(0) // Requirement 9.9
	})
	.strict()
	.refine((v) => (v.from === undefined) === (v.to === undefined), {
		message: 'from and to must be supplied together',
		path: ['from']
	});
export type CoverageQuery = z.infer<typeof coverageQuery>;

/**
 * The login form contract, owned by this spec because the form action is
 * (Requirement 11.25). `002` renders the page against exactly these names and no
 * others.
 */
export const loginSchema = z
	.object({
		passphrase: z.string().min(1).max(1024),
		next: z.string().max(2048).optional()
	})
	.strict();
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * An `Idempotency-Key` header value (Requirement 12.23): at most 200 characters of
 * `A`-`Z`, `a`-`z`, `0`-`9`, `-` and `_`.
 */
export const idempotencyKeySchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9_-]+$/);
