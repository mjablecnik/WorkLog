import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startSessionSchema } from '$lib/contracts/schemas';
import { FUTURE_TOLERANCE_SECONDS } from '$lib/server/core/config';
import {
	assertNotTooFarInFuture,
	errorResponse,
	parseJsonBody,
	parseRequest
} from '$lib/server/core/errors';
import { startSession } from '$lib/server/services/sessions';

/** POST /api/sessions/start — Requirements 1.1, 1.2, 1.3, 1.4, 1.13. */
export const POST: RequestHandler = async (event) => {
	try {
		const body = parseRequest(startSessionSchema, await parseJsonBody(event.request));
		const now = new Date();
		if (body.startedAt !== undefined) {
			assertNotTooFarInFuture('startedAt', body.startedAt, now, FUTURE_TOLERANCE_SECONDS);
		}
		const result = await startSession({
			startedAt: body.startedAt,
			dryRun: body.dryRun,
			previewToken: body.previewToken,
			now
		});
		return json(result, { status: body.dryRun ? 200 : 201 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
