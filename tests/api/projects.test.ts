import { describe, expect, it } from 'vitest';
import { mockEvent, bodyOf } from './helpers';
import { GET as projectsGet, POST as projectsPost } from '../../src/routes/api/projects/+server';
import {
	PATCH as projectPatch,
	DELETE as projectDelete
} from '../../src/routes/api/projects/[id]/+server';
import { POST as activitiesPost } from '../../src/routes/api/activities/+server';
import { POST as sessionsPost } from '../../src/routes/api/sessions/+server';

const BASE = 'http://localhost';

describe('project routes', () => {
	it('creates a project and rejects a case-insensitive duplicate, naming the existing one', async () => {
		const created = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Acme' } })
			)
		);
		expect(created.name).toBe('Acme');

		const dup = await projectsPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: '  acme  ' } })
		);
		expect(dup.status).toBe(409);
		const dupBody = await bodyOf(dup);
		expect(dupBody.error).toBe('PROJECT_EXISTS');
		expect((dupBody.details as Record<string, unknown>).projectName).toBe('Acme');
	});

	it('rejects an empty name and an over-long name', async () => {
		const empty = await projectsPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: '' } })
		);
		expect(empty.status).toBe(400);

		const long = await projectsPost(
			mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'x'.repeat(201) } })
		);
		expect(long.status).toBe(400);
	});

	it('listing excludes archived by default and includes them with include_archived=true', async () => {
		const created = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Archive Me' } })
			)
		);
		await projectPatch(
			mockEvent({
				method: 'PATCH',
				url: `${BASE}/api/projects/${created.id}`,
				params: { id: created.id as string },
				body: { archived: true }
			})
		);

		const defaultList = (await bodyOf(
			await projectsGet(mockEvent({ url: `${BASE}/api/projects` }))
		)) as unknown as Record<string, unknown>[];
		expect(defaultList.some((p) => p.id === created.id)).toBe(false);

		const withArchived = (await bodyOf(
			await projectsGet(mockEvent({ url: `${BASE}/api/projects?include_archived=true` }))
		)) as unknown as Record<string, unknown>[];
		expect(withArchived.some((p) => p.id === created.id)).toBe(true);
	});

	it('delete in use is rejected with entryCount and blocking entries, delete unused succeeds', async () => {
		const project = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'In Use' } })
			)
		);
		await sessionsPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/sessions`,
				body: { startedAt: '2026-06-10T08:00:00Z', endedAt: '2026-06-10T09:00:00Z' }
			})
		);
		await activitiesPost(
			mockEvent({
				method: 'POST',
				url: `${BASE}/api/activities`,
				body: {
					projectId: project.id,
					description: 'blocking entry',
					startedAt: '2026-06-10T08:00:00Z',
					endedAt: '2026-06-10T08:30:00Z'
				}
			})
		);

		const blocked = await projectDelete(
			mockEvent({
				method: 'DELETE',
				url: `${BASE}/api/projects/${project.id}`,
				params: { id: project.id as string }
			})
		);
		expect(blocked.status).toBe(409);
		const blockedBody = await bodyOf(blocked);
		expect(blockedBody.error).toBe('PROJECT_IN_USE');
		const details = blockedBody.details as Record<string, unknown>;
		expect(details.entryCount).toBe(1);
		expect((details.entries as unknown[]).length).toBe(1);

		const unused = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Unused' } })
			)
		);
		const deleted = await projectDelete(
			mockEvent({
				method: 'DELETE',
				url: `${BASE}/api/projects/${unused.id}`,
				params: { id: unused.id as string }
			})
		);
		expect(deleted.status).toBe(204);
	});

	it('PATCH sets a colour index another project already holds', async () => {
		const a = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Colour A' } })
			)
		);
		const b = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Colour B' } })
			)
		);
		const patched = await bodyOf(
			await projectPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/projects/${b.id}`,
					params: { id: b.id as string },
					body: { colorIndex: a.colorIndex }
				})
			)
		);
		expect(patched.colorIndex).toBe(a.colorIndex);
	});

	// --- 003-worklog-time-categories, task 5.11: billable create/patch, default,
	// and untouched by rename/archive/recolour ---

	it('a project created without billable defaults to true', async () => {
		const created = await bodyOf(
			await projectsPost(
				mockEvent({ method: 'POST', url: `${BASE}/api/projects`, body: { name: 'Default Billable' } })
			)
		);
		expect(created.billable).toBe(true);
	});

	it('create with an explicit billable: false, and PATCH flips it', async () => {
		const created = await bodyOf(
			await projectsPost(
				mockEvent({
					method: 'POST',
					url: `${BASE}/api/projects`,
					body: { name: 'Explicit Unpaid', billable: false }
				})
			)
		);
		expect(created.billable).toBe(false);

		const patched = await bodyOf(
			await projectPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/projects/${created.id}`,
					params: { id: created.id as string },
					body: { billable: true }
				})
			)
		);
		expect(patched.billable).toBe(true);
	});

	it('rename, archive/unarchive and recolour never change billable', async () => {
		const created = await bodyOf(
			await projectsPost(
				mockEvent({
					method: 'POST',
					url: `${BASE}/api/projects`,
					body: { name: 'Stable Billable', billable: false }
				})
			)
		);
		const renamed = await bodyOf(
			await projectPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/projects/${created.id}`,
					params: { id: created.id as string },
					body: { name: 'Stable Billable Renamed' }
				})
			)
		);
		expect(renamed.billable).toBe(false);

		const archived = await bodyOf(
			await projectPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/projects/${created.id}`,
					params: { id: created.id as string },
					body: { archived: true }
				})
			)
		);
		expect(archived.billable).toBe(false);

		const recoloured = await bodyOf(
			await projectPatch(
				mockEvent({
					method: 'PATCH',
					url: `${BASE}/api/projects/${created.id}`,
					params: { id: created.id as string },
					body: { colorIndex: 5 }
				})
			)
		);
		expect(recoloured.billable).toBe(false);
	});
});
