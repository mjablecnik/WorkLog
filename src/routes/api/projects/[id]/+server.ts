import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { idParam, patchProjectSchema } from '$lib/contracts/schemas';
import { errorResponse, parseJsonBody, parseRequest } from '$lib/server/core/errors';
import { patchProject, deleteProject } from '$lib/server/services/projects';

/** PATCH /api/projects/{id} — Requirements 3.6, 3.10, 3.11. */
export const PATCH: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		const body = parseRequest(patchProjectSchema, await parseJsonBody(event.request));
		const project = await patchProject(id, body);
		return json(project, { status: 200 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};

/** DELETE /api/projects/{id} — Requirements 3.7, 3.8. */
export const DELETE: RequestHandler = async (event) => {
	try {
		const id = parseRequest(idParam, event.params.id);
		await deleteProject(id);
		return new Response(null, { status: 204 });
	} catch (err) {
		return errorResponse(err, event.locals.requestId);
	}
};
