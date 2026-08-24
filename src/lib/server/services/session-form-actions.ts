/**
 * The `createSession`/`patchSession`/`deleteSession` form-action handlers
 * `SessionDialog.svelte` posts to (`?/createSession` etc., hardcoded relative action
 * names in that component) — task 5.6's counterpart to `activity-form-actions.ts`.
 *
 * Lives under `src/lib/server/services/` for the identical reason that file does: it
 * may import `lib/server/**`, which `src/modules/**` (components and pure logic) may
 * not, and `src/routes/day/[date]/+page.server.ts` re-exports these three functions
 * under the action names `SessionDialog` submits to.
 *
 * `SessionDialog` is mounted only on the day page today (unlike `ActivityDialog`,
 * which is also mounted on the timer page), so nothing forces this file to be shared
 * across two `+page.server.ts` files the way `activity-form-actions.ts` is — it is
 * still extracted here rather than left inline, for the same reason
 * `day-aggregation.ts`'s helpers are: one place for logic a route file would otherwise
 * have to carry alongside its `load`.
 *
 * These three functions are the one place outside the REST routes
 * (`src/routes/api/sessions/+server.ts`, `src/routes/api/sessions/[id]/+server.ts`)
 * that calls `src/lib/server/services/sessions.ts` directly, so the future-instant and
 * minimum-interval checks those routes perform before calling the service are
 * repeated here rather than assumed — `sessions.ts`'s own doc comment is explicit that
 * "timestamp validation... happens at the route/schema boundary; these functions
 * assume their Date arguments already passed that check." A form action IS that
 * boundary here, exactly as the REST route is for a script or a phone shortcut.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { createSessionSchema, patchSessionSchema, idParam } from '$lib/contracts/schemas';
import type { SessionWriteResponse } from '$lib/contracts/responses';
import { FUTURE_TOLERANCE_SECONDS, getConfig } from '$lib/server/core/config';
import { assertIntervalNotTooShort, assertNotTooFarInFuture, ApiError } from '$lib/server/core/errors';
import {
	createSession as createSessionService,
	patchSession as patchSessionService,
	deleteSession as deleteSessionService
} from '$lib/server/services/sessions';
import { getSession } from '$lib/server/store/work-sessions';
import { withReadTx } from '$lib/server/store/tx';
import { formatTimeOfDay } from '$lib/viz/format';
import * as m from '$lib/paraglide/messages';

type SessionUiField = 'start' | 'end';

type SessionFieldErrors = Partial<Record<SessionUiField, string>>;

/** Mirrors `activity-form-actions.ts`'s own `ActivityActionFailure` — a plain object,
 * never routed through superforms' `setError`, for the identical reason: `sf` inside
 * `SessionDialog` is a client-only (`SPA: true`) instance against a local schema, with
 * nothing for superforms' client/server error sync to attach to. */
export type SessionActionFailure = {
	fieldErrors?: SessionFieldErrors;
	toastMessage?: string;
	/** `STALE_PREVIEW` only — tells the dialog to recompute its preview and stay in the
	 * Confirming state, rather than the 400 ms debounce an ordinary edit schedules. */
	stalePreview?: boolean;
	/** `NOT_FOUND` only — the session being edited/deleted is already gone. */
	notFound?: boolean;
};

function mapWireField(field: string): SessionUiField | null {
	switch (field) {
		case 'startedAt':
			return 'start';
		case 'endedAt':
			return 'end';
		default:
			return null;
	}
}

/** Duplicated from `activity-form-actions.ts` rather than imported — that file is out
 * of this task's scope to touch, and the mapping is a handful of lines with no
 * meaningful place to share it that isn't also a change to that file. */
function fieldReasonMessage(reason: string): string {
	switch (reason) {
		case 'fields_required':
			return m.fields_required();
		case 'fields_invalid_choice':
			return m.fields_invalid_choice();
		case 'fields_invalid_date':
			return m.fields_invalid_date();
		case 'fields_invalid_timestamp':
			return m.fields_invalid_timestamp();
		case 'fields_invalid_id':
			return m.fields_invalid_id();
		case 'fields_wrong_type':
			return m.fields_wrong_type();
		case 'fields_bounds_together':
			return m.fields_bounds_together();
		case 'fields_unknown':
			return m.fields_unknown();
		default:
			return m.fields_invalid();
	}
}

