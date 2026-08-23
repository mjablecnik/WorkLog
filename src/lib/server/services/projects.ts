/**
 * The one body of every `Project` write. Requirement 14 (Dry_Run) never mentions
 * `Project` — only `Activity_Entry` and `Work_Session` writes support it — so this
 * service is a thin transactional wrapper with nothing else to orchestrate.
 */
import type { Project } from '$lib/contracts/models';
import { withTx } from '../store/tx';
import * as projectsStore from '../store/projects';

export async function createProject(name: string): Promise<Project> {
	return withTx((tx) => projectsStore.createProject(tx, name));
}

export async function patchProject(
	id: string,
	patch: { name?: string; archived?: boolean; colorIndex?: number }
): Promise<Project> {
	return withTx((tx) => projectsStore.updateProject(tx, id, patch));
}

export async function deleteProject(id: string): Promise<void> {
	return withTx((tx) => projectsStore.deleteProject(tx, id));
}
