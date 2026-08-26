/**
 * The `createActivity`/`patchActivity`/`deleteActivity` form-action handlers
 * `ActivityDialog.svelte` posts to (`?/createActivity` etc., hardcoded relative
 * action names in that component). Extracted here, out of
 * `src/routes/day/[date]/+page.server.ts` where task 5.5 first built them, because
 * `ActivityDialog` is ALSO mounted on the timer page (`src/routes/+page.svelte`, task
 * 6.7 — Requirement 6.18's Quick_Log "no project" fallback opens it there too), and a
 * SvelteKit form action is resolved relative to whichever route rendered the form:
 * without this extraction, saving from the timer page's dialog would 404 against a
 * route that had no matching action at all. Both `+page.server.ts` files import these
 * three functions and re-export them under the same action names, so `ActivityDialog`
 * behaves identically no matter which page mounted it.
 *
 * Lives under `src/lib/server/services/` (not `src/modules/**`) specifically so it
 * may import `lib/server/**` — the module-boundary rule ("only `+page.server.ts` and
 * `+server.ts` may import `lib/server/**`") is about `src/modules/**`, which holds
 * components and pure logic only; this file holds neither, it is server-only action
 * plumbing two different `+page.server.ts` files share, exactly the same shape as
 * `services/day-aggregation.ts`'s helpers already being shared between
 * `day/[date]/+page.server.ts` and `stats/+page.server.ts`.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { createActivitySchema, patchActivityFormSchema, idParam } from '$lib/contracts/schemas';
import { getConfig } from '$lib/server/core/config';
import { ApiError } from '$lib/server/core/errors';
import {
	createActivity as createActivityService,
	patchActivity as patchActivityService,
	deleteActivity as deleteActivityService
} from '$lib/server/services/activities';
import { formatDuration, formatTimeOfDay } from '$lib/viz/format';
import * as m from '$lib/paraglide/messages';

type ActivityUiField = 'from' | 'to' | 'durationMinutes' | 'projectId' | 'description';

type ActivityFieldErrors = Partial<Record<ActivityUiField, string>>;

/** Every failure shape below is a plain object — intentionally NOT routed through
 * `setError`/superforms' own error store, because that store is never bound to
 * `ActivityDialog`'s client-only `sf` instance (task 5.4 built it as `SPA: true`
 * against a local schema, not against either page's own `form` prop) — there is
 * nothing for superforms' usual client/server sync to attach to. The dialog reads
 * `fieldErrors`/`toastMessage` off the raw `ActionResult` itself and applies them by
 * hand. */
export type ActivityActionFailure = {
	fieldErrors?: ActivityFieldErrors;
	toastMessage?: string;
	/** `ACTIVITY_OVERLAP` only — the first conflicting entry, so the toast can offer
	 * "open the entry" (`feedback_open_conflict`, design.md's Error Handling table). */
	conflictEntryId?: string;
	/** `STALE_PREVIEW` only — tells the dialog to re-run its live Dry_Run immediately
	 * rather than wait out the usual 400ms debounce. */
	stalePreview?: boolean;
	/** `NOT_FOUND` only — the entry being edited/deleted is already gone; the dialog
	 * closes and the day view refreshes rather than keep editing a ghost. */
	notFound?: boolean;
};

function mapWireField(field: string): ActivityUiField | null {
	switch (field) {
		case 'startedAt':
			return 'from';
		case 'endedAt':
			return 'to';
		case 'durationMinutes':
			return 'durationMinutes';
		case 'projectId':
			return 'projectId';
		case 'description':
			return 'description';
		default:
			return null;
	}
}

/** Mirrors `fieldMessageKeyFor` (`lib/server/core/errors.ts`) the other direction:
 * that function picks a message KEY from a Zod issue; this turns the key back into
 * the actual localized text, since a form action's `fail()` payload carries real
 * strings, not keys the client would have to look up itself (Requirement 15.12 —
 * only the catalogue's own words ever reach the screen). Params-carrying reasons
 * (`fields_too_long`/`fields_too_short`/`fields_too_small`/`fields_too_large`) fall
 * back to the generic `fields_invalid` text — every field these actions can raise a
 * `VALIDATION_ERROR` for is one `activityFormSchema` (the client's local schema)
 * already guards before a submission is ever attempted, so this path is a defensive
 * fallback, not a normal one. */
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
		case 'fields_date_required_for_duration':
			return m.fields_date_required_for_duration();
		case 'fields_unknown':
			return m.fields_unknown();
		default:
			return m.fields_invalid();
	}
}

