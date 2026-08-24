import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { coverageQuery } from '$lib/contracts/schemas';
import { getConfig } from '$lib/server/core/config';
import { errorResponse, parseRequest } from '$lib/server/core/errors';
import { buildDayResolver } from '$lib/server/services/day-aggregation';
import { resolveQueryRange } from '$lib/server/services/query-range';
import { withReadTx } from '$lib/server/store/tx';
import { coverageForRange } from '$lib/server/store/aggregates';

/** GET /api/coverage — Requirements 9.1-9.9. */
export const GET: RequestHandler = async (event) => {
	try {
		const query = parseRequest(coverageQuery, Object.fromEntries(event.url.searchParams));
		const config = getConfig();
		const dayResolver = buildDayResolver(config);
		const now = new Date();
		const range = resolveQueryRange(dayResolver, now, query.from, query.to);

		const response = await withReadTx((tx) =>
			coverageForRange(tx, range, now, query.min_gap_seconds)
		);
		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