type OverlapConflict = {
	sessionId: string;
	interval: { start: string; end: string };
	open: boolean;
};

/** The one place a thrown `ApiError` from `createSession`/`patchSession`/
 * `deleteSession` becomes something `SessionDialog` can render — design.md's Error
 * Handling table, the rows this dialog can actually reach. A code the table marks as
 * unreachable through the interface, or one no code path here throws
 * (`ACTIVITY_OVERLAP`, `PROJECT_*`, …), is rethrown, becoming the same generic error
 * page an unexpected server failure would. */
function sessionErrorFailure(err: ApiError, timeZone: string) {
	const details = (err.details as Record<string, unknown> | undefined) ?? {};

	switch (err.code) {
		case 'VALIDATION_ERROR': {
			const fields = (details.fields as Record<string, { reason: string }> | undefined) ?? {};
			const fieldErrors: SessionFieldErrors = {};
			for (const [path, info] of Object.entries(fields)) {
				const uiField = mapWireField(path);
				if (uiField) fieldErrors[uiField] = fieldReasonMessage(info.reason);
			}
			if (Object.keys(fieldErrors).length > 0) return fail<SessionActionFailure>(400, { fieldErrors });
			return fail<SessionActionFailure>(400, { toastMessage: m.errors_validation_error() });
		}

		case 'FUTURE_TIMESTAMP': {
			const field = details.field === 'endedAt' ? 'end' : 'start';
			return fail<SessionActionFailure>(400, { fieldErrors: { [field]: m.errors_future_timestamp() } });
		}

		case 'INTERVAL_TOO_SHORT': {
			const minSeconds = (details.minSeconds as number | undefined) ?? 0;
			return fail<SessionActionFailure>(400, {
				fieldErrors: { end: m.errors_interval_too_short({ minSeconds }) }
			});
		}

		case 'INVALID_INTERVAL':
			return fail<SessionActionFailure>(400, { fieldErrors: { end: m.errors_invalid_interval() } });

		case 'SESSION_OVERLAP': {
			const conflicts = (details.conflicts as OverlapConflict[] | undefined) ?? [];
			const first = conflicts[0];
			if (!first) return fail<SessionActionFailure>(409, { toastMessage: m.errors_validation_error() });
			const message = first.open
				? m.errors_session_overlap_open({
						from: formatTimeOfDay(new Date(first.interval.start), '', timeZone)
					})
				: m.errors_session_overlap({
						from: formatTimeOfDay(new Date(first.interval.start), '', timeZone),
						to: formatTimeOfDay(new Date(first.interval.end), '', timeZone)
					});
			return fail<SessionActionFailure>(409, { toastMessage: message });
		}

		case 'STALE_PREVIEW':
			return fail<SessionActionFailure>(409, { toastMessage: m.errors_stale_preview(), stalePreview: true });

		case 'NOT_FOUND':
			return fail<SessionActionFailure>(404, { toastMessage: m.errors_not_found(), notFound: true });

		default:
			throw err;
	}
}

export async function createSessionAction(event: RequestEvent) {
	const config = getConfig();
	const form = await superValidate(event, zod4(createSessionSchema));
	// Practically unreachable — `SessionDialog`'s own local schema already guards every
	// one of these fields client-side before a submission is ever attempted — but a
	// plain `toastMessage` fallback beats a silent no-op if it ever is.
	if (!form.valid) return fail(400, { form, toastMessage: m.errors_validation_error() });

	const now = new Date();
	try {
		assertNotTooFarInFuture('startedAt', form.data.startedAt, now, FUTURE_TOLERANCE_SECONDS);
		assertNotTooFarInFuture('endedAt', form.data.endedAt, now, FUTURE_TOLERANCE_SECONDS);
		assertIntervalNotTooShort(form.data.startedAt, form.data.endedAt, config.minIntervalSeconds);

		// `dryRun: false` unconditionally — Requirement 14's "strict behaviour never
		// depends on something the caller sent" (code-security.md's Core Principle):
		// this action IS the real write, whatever the submitted `dryRun` field said.
		const result = (await createSessionService({
			startedAt: form.data.startedAt,
			endedAt: form.data.endedAt,
			dryRun: false,
			previewToken: form.data.previewToken,
			now
		})) as SessionWriteResponse;
		return { form, session: result };
	} catch (err) {
		if (err instanceof ApiError) return sessionErrorFailure(err, config.timezone);
		throw err;
	}
}

