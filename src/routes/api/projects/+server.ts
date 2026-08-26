import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ProjectListResponse } from '$lib/contracts/responses';
import { createProjectSchema, listProjectsQuery } from '$lib/contracts/schemas';
import { errorResponse, parseJsonBody, parseRequest } from '$lib/server/core/errors';
import { withReadTx } from '$lib/server/store/tx';
import { listProjects } from '$lib/server/store/projects';
import { createProject } from '$lib/server/services/projects';

/** GET /api/projects — Requirements 3.4, 3.5. A bare array, nothing pages it. */
export const GET: RequestHandler = async (event) => {
	try {
		const query = parseRequest(listProjectsQuery, Object.fromEntries(event.url.searchParams));
		const projects = await withReadTx((tx) => listProjects(tx, query.include_archived === 'true'));
		const response: ProjectListResponse = projects;
		return json(response, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/** POST /api/projects — Requirements 3.1, 3.2, 3.3, 3.9. */
export const POST: RequestHandler = async (event) => {
	try {
		const body = parseRequest(createProjectSchema, await parseJsonBody(event.request));
		const project = await createProject(body.name, body.billable);
		return json(project, { status: 201 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