function nothingToLogMessage(reason: unknown): string {
	switch (reason) {
		case 'empty-interval':
			return m.errors_nothing_to_log_empty_interval();
		case 'no-tracked-time':
			return m.errors_nothing_to_log_no_tracked_time();
		case 'all-slivers':
			return m.errors_nothing_to_log_all_slivers();
		case 'already-covered':
			return m.errors_nothing_to_log_already_covered();
		default:
			return m.errors_nothing_to_log();
	}
}

type OverlapConflict = {
	entryId: string;
	/** Null when the conflicting entry is itself a Leisure_Entry — a legitimate
	 *  conflict source (Requirement 3.3), not only ever a Work_Entry. */
	projectName: string | null;
	interval: { start: string; end: string };
};

/** The one place a thrown `ApiError` from `createActivity`/`patchActivity` becomes
 * something `ActivityDialog` can render — design.md's Error Handling table, the rows
 * this dialog can actually reach. A code the table marks "cannot occur through the
 * interface" (`AMBIGUOUS_MODE`) — or one no code path here throws at all
 * (`SESSION_*`, `PROJECT_EXISTS`, `RANGE_TOO_LARGE`, …) — is rethrown, becoming the
 * same generic error page an unexpected server failure would (Requirement 12.3: no
 * internals leak, but no silent swallow either). */
function activityErrorFailure(err: ApiError, timeZone: string) {
	const details = (err.details as Record<string, unknown> | undefined) ?? {};

	switch (err.code) {
		case 'VALIDATION_ERROR': {
			const fields = (details.fields as Record<string, { reason: string }> | undefined) ?? {};
			const fieldErrors: ActivityFieldErrors = {};
			for (const [path, info] of Object.entries(fields)) {
				const uiField = mapWireField(path);
				if (uiField) fieldErrors[uiField] = fieldReasonMessage(info.reason);
			}
			if (Object.keys(fieldErrors).length > 0) return fail<ActivityActionFailure>(400, { fieldErrors });
			return fail<ActivityActionFailure>(400, { toastMessage: m.errors_validation_error() });
		}

		case 'PROJECT_ARCHIVED': {
			const projectName = (details.projectName as string | undefined) ?? '';
			return fail<ActivityActionFailure>(400, { fieldErrors: { projectId: m.errors_project_archived({ projectName }) } });
		}

		case 'FUTURE_TIMESTAMP': {
			const field = details.field === 'endedAt' ? 'to' : 'from';
			return fail<ActivityActionFailure>(400, { fieldErrors: { [field]: m.errors_future_timestamp() } });
		}

		case 'INTERVAL_TOO_SHORT': {
			const minSeconds = (details.minSeconds as number | undefined) ?? 0;
			return fail<ActivityActionFailure>(400, { fieldErrors: { to: m.errors_interval_too_short({ minSeconds }) } });
		}

		case 'INVALID_INTERVAL':
			return fail<ActivityActionFailure>(400, { fieldErrors: { to: m.errors_invalid_interval() } });

		case 'PAYLOAD_TOO_LARGE':
			return fail<ActivityActionFailure>(413, { fieldErrors: { description: m.errors_payload_too_large() } });

		case 'ACTIVITY_OVERLAP': {
			const conflicts = (details.conflicts as OverlapConflict[] | undefined) ?? [];
			const first = conflicts[0];
			if (!first) return fail<ActivityActionFailure>(409, { toastMessage: m.errors_validation_error() });
			const message = m.errors_activity_overlap({
				project: first.projectName ?? m.activity_leisure_label(),
				from: formatTimeOfDay(new Date(first.interval.start), '', timeZone),
				to: formatTimeOfDay(new Date(first.interval.end), '', timeZone)
			});
			return fail<ActivityActionFailure>(409, { toastMessage: message, conflictEntryId: first.entryId });
		}

		case 'OUTSIDE_TRACKED_TIME': {
			const outsideSeconds = (details.outsideSeconds as number | undefined) ?? 0;
			return fail<ActivityActionFailure>(409, {
				toastMessage: m.errors_outside_tracked_time({ duration: formatDuration(outsideSeconds, '') })
			});
		}

		case 'NO_PLACEMENT_ANCHOR': {
			const date = (details.date as string | undefined) ?? '';
			return fail<ActivityActionFailure>(409, { toastMessage: m.errors_no_placement_anchor({ date }) });
		}

		case 'NOTHING_TO_LOG':
			return fail<ActivityActionFailure>(409, { toastMessage: nothingToLogMessage(details.reason) });

		case 'STALE_PREVIEW':
			return fail<ActivityActionFailure>(409, { toastMessage: m.errors_stale_preview(), stalePreview: true });

		case 'NOT_FOUND':
			return fail<ActivityActionFailure>(404, { toastMessage: m.errors_not_found(), notFound: true });

		default:
			throw err;
	}
}