export async function patchSessionAction(event: RequestEvent) {
	const config = getConfig();
	// Read the FormData once — `patchSessionSchema` has no `id` field (a REST PATCH
	// takes it from the URL; a form action has no URL param for it), so `id` travels as
	// an extra field, matching `patchActivityAction`'s own reasoning.
	const formData = await event.request.formData();
	const idResult = idParam.safeParse(formData.get('id'));
	if (!idResult.success) return fail<SessionActionFailure>(400, { toastMessage: m.fields_invalid_id() });

	const form = await superValidate(formData, zod4(patchSessionSchema));
	if (!form.valid) return fail(400, { form, toastMessage: m.errors_validation_error() });

	const now = new Date();
	try {
		// Mirrors `src/routes/api/sessions/[id]/+server.ts`'s PATCH handler exactly: the
		// future-instant and minimum-interval checks need the row's OTHER bound whenever
		// only one of `startedAt`/`endedAt` was supplied, so the existing row is read
		// once here, read-only, purely to validate — the service re-reads it under the
		// write lock for the real update.
		const existing = await withReadTx((tx) => getSession(tx, idResult.data));
		if (existing !== null) {
			const newStart = form.data.startedAt ?? existing.startedAt;
			const newEnd = form.data.endedAt === null ? null : (form.data.endedAt ?? existing.endedAt);
			if (form.data.startedAt !== undefined) {
				assertNotTooFarInFuture('startedAt', form.data.startedAt, now, FUTURE_TOLERANCE_SECONDS);
			}
			if (form.data.endedAt !== undefined && form.data.endedAt !== null) {
				assertNotTooFarInFuture('endedAt', form.data.endedAt, now, FUTURE_TOLERANCE_SECONDS);
			}
			if (newEnd !== null && newStart.getTime() < newEnd.getTime()) {
				assertIntervalNotTooShort(newStart, newEnd, config.minIntervalSeconds);
			}
		}

		const result = (await patchSessionService({
			id: idResult.data,
			startedAt: form.data.startedAt,
			endedAt: form.data.endedAt,
			dryRun: false,
			previewToken: form.data.previewToken,
			now
		})) as SessionWriteResponse;
		return { form, session: result };
	} catch (err) {
		if (err instanceof ApiError) return sessionErrorFailure(err, config.timezone);
		throw err;
	}
}

// Requirement 8.10: unlike `deleteActivityAction`, a session's delete DOES carry a
// `Change_Preview` in `SessionDialog` — but that preview is `previewDeleteSession`
// (task 5.6's dry-run call, `dry-run.ts`), run and rendered entirely client-side
// before this action is ever invoked. By the time this runs, the user has already
// confirmed the exact consequence the dry-run showed; this action's only job is the
// real write, carrying the SAME `previewToken` so the server can still catch a
// genuine race (`STALE_PREVIEW`) between the preview and this confirmation.
export async function deleteSessionAction(event: RequestEvent) {
	const config = getConfig();
	const formData = await event.request.formData();
	const idResult = idParam.safeParse(formData.get('id'));
	if (!idResult.success) return fail<SessionActionFailure>(400, { toastMessage: m.fields_invalid_id() });

	const previewTokenRaw = formData.get('previewToken');
	const previewToken =
		typeof previewTokenRaw === 'string' && previewTokenRaw !== '' ? previewTokenRaw : undefined;

	try {
		await deleteSessionService({
			id: idResult.data,
			dryRun: false,
			previewToken,
			now: new Date()
		});
	} catch (err) {
		if (err instanceof ApiError) return sessionErrorFailure(err, config.timezone);
		throw err;
	}
	return { deletedId: idResult.data };
}
