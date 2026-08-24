/**
 * The projects page's server contact (tasks.md 7.1; Requirement 11; design.md's
 * "Projects" and "Statistics and Projects, Mobile" sections). Lists every `Project` —
 * archived included, the page itself decides what to show — with its own thirty-day
 * `Covered_Time`, and carries every write (create/rename/archive/unarchive/recolor/
 * delete) as a named form action calling spec 001's `services/projects.ts` directly,
 * per design.md's "Read and Write Paths": a page never calls its own `/api/projects`
 * REST route.
 */
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { superValidate, setError } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import type { Interval, Project } from '$lib/contracts/models';
import { createProjectSchema, patchProjectSchema, idParam } from '$lib/contracts/schemas';
import { ApiError } from '$lib/server/core/errors';
import { createProject, patchProject, deleteProject } from '$lib/server/services/projects';
import { listProjects } from '$lib/server/store/projects';
import { withReadTx } from '$lib/server/store/tx';
import { daySummaries } from '$lib/server/store/aggregates';
import {
	buildDayResolver,
	dayWindowsInRange,
	eveningStartFor,
	gaugeWindowFor
} from '$lib/server/services/day-aggregation';
import { getConfig } from '$lib/server/core/config';
import * as m from '$lib/paraglide/messages';

/** Requirement 11.1: "the last thirty Logical_Day values". */
const COVERAGE_WINDOW_DAYS = 30;

