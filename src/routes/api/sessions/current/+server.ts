import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { CurrentSessionResponse } from '$lib/contracts/responses';
import { errorResponse } from '$lib/server/core/errors';
import { withReadTx } from '$lib/server/store/tx';
import { currentOpenSession } from '$lib/server/store/work-sessions';

/**
 * GET /api/sessions/current — Requirements 1.8, 1.17. `elapsedSeconds` is the true
 * time since start, uncapped even for a `Stale_Session`: the interface shows it as the
 * running clock, and only the session's contribution to `Tracked_Time` is capped.
 */
export const GET: RequestHandler = async (event) => {
	try {
		const now = new Date();
		const session = await withReadTx((tx) => currentOpenSession(tx));
		const response: CurrentSessionResponse = {
			session,
			elapsedSeconds:
				session === null ? 0 : Math.round((now.getTime() - session.startedAt.getTime()) / 1000),
			stale: session?.stale ?? false
		};
		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
