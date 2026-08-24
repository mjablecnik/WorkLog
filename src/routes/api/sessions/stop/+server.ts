import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopSessionSchema } from '$lib/contracts/schemas';
import { FUTURE_TOLERANCE_SECONDS } from '$lib/server/core/config';
import {
	assertNotTooFarInFuture,
	errorResponse,
	parseJsonBody,
	parseRequest
} from '$lib/server/core/errors';
import { stopSession } from '$lib/server/services/sessions';

/**
 * POST /api/sessions/stop — Requirements 1.5, 1.6, 1.7, 1.13, 1.18. Always answers 200:
 * a sub-floor timer is deleted rather than rejected (Requirement 1.18), so there is no
 * INTERVAL_TOO_SHORT check here — that floor only ever applies to a created or
 * modified session with both bounds already known.
 */
export const POST: RequestHandler = async (event) => {
	try {
		const body = parseRequest(stopSessionSchema, await parseJsonBody(event.request));
		const now = new Date();
		if (body.endedAt !== undefined) {
			assertNotTooFarInFuture('endedAt', body.endedAt, now, FUTURE_TOLERANCE_SECONDS);
		}
		const result = await stopSession({
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