// Plain calendar-day arithmetic on a `YYYY-MM-DD` string, duplicated from
// `src/routes/stats/+page.server.ts` rather than shared: both files are the one
// caller each has, modules never import from `src/routes/`, and there is no third
// call site yet to justify a shared helper.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateString(date: string): { y: number; m: number; d: number } {
	const match = DATE_RE.exec(date);
	if (match === null) throw new Error(`invalid date: ${JSON.stringify(date)}`);
	return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function addCalendarDays(date: string, days: number): string {
	const { y, m, d } = parseDateString(date);
	const shifted = new Date(Date.UTC(y, m, d) + days * 86_400_000);
	const yyyy = shifted.getUTCFullYear().toString().padStart(4, '0');
	const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
	const dd = shifted.getUTCDate().toString().padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** A `Project` plus its `Covered_Time` summed over the coverage window — what
 * `ProjectRow.svelte` renders per row. */
export type ProjectWithCoverage = Project & { coveredSeconds: number };

// Row-scoped action schemas. `createProjectSchema` and `patchProjectSchema` (task
// 7.1's brief) carry no `id` — a REST PATCH takes it from the URL, but a form action
// has no URL param to read it from, so each of these adds exactly one `id: idParam`
// field to a schema built from the shared ones' own field validators (`.shape.name`,
// `.shape.colorIndex.unwrap()`) rather than duplicating their constraints by hand.
const renameSchema = z.object({ id: idParam, name: createProjectSchema.shape.name }).strict();
const recolorSchema = z
	.object({ id: idParam, colorIndex: patchProjectSchema.shape.colorIndex.unwrap() })
	.strict();
const projectIdSchema = z.object({ id: idParam }).strict();

/** `PROJECT_EXISTS`'s detail names the project already holding that name — which is
 * not necessarily the exact string the user typed, since the collision is
 * case/whitespace-insensitive (Requirement 11.3). */
function projectExistsDetails(err: ApiError): { projectName?: string } {
	return (err.details as { projectName?: string } | undefined) ?? {};
}

export const load: PageServerLoad = async ({ locals }) => {
	const today = locals.today.date;
	const config = getConfig();
	const dayResolver = buildDayResolver(config);
	const firstDate = addCalendarDays(today, -(COVERAGE_WINDOW_DAYS - 1));

	const rangeInterval: Interval = {
		start: dayResolver.bounds(firstDate).start,
		end: dayResolver.bounds(today).end
	};
	const dayWindows = dayWindowsInRange(dayResolver, rangeInterval);
	const gaugeWindows = dayWindows.map((d) => gaugeWindowFor(dayResolver, d.date, config));
	const eveningStarts = dayWindows.map((d) =>
		eveningStartFor(dayResolver, d.date, d.window, config)
	);
	const now = new Date();

	const { projects, coveredByProject } = await withReadTx(async (tx) => {
		const projectList = await listProjects(tx, true);
		// No intervals requested — every figure this page needs (`byProject[].coveredSeconds`)
		// is a summary field, exactly like the statistics page's `wantsIntervals: false` path.
		const summaries = await daySummaries(tx, dayWindows, { gaugeWindows, eveningStarts, now });

		const coveredByProject = new Map<string, number>();
		for (const day of summaries) {
			for (const project of day.byProject) {
				coveredByProject.set(
					project.projectId,
					(coveredByProject.get(project.projectId) ?? 0) + project.coveredSeconds
				);
			}
		}
		return { projects: projectList, coveredByProject };
	});

	// A minimal local sum, not `foldProjectTotals` from `$modules/stats/aggregate.ts`:
	// that helper folds everything past the top seven projects into one "Other" row,
	// which is exactly right for a chart legend but wrong here — Requirement 11.1 asks
	// this page to list EVERY project's own total, never merged away.
	const projectsWithCoverage: ProjectWithCoverage[] = projects.map((project) => ({
		...project,
		coveredSeconds: coveredByProject.get(project.id) ?? 0
	}));
	const totalCoveredSeconds = [...coveredByProject.values()].reduce((sum, v) => sum + v, 0);

	return {
		projects: projectsWithCoverage,
		totalCoveredSeconds,
		activeCount: projects.filter((p) => !p.archived).length
	};
};

export const actions: Actions = {
	create: async (event) => {
		const form = await superValidate(event, zod4(createProjectSchema));
		if (!form.valid) return fail(400, { form });
		try {
			await createProject(form.data.name);
		} catch (err) {
			if (err instanceof ApiError && err.code === 'PROJECT_EXISTS') {
				const { projectName } = projectExistsDetails(err);
				return setError(form, 'name', m.errors_project_exists({ projectName: projectName ?? form.data.name }));
			}
			throw err;
		}
		return { form };
	},

	rename: async (event) => {
		const form = await superValidate(event, zod4(renameSchema));
		if (!form.valid) return fail(400, { form });
		try {
			await patchProject(form.data.id, { name: form.data.name });
		} catch (err) {
			if (err instanceof ApiError && err.code === 'PROJECT_EXISTS') {
				const { projectName } = projectExistsDetails(err);
				return setError(form, 'name', m.errors_project_exists({ projectName: projectName ?? form.data.name }));
			}
			throw err;
		}
		return { form };
	},

	archive: async (event) => {
		const form = await superValidate(event, zod4(projectIdSchema));
		if (!form.valid) return fail(400, { form });
		await patchProject(form.data.id, { archived: true });
		return { form };
	},

	unarchive: async (event) => {
		const form = await superValidate(event, zod4(projectIdSchema));
		if (!form.valid) return fail(400, { form });
		await patchProject(form.data.id, { archived: false });
		return { form };
	},

	recolor: async (event) => {
		const form = await superValidate(event, zod4(recolorSchema));
		if (!form.valid) return fail(400, { form });
		await patchProject(form.data.id, { colorIndex: form.data.colorIndex });
		return { form };
	},

	// Requirement 11.8: the delete control stays enabled unconditionally — the list
	// carries no reference count to disable it from — and a blocked delete explains
	// PROJECT_IN_USE rather than failing silently, offering archiving instead.
	delete: async (event) => {
		const form = await superValidate(event, zod4(projectIdSchema));
		if (!form.valid) return fail(400, { form });
		try {
			await deleteProject(form.data.id);
		} catch (err) {
			if (err instanceof ApiError && err.code === 'PROJECT_IN_USE') {
				// `deleteProject`'s PROJECT_IN_USE detail carries `entryCount` and a sample of
				// blocking entries, never a `projectName` — the caller already has one, since
				// this is a row's own delete action and the row already renders that name.
				const details = (err.details as { entryCount?: number }) ?? {};
				return fail(409, {
					form,
					projectInUse: { projectId: form.data.id, entryCount: details.entryCount ?? 0 }
				});
			}
			throw err;
		}
		return { form };
	}
};
