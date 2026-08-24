import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { HealthResponse } from '$lib/contracts/responses';
import { getConfig } from '$lib/server/core/config';
import { errorResponse } from '$lib/server/core/errors';
import { getReadiness } from '../../../hooks.server';

/**
 * GET /api/health — the `Health_Endpoint` (Requirement 13.1). Exempt from
 * `handleReadiness` and `handleAuth` in `hooks.server.ts`, so this is the one route
 * that can report `degraded` instead of disappearing behind a 503 from the hook.
 */
export const GET: RequestHandler = async (event) => {
	try {
		const config = getConfig();
		const { ready } = await getReadiness();
		const response: HealthResponse = {
			status: ready ? 'ok' : 'degraded',
			version: config.version,
			timezone: config.timezone,
			dayStartHour: config.dayStartHour,
			gaugeStart: config.gaugeStart,
			gaugeEnd: config.gaugeEnd,
			eveningHour: config.eveningHour,
			maxOpenSessionHours: config.maxOpenSessionHours
		};
		return json(response, { status: ready ? 200 : 503 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