export async function createActivityAction(event: RequestEvent) {
	const config = getConfig();
	const form = await superValidate(event, zod4(createActivitySchema));
	// Practically unreachable — `activityFormSchema` (ActivityDialog.svelte) already
	// guards every one of these fields client-side before a submission is ever
	// attempted — but a plain `toastMessage` fallback beats a silent no-op if it
	// ever is (a stale client build, a hand-crafted request).
	if (!form.valid) return fail(400, { form, toastMessage: m.errors_validation_error() });

	try {
		const result = await createActivityService({
			projectId: form.data.projectId,
			description: form.data.description,
			date: form.data.date,
			startedAt: form.data.startedAt,
			endedAt: form.data.endedAt,
			durationMinutes: form.data.durationMinutes,
			untrackedPolicy: form.data.untrackedPolicy,
			// Requirement 14: this action is the real write, never a preview, whatever
			// the submitted `dryRun` field said — `buildCreateInput` (ActivityDialog.svelte)
			// always sends `false` for a real submission, but the server does not trust a
			// client-controlled flag to decide whether it writes (code-security.md's Core
			// Principle: strict behaviour never depends on something the caller sent).
			dryRun: false,
			previewToken: form.data.previewToken,
			now: new Date()
		});
		return { form, activity: result };
	} catch (err) {
		if (err instanceof ApiError) return activityErrorFailure(err, config.timezone);
		throw err;
	}
}

export async function patchActivityAction(event: RequestEvent) {
	const config = getConfig();
	// Read the FormData once — `patchActivitySchema` has no `id` field (a REST PATCH
	// takes it from the URL; a form action has no URL param for it), so `id` travels
	// as an extra field in the same FormData `ActivityDialog.svelte` builds from
	// `buildPatchInput()`. Passing the already-read FormData into `superValidate`
	// (rather than `event`) avoids reading `event.request.formData()` twice, which
	// throws on the second read.
	const formData = await event.request.formData();
	const idResult = idParam.safeParse(formData.get('id'));
	if (!idResult.success) {
		return fail<ActivityActionFailure>(400, { toastMessage: m.fields_invalid_id() });
	}

	const form = await superValidate(formData, zod4(patchActivityFormSchema));
	if (!form.valid) return fail(400, { form, toastMessage: m.errors_validation_error() });

	// The two name contradictory outcomes — clearProject says "become a
	// Leisure_Entry", projectId says "set/change the Project" — so silently
	// preferring either one would discard an instruction the caller gave
	// (Requirement 4.11).
	if (form.data.clearProject === true && form.data.projectId !== undefined) {
		return fail<ActivityActionFailure>(400, { toastMessage: m.errors_validation_error() });
	}

	// clearProject === true converts to a Leisure_Entry (Requirement 4.9); a FormData
	// body cannot carry a null directly. Otherwise pass form.data.projectId through
	// unchanged: absent leaves it unchanged, a uuid sets/changes it.
	const projectId: string | null | undefined =
		form.data.clearProject === true ? null : form.data.projectId;

	try {
		const result = await patchActivityService({
			id: idResult.data,
			description: form.data.description,
			projectId,
			date: form.data.date,
			startedAt: form.data.startedAt,
			endedAt: form.data.endedAt,
			durationMinutes: form.data.durationMinutes,
			untrackedPolicy: form.data.untrackedPolicy,
			dryRun: false,
			previewToken: form.data.previewToken,
			now: new Date()
		});
		return { form, activity: result };
	} catch (err) {
		if (err instanceof ApiError) return activityErrorFailure(err, config.timezone);
		throw err;
	}
}

// Requirement 7.7/7.8: no `Change_Preview` for a delete (unlike `SessionDialog`'s,
// task 5.6) — the confirmation names what will be removed and that is the whole
// safeguard, so this carries no dry-run/preview-token dance and no Zod body schema
// at all, matching `deleteActivityQuery`'s own doc comment ("There is no
// `deleteActivitySchema` — this is the whole shape") for the REST route it mirrors.
export async function deleteActivityAction(event: RequestEvent) {
	const formData = await event.request.formData();
	const idResult = idParam.safeParse(formData.get('id'));
	if (!idResult.success) return fail<ActivityActionFailure>(400, { toastMessage: m.fields_invalid_id() });

	try {
		await deleteActivityService({ id: idResult.data, dryRun: false });
	} catch (err) {
		if (err instanceof ApiError && err.code === 'NOT_FOUND') {
			return fail<ActivityActionFailure>(404, { toastMessage: m.errors_not_found(), notFound: true });
		}
		throw err;
	}
	return { deletedId: idResult.data };
}
