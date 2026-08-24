<script lang="ts">
	/**
	 * The projects page's assembly (tasks.md 7.1; design.md's "Projects" section and
	 * its Project Structure listing, which names `src/modules/projects/pages/
	 * ProjectsPage.svelte` even though `+page.svelte` (task 3.7's day page) is this
	 * codebase's other precedent for skipping that indirection — kept here anyway for
	 * consistency with the listed file tree, per the task's own instructions.
	 *
	 * Structural props only, never `PageData`/`ActionData` from `./$types` — those are
	 * route-local generated types, and modules never import from `src/routes/`
	 * (design.md's module boundary). `src/routes/projects/+page.svelte` passes `data`
	 * straight through; the shapes are structurally identical to what
	 * `+page.server.ts`'s `load` returns.
	 *
	 * No action's result is read from the page's own shared `form` export: every
	 * write here is a row-scoped (or, for creation, page-scoped) form whose own
	 * `use:enhance` callback owns its UI feedback locally — the same reasoning
	 * `ProjectRow.svelte` documents, so that one submission never makes an unrelated
	 * row (or this header) react to it.
	 */
	import { enhance, applyAction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import type { Project } from '$lib/contracts/models';
	import * as m from '$lib/paraglide/messages';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import Spinner from '$lib/ui/elements/Spinner.svelte';
	import EmptyState from '$lib/ui/components/EmptyState.svelte';
	import ProjectRow from '$modules/projects/components/ProjectRow.svelte';

	interface Props {
		projects: (Project & { coveredSeconds: number })[];
		totalCoveredSeconds: number;
		/** Count of non-archived projects — Requirement 11.1's `projects_meta`, always
		 * the active count regardless of the "show archived" toggle. */
		activeCount: number;
	}

	let { projects, totalCoveredSeconds, activeCount }: Props = $props();

	// Requirement 11.5: archived projects hidden by default.
	let showArchived = $state(false);
	const visibleProjects = $derived(showArchived ? projects : projects.filter((p) => !p.archived));

	// Requirement 11.13: zero projects at all — not just zero after filtering
	// archived — is the only case the empty state covers.
	const noProjectsAtAll = $derived(projects.length === 0);

	let createName = $state('');
	let creating = $state(false);
	let createErrors = $state<string[]>([]);
	let createInputEl: HTMLInputElement | undefined = $state();

	const createErrorId = 'projects-page-create-error';

	function focusCreateInput(): void {
		createInputEl?.focus();
	}

	function handleCreateEnhance() {
		creating = true;
		return async ({ result }: { result: ActionResult }) => {
			creating = false;
			if (result.type === 'success') {
				createErrors = [];
				createName = '';
				await invalidateAll();
				return;
			}
			if (result.type === 'failure') {
				const data = result.data as { form?: { errors?: { name?: string[] } } } | undefined;
				createErrors = data?.form?.errors?.name ?? [];
				return;
			}
			await applyAction(result);
		};
	}
</script>

<svelte:head>
	<title>{m.projects_title()}</title>
</svelte:head>

<div class="projects-page">
	<div class="projects-page__inner">
		<div class="projects-page__header">
			<h1 class="projects-page__title">{m.projects_title()}</h1>
			<span class="projects-page__meta">{m.projects_meta({ count: activeCount })}</span>
			<div class="projects-page__header-spacer"></div>

			{#if !noProjectsAtAll}
				<button
					type="button"
					class="projects-page__archived-toggle"
					aria-pressed={showArchived}
					onclick={() => (showArchived = !showArchived)}
				>
					{showArchived ? m.projects_hide_archived() : m.projects_show_archived()}
				</button>
			{/if}

			<form
				method="POST"
				action="?/create"
				class="projects-page__create"
				use:enhance={handleCreateEnhance}
			>
				<input
					bind:this={createInputEl}
					name="name"
					type="text"
					class="projects-page__create-input"
					class:projects-page__create-input--error={createErrors.length > 0}
					bind:value={createName}
					placeholder={m.projects_name_label()}
					aria-label={m.projects_name_label()}
					aria-invalid={createErrors.length > 0}
					aria-describedby={createErrors.length > 0 ? createErrorId : undefined}
					disabled={creating}
				/>
				<button type="submit" class="projects-page__create-btn" disabled={creating}>
					{#if creating}
						<Spinner size={14} />
					{:else}
						<Icon name="plus" size={14} />
					{/if}
					{m.projects_new()}
				</button>
			</form>
		</div>

		{#if createErrors.length > 0}
			<p class="projects-page__create-error" id={createErrorId} role="alert">
				{createErrors[0]}
			</p>
		{/if}

		{#if noProjectsAtAll}
			<div class="projects-page__empty">
				<EmptyState
					icon="projects"
					message={m.projects_empty_title()}
					action={{ label: m.projects_new(), onclick: focusCreateInput }}
				/>
				<p class="projects-page__empty-body">{m.projects_empty_body()}</p>
			</div>
		{:else if visibleProjects.length > 0}
			<div class="projects-page__list">
				{#each visibleProjects as project (project.id)}
					<ProjectRow {project} {totalCoveredSeconds} />
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.projects-page {
		display: flex;
		justify-content: center;
		padding: 24px 48px;
	}

	.projects-page__inner {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 940px;
		gap: 22px;
	}

	.projects-page__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
	}

	.projects-page__title {
		margin: 0;
		font-size: 20px;
		font-weight: 500;
		color: var(--text);
	}

	.projects-page__meta {
		font-size: 13px;
		color: var(--text-faint);
	}

	.projects-page__header-spacer {
		flex: 1 1 auto;
	}

	.projects-page__archived-toggle {
		border: none;
		background: transparent;
		color: var(--text-dim);
		font-size: 13px;
		cursor: pointer;
	}

	.projects-page__archived-toggle:hover {
		color: var(--text);
	}

	.projects-page__create {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.projects-page__create-input {
		width: 160px;
		height: 38px;
		padding: 0 12px;
		border: none;
		border-radius: var(--radius-9999);
		background: var(--field);
		color: var(--text);
		font: inherit;
		font-size: 13.5px;
	}

	.projects-page__create-input:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 4px var(--accent);
	}

	.projects-page__create-input--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}

	.projects-page__create-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 38px;
		padding: 0 18px;
		border: none;
		border-radius: var(--radius-9999);
		background: var(--accent);
		color: var(--ink-on-accent);
		font-size: 13.5px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}

	.projects-page__create-btn:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.projects-page__create-error {
		align-self: flex-end;
		margin: -14px 0 0;
		font-size: 12.5px;
		color: var(--destructive);
	}

	.projects-page__list {
		border-radius: var(--radius-14);
		background: var(--panel);
	}

	.projects-page__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		border-radius: var(--radius-14);
		background: var(--panel);
	}

	.projects-page__empty-body {
		margin: -24px 0 24px;
		font-size: 14px;
		color: var(--text-dim);
		text-align: center;
	}

	@media (max-width: 767px) {
		.projects-page {
			padding: 16px 16px 24px;
		}

		.projects-page__create-input {
			width: 100%;
			flex: 1 1 auto;
		}

		.projects-page__create {
			width: 100%;
		}
	}
</style>
