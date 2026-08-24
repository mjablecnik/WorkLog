import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ActivityListResponse } from '$lib/contracts/responses';
import {
	createActivitySchema,
	idempotencyKeySchema,
	listActivitiesQuery
} from '$lib/contracts/schemas';
import { getConfig } from '$lib/server/core/config';
import { apiError, errorResponse, parseJsonBody, parseRequest } from '$lib/server/core/errors';
import { createDayResolver } from '$lib/server/domain/logical-day';
import { resolveQueryRange } from '$lib/server/services/query-range';
import { withReadTx } from '$lib/server/store/tx';
import { listEntriesOverlapping, type EntryCursor } from '$lib/server/store/activities';
import { createActivity } from '$lib/server/services/activities';

/**
 * The cursor is base64url of `requestedStartedAt|createdAt|id` — the exact sort key of
 * `activity_entries_order` (Requirement 7.14), so a page can neither skip nor repeat a
 * row. A cursor that fails to decode is a `VALIDATION_ERROR`.
 */
function encodeCursor(c: EntryCursor): string {
	return Buffer.from(
		`${c.requestedStartedAt.toISOString()}|${c.createdAt.toISOString()}|${c.id}`
	).toString('base64url');
}

function decodeCursor(raw: string): EntryCursor {
	let decoded: string;
	try {
		decoded = Buffer.from(raw, 'base64url').toString('utf8');
	} catch {
		throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
			fields: { cursor: { reason: 'fields_invalid' } }
		});
	}
	const parts = decoded.split('|');
	const [startedAtStr, createdAtStr, id] = parts;
	const requestedStartedAt = startedAtStr !== undefined ? new Date(startedAtStr) : new Date(NaN);
	const createdAt = createdAtStr !== undefined ? new Date(createdAtStr) : new Date(NaN);
	if (
		parts.length !== 3 ||
		Number.isNaN(requestedStartedAt.getTime()) ||
		Number.isNaN(createdAt.getTime()) ||
		id.length === 0
	) {
		throw apiError('VALIDATION_ERROR', 'The request could not be validated.', {
			fields: { cursor: { reason: 'fields_invalid' } }
		});
	}
	return { requestedStartedAt, createdAt, id };
}

/** GET /api/activities — Requirements 7.1-7.6, 7.13-7.15, 7.23, 7.24. */
export const GET: RequestHandler = async (event) => {
	try {
		const query = parseRequest(listActivitiesQuery, Object.fromEntries(event.url.searchParams));
		const config = getConfig();
		const dayResolver = createDayResolver(config.timezone, config.dayStartHour);
		const now = new Date();
		const range = resolveQueryRange(dayResolver, now, query.from, query.to);
		const cursor = query.cursor !== undefined ? decodeCursor(query.cursor) : null;

		const page = await withReadTx((tx) =>
			listEntriesOverlapping(tx, range, {
				projectId: query.project_id,
				cursor,
				limit: query.limit,
				order: query.order
			})
		);

		const last = page.entries[page.entries.length - 1];
		const response: ActivityListResponse = {
			entries: page.entries,
			nextCursor:
				page.hasMore && last !== undefined
					? encodeCursor({
							requestedStartedAt: last.requestedStartedAt,
							createdAt: last.createdAt,
							id: last.id
						})
					: null
		};
		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/** POST /api/activities — Requirements 4, 5, 6, 15 (mode selection lives in the service). */
export const POST: RequestHandler = async (event) => {
	try {
		const body = parseRequest(createActivitySchema, await parseJsonBody(event.request));
		const now = new Date();

		const idempotencyHeader = event.request.headers.get('idempotency-key');
		const idempotencyKey =
			idempotencyHeader !== null
				? parseRequest(idempotencyKeySchema, idempotencyHeader)
				: undefined;

		const result = await createActivity({
			projectId: body.projectId,
			description: body.description,
			date: body.date,
			startedAt: body.startedAt,
			endedAt: body.endedAt,
			durationMinutes: body.durationMinutes,
			untrackedPolicy: body.untrackedPolicy,
			dryRun: body.dryRun,
			previewToken: body.previewToken,
			idempotencyKey,
			now
		});
		return json(result, { status: 201 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
