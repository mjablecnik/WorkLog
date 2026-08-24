import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteActivityQuery, idParam, patchActivitySchema } from '$lib/contracts/schemas';
import { apiError, errorResponse, parseJsonBody, parseRequest } from '$lib/server/core/errors';
import { withReadTx } from '$lib/server/store/tx';
import { getEntry } from '$lib/server/store/activities';
import { deleteActivity, patchActivity } from '$lib/server/services/activities';

/** GET /api/activities/{id} — Requirement 7.7. */
export const GET: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		const entry = await withReadTx((tx) => getEntry(tx, id));
		if (entry === null) {
			throw apiError('NOT_FOUND', 'That record could not be found.', {
				resource: 'activity',
				id
			});
		}
		return json(entry, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/** PATCH /api/activities/{id} — Requirements 7.8-7.12, 7.16-7.26. */
export const PATCH: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		const body = parseRequest(patchActivitySchema, await parseJsonBody(event.request));
		const now = new Date();
		const result = await patchActivity({
			id,
			description: body.description,
			projectId: body.projectId,
			date: body.date,
			startedAt: body.startedAt,
			endedAt: body.endedAt,
			durationMinutes: body.durationMinutes,
			untrackedPolicy: body.untrackedPolicy,
			dryRun: body.dryRun,
			previewToken: body.previewToken,
			now
		});
		return json(result, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/** DELETE /api/activities/{id} — Requirement 7.11; `dryRun`/`Preview_Token` as query params (14.12). */
export const DELETE: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		const query = parseRequest(deleteActivityQuery, Object.fromEntries(event.url.searchParams));
		const dryRun = query.dry_run === 'true';
		const result = await deleteActivity({
			id,
			dryRun,
			previewToken: query.preview_token
		});
		if (dryRun) return json(result, { status: 200 });
		return new Response(null, { status: 204 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
