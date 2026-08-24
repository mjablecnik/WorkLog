import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SessionListResponse } from '$lib/contracts/responses';
import { createSessionSchema, listSessionsQuery } from '$lib/contracts/schemas';
import { FUTURE_TOLERANCE_SECONDS, getConfig } from '$lib/server/core/config';
import {
	assertIntervalNotTooShort,
	assertNotTooFarInFuture,
	errorResponse,
	parseJsonBody,
	parseRequest
} from '$lib/server/core/errors';
import { createDayResolver } from '$lib/server/domain/logical-day';
import { resolveQueryRange } from '$lib/server/services/query-range';
import { withReadTx } from '$lib/server/store/tx';
import { listSessionsOverlapping } from '$lib/server/store/work-sessions';
import { createSession } from '$lib/server/services/sessions';

/** GET /api/sessions — Requirements 2.2, 2.3, 2.4. A bare array, never paged. */
export const GET: RequestHandler = async (event) => {
	try {
		const query = parseRequest(listSessionsQuery, Object.fromEntries(event.url.searchParams));
		const config = getConfig();
		const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
		const now = new Date();
		const range = resolveQueryRange(dayResolver, now, query.from, query.to);
		const sessions = await withReadTx((tx) => listSessionsOverlapping(tx, range));
		const response: SessionListResponse = sessions;
		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/** POST /api/sessions — creates a CLOSED session directly (Requirement 2.1). */
export const POST: RequestHandler = async (event) => {
	try {
		const body = parseRequest(createSessionSchema, await parseJsonBody(event.request));
		const now = new Date();
		const config = getConfig();
		assertNotTooFarInFuture('startedAt', body.startedAt, now, FUTURE_TOLERANCE_SECONDS);
		assertNotTooFarInFuture('endedAt', body.endedAt, now, FUTURE_TOLERANCE_SECONDS);
		assertIntervalNotTooShort(body.startedAt, body.endedAt, config.minIntervalSeconds);

		const result = await createSession({
			startedAt: body.startedAt,
			endedAt: body.endedAt,
			dryRun: body.dryRun,
			previewToken: body.previewToken,
			now
		});
		return json(result, { status: 201 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
