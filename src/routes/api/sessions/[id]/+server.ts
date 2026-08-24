import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSessionQuery, idParam, patchSessionSchema } from '$lib/contracts/schemas';
import { FUTURE_TOLERANCE_SECONDS, getConfig } from '$lib/server/core/config';
import {
	assertIntervalNotTooShort,
	assertNotTooFarInFuture,
	errorResponse,
	parseJsonBody,
	parseRequest
} from '$lib/server/core/errors';
import { withReadTx } from '$lib/server/store/tx';
import { getSession } from '$lib/server/store/work-sessions';
import { deleteSession, patchSession } from '$lib/server/services/sessions';

/**
 * PATCH /api/sessions/{id} — Requirements 1.13, 1.14, 2.5, 2.6, 2.7, 2.8, 2.9. The
 * future-instant and minimum-interval checks need the row's OTHER bound whenever only
 * one of `startedAt`/`endedAt` is supplied, so it is read once here, read-only, purely
 * to validate; the service re-reads it under the write lock for the real update.
 */
export const PATCH: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		const body = parseRequest(patchSessionSchema, await parseJsonBody(event.request));
		const now = new Date();
		const config = getConfig();

		const existing = await withReadTx((tx) => getSession(tx, id));
		if (existing !== null) {
			const newStart = body.startedAt ?? existing.startedAt;
			const newEnd = body.endedAt === null ? null : (body.endedAt ?? existing.endedAt);
			if (body.startedAt !== undefined) {
				assertNotTooFarInFuture('startedAt', body.startedAt, now, FUTURE_TOLERANCE_SECONDS);
			}
			if (body.endedAt !== undefined && body.endedAt !== null) {
				assertNotTooFarInFuture('endedAt', body.endedAt, now, FUTURE_TOLERANCE_SECONDS);
			}
			if (newEnd !== null && newStart.getTime() < newEnd.getTime()) {
				assertIntervalNotTooShort(newStart, newEnd, config.minIntervalSeconds);
			}
		}

		const result = await patchSession({
			id,
			startedAt: body.startedAt,
			endedAt: body.endedAt,
			dryRun: body.dryRun,
			previewToken: body.previewToken,
			now
		});
		return json(result, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/**
 * DELETE /api/sessions/{id} — Requirement 14.12: `dryRun` and the `Preview_Token`
 * travel as query parameters here, not a body. A real delete answers 204; a `dryRun`
 * delete answers 200 with the preview, since 204 carries no body to preview.
 */
export const DELETE: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		const query = parseRequest(deleteSessionQuery, Object.fromEntries(event.url.searchParams));
		const dryRun = query.dry_run === 'true';
		const now = new Date();
		const result = await deleteSession({
			id,
			dryRun,
			previewToken: query.preview_token,
			now
		});
		if (dryRun) return json(result, { status: 200 });
		return new Response(null, { status: 204 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
