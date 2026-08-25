<script lang="ts">
	/**
	 * A combobox over non-archived `Project` values with substring search, full
	 * keyboard navigation and inline creation (design.md § 8, task 7.2).
	 *
	 * Two visual states: closed shows the selected project (swatch + name, plus an
	 * `archived` badge when that project is itself archived — Requirement 11.12, so
	 * fixing a typo never forces re-assigning the record) as read-only text inside the
	 * field; open replaces it with a live search query and a `listbox` of the
	 * non-archived projects that match it (Requirement 11.6 — archived projects are
	 * never offered as a fresh choice). The ARIA shape follows the W3C APG "editable
	 * combobox with list autocomplete" pattern: `role="combobox"` lives on the text
	 * input, `aria-activedescendant` tracks the highlighted `option`, and the popup is
	 * a `listbox`.
	 *
	 * Creation is the one legitimate `fetch` this component performs (see design.md's
	 * Read-and-Write-Paths table) — `POST /api/projects` with `{ name }`, matching
	 * `createProjectSchema` exactly. A successful response calls `onChange` with the
	 * new id and `onCreate` with the revived `Project`, then closes the dropdown
	 * without touching the surrounding dialog (Requirement 6.8). A failed request
	 * shows the server's own message inline, beside the create row, and keeps the
	 * typed name so nothing is lost.
	 */
	import type { Project } from '$lib/contracts/models';
	import { projectSlotClass } from '$lib/viz/palette';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import Badge from '$lib/ui/elements/Badge.svelte';
	import Spinner from '$lib/ui/elements/Spinner.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		/** The full list, including archived — Requirement 11.12 needs the archived
		 * project itself to resolve the closed display when it is the current value.
		 * The open list filters archived projects out internally (Requirement 11.6). */
		projects: Project[];
		/** The selected Project's id, or `null` when nothing is chosen yet. */
		value: string | null;
		onChange: (projectId: string) => void;
		/** Fired once, after a successful inline creation, so the caller can merge the
		 * new Project into its own list/selection without a reload. */
		onCreate: (project: Project) => void;
		id?: string;
		name?: string;
		required?: boolean;
		disabled?: boolean;
		error?: boolean;
		class?: string;
		'aria-describedby'?: string;
	}

	let {
		projects,
		value,
		onChange,
		onCreate,
		id,
		name,
		required = false,
		disabled = false,
		error = false,
		class: className = '',
		'aria-describedby': describedBy
	}: Props = $props();

	const uid = $props.id();
	const listboxId = `project-picker-${uid}-listbox`;
	const createOptionId = `${listboxId}-option-create`;

	/** Per-browser only (never affects first paint — see infra-env-configuration's
	 * localStorage rule) — a most-recently-first list of project ids, read fresh
	 * each time the dropdown opens and written on every selection. Convenience,
	 * never required: any read/write failure (private browsing, quota, disabled
	 * storage) just falls back to showing every project, unranked. */
	const RECENT_STORAGE_KEY = 'worklog_recent_projects';
	const RECENT_MAX = 10;

	function readRecentIds(): string[] {
		try {
			const raw = localStorage.getItem(RECENT_STORAGE_KEY);
			if (!raw) return [];
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
		} catch {
			return [];
		}
	}

	function recordRecentId(id: string): void {
		try {
			const next = [id, ...readRecentIds().filter((v) => v !== id)].slice(0, RECENT_MAX);
			localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// See the doc comment above — recency is a convenience only.
		}
	}

	let rootEl: HTMLDivElement | undefined = $state();
	let inputEl: HTMLInputElement | undefined = $state();

	let open = $state(false);
	/** The live search text — only meaningful while `open`. */
	let query = $state('');
	let activeIndex = $state(0);
	let creating = $state(false);
	let createError = $state<string | null>(null);
	/** Refreshed by `openDropdown` — see `recentProjects` below. */
	let recentIds = $state<string[]>([]);

	const selectedProject = $derived(value ? (projects.find((p) => p.id === value) ?? null) : null);
	const selectedArchived = $derived(selectedProject?.archived ?? false);

	const nonArchived = $derived(projects.filter((p) => !p.archived));
	const noProjectsAtAll = $derived(nonArchived.length === 0);
	const trimmedQuery = $derived(query.trim());

	/** The closed-query default view: up to `RECENT_MAX` projects, most recently
	 * used first, padded with the remaining non-archived projects (in their
	 * existing order) when usage history is too thin to fill it — so a new or
	 * light user still sees every project rather than a sparse-looking list. */
	const recentProjects = $derived.by((): Project[] => {
		const byId = new Map(nonArchived.map((p): [string, Project] => [p.id, p]));
		const known: Project[] = [];
		for (const id of recentIds) {
			const project = byId.get(id);
			if (project) known.push(project);
		}
		if (known.length >= Math.min(RECENT_MAX, nonArchived.length)) return known.slice(0, RECENT_MAX);
		const seen = new Set(known.map((p) => p.id));
		return [...known, ...nonArchived.filter((p) => !seen.has(p.id))].slice(0, RECENT_MAX);
	});

	const filtered = $derived(
		trimmedQuery === ''
			? recentProjects
			: nonArchived.filter((p) => p.name.toLocaleLowerCase().includes(trimmedQuery.toLocaleLowerCase()))
	);

	/** "Create <typed name>" only once there is a name to create — with no projects at
	 * all this still appears the moment the user types the first character, since
	 * `filtered` is trivially empty until then (Requirement 11.13). */
	const showCreateRow = $derived(trimmedQuery !== '' && filtered.length === 0);
	/** The "nothing matches" caption is a distinct state from "no projects exist yet" —
	 * the latter skips straight to the create row instead (design.md task 7.2). */
	const showEmptyMessage = $derived(!noProjectsAtAll && trimmedQuery !== '' && filtered.length === 0);

	const optionsCount = $derived(filtered.length + (showCreateRow ? 1 : 0));
	const safeActiveIndex = $derived(Math.min(activeIndex, Math.max(optionsCount - 1, 0)));
	const activeOptionId = $derived(
		optionsCount === 0
			? undefined
			: safeActiveIndex < filtered.length
				? optionId(safeActiveIndex)
				: createOptionId
	);

	const displayValue = $derived(open ? query : (selectedProject?.name ?? ''));

	function optionId(index: number): string {
		return `${listboxId}-option-${index}`;
	}

	function openDropdown(): void {
		if (open || disabled) return;
		open = true;
		query = '';
		createError = null;
		recentIds = readRecentIds();
		const idx = recentProjects.findIndex((p) => p.id === value);
		activeIndex = idx >= 0 ? idx : 0;
	}

	function closeDropdown(): void {
		open = false;
		query = '';
	}

	/**
	 * `openDropdown` is also bound to the input's `onfocus`, so restoring focus after a
	 * programmatic close (selection, inline creation) would normally fire a real `focus`
	 * event and reopen the dropdown it was just told to close. In the ordinary mouse
	 * flow this never surfaces, because the option row's `onmousedown` already calls
	 * `preventDefault()`, which keeps the input's DOM focus intact through the click, so
	 * `.focus()` here is a same-element no-op that fires nothing — but any OTHER
	 * selection path (a future keyboard shortcut, assistive tech, a programmatic call)
	 * would hit the reopen. This flag makes the restore-focus-without-reopening
	 * intent explicit rather than relying on that masking.
	 */
	let suppressFocusOpen = false;
	function focusInputWithoutReopening(): void {
		suppressFocusOpen = true;
		inputEl?.focus();
	}

	function handleInputFocus(): void {
		if (suppressFocusOpen) {
			suppressFocusOpen = false;
			return;
		}
		openDropdown();
	}

	function selectProject(project: Project): void {
		onChange(project.id);
		recordRecentId(project.id);
		closeDropdown();
		focusInputWithoutReopening();
	}

	function handleInput(event: Event): void {
		query = (event.currentTarget as HTMLInputElement).value;
		if (!open) open = true;
		activeIndex = 0;
	}

	function handleControlClick(): void {
		if (disabled) return;
		inputEl?.focus();
		openDropdown();
	}

	async function handleKeydown(event: KeyboardEvent): Promise<void> {
		if (disabled) return;
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				if (!open) {
					openDropdown();
					return;
				}
				activeIndex = Math.min(safeActiveIndex + 1, Math.max(optionsCount - 1, 0));
				return;
			case 'ArrowUp':
				event.preventDefault();
				if (!open) {
					openDropdown();
					return;
				}
				activeIndex = Math.max(safeActiveIndex - 1, 0);
				return;
			case 'Home':
				if (!open) return;
				event.preventDefault();
				activeIndex = 0;
				return;
			case 'End':
				if (!open) return;
				event.preventDefault();
				activeIndex = Math.max(optionsCount - 1, 0);
				return;
			case 'Enter':
				if (!open) {
					event.preventDefault();
					openDropdown();
					return;
				}
				if (optionsCount === 0) return;
				event.preventDefault();
				if (safeActiveIndex < filtered.length) {
					selectProject(filtered[safeActiveIndex]);
				} else {
					await handleCreate();
				}
				return;
			case 'Escape':
				if (!open) return;
				// Consumed here so the dialog beneath does not also close on this Escape.
				event.preventDefault();
				event.stopPropagation();
				closeDropdown();
				return;
			default:
				return;
		}
	}

	type WireProject = {
		id: string;
		name: string;
		colorIndex: number;
		archivedAt: string | null;
		archived: boolean;
		createdAt: string;
		updatedAt: string;
	};

	type WireErrorBody = {
		error: string;
		message: string;
		messageKey: string;
		requestId: string;
		details?: Record<string, unknown>;
	};

	function reviveProject(raw: WireProject): Project {
		return {
			id: raw.id,
			name: raw.name,
			colorIndex: raw.colorIndex,
			archivedAt: raw.archivedAt === null ? null : new Date(raw.archivedAt),
			archived: raw.archived,
			createdAt: new Date(raw.createdAt),
			updatedAt: new Date(raw.updatedAt)
		};
	}

	/** Maps the server's error envelope to its Paraglide message, the same lookup
	 * `ChangePreview.svelte` performs for a `Rejection` (`src/modules/day/dry-run.ts`) —
	 * duplicated locally rather than shared, since this is only the second call site. */
	function rejectionMessage(body: WireErrorBody): string {
		const fn = (m as unknown as Record<string, (inputs?: Record<string, unknown>) => string>)[
			body.messageKey
		];
		if (typeof fn !== 'function') return body.messageKey;
		try {
			return fn(body.details ?? {});
		} catch {
			return body.messageKey;
		}
	}

	async function handleCreate(): Promise<void> {
		const newName = trimmedQuery;
		if (newName === '' || creating || disabled) return;
		creating = true;
		createError = null;
		try {
			const res = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: newName })
			});
			const body = await res.json();
			if (!res.ok) {
				createError = rejectionMessage(body as WireErrorBody);
				return;
			}
			const project = reviveProject(body as WireProject);
			onChange(project.id);
			onCreate(project);
			recordRecentId(project.id);
			closeDropdown();
			focusInputWithoutReopening();
		} catch {
			// A genuine network failure, not a server error envelope — there is no
			// requestId to quote. Minimal local handling only (design.md task 7.2);
			// full error-toast wiring is a later task's concern.
			createError = m.errors_internal_error({ requestId: '—' });
		} finally {
			creating = false;
		}
	}
</script>

<div class="project-picker {className}" bind:this={rootEl}>
	<div
		class="project-picker__control"
		class:project-picker__control--open={open}
		class:project-picker__control--error={error}
		class:project-picker__control--disabled={disabled}
		onclick={handleControlClick}
		role="presentation"
	>
		{#if !open && selectedProject}
			<span class="project-picker__swatch {projectSlotClass(selectedProject.colorIndex)}" aria-hidden="true"
			></span>
		{:else}
			<Icon name="search" size={16} class="project-picker__icon" />
		{/if}

		<input
			bind:this={inputEl}
			{id}
			{name}
			{required}
			{disabled}
			type="text"
			role="combobox"
			autocomplete="off"
			spellcheck="false"
			class="project-picker__field"
			value={displayValue}
			placeholder={m.projects_picker_search()}
			aria-expanded={open}
			aria-controls={listboxId}
			aria-autocomplete="list"
			aria-haspopup="listbox"
			aria-activedescendant={activeOptionId}
			aria-invalid={error}
			aria-describedby={describedBy}
			onfocus={handleInputFocus}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onblur={closeDropdown}
		/>

		{#if !open && selectedArchived}
			<Badge>{m.projects_archived_badge()}</Badge>
		{/if}

		<Icon
			name="chevron-down"
			size={16}
			class="project-picker__chevron {open ? 'project-picker__chevron--open' : ''}"
		/>
	</div>

	{#if open}
		<ul class="project-picker__listbox" id={listboxId} role="listbox">
			{#each filtered as project, index (project.id)}
				<!-- Keyboard selection is handled on the input's own keydown (Enter/arrows) —
				     the same pattern SettingsMenu.svelte and Modal.svelte use for their scrim. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(index)}
					role="option"
					aria-selected={project.id === value}
					class="project-picker__option"
					class:project-picker__option--active={index === safeActiveIndex}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => selectProject(project)}
				>
					<span class="project-picker__swatch {projectSlotClass(project.colorIndex)}" aria-hidden="true"
					></span>
					<span class="project-picker__option-name">{project.name}</span>
				</li>
			{/each}

			{#if showEmptyMessage}
				<li class="project-picker__empty" role="presentation">{m.projects_picker_empty()}</li>
			{/if}

			{#if showCreateRow}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={createOptionId}
					role="option"
					aria-selected="false"
					aria-disabled={creating}
					class="project-picker__option project-picker__option--create"
					class:project-picker__option--active={filtered.length === safeActiveIndex}
					onmousedown={(event) => event.preventDefault()}
					onclick={handleCreate}
				>
					{#if creating}
						<Spinner size={14} />
					{:else}
						<Icon name="plus" size={16} />
					{/if}
					<span class="project-picker__create-label">{m.projects_picker_create({ name: trimmedQuery })}</span>
					<span class="project-picker__create-hint">{m.projects_colour_auto()}</span>
				</li>
			{/if}

			{#if createError}
				<li class="project-picker__error" role="alert">{createError}</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.project-picker {
		position: relative;
		width: 100%;
	}

	.project-picker__control {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 2.25rem 0.5rem 0.75rem;
		border-radius: var(--radius-11);
		background-color: var(--field);
		cursor: text;
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.project-picker__control:hover:not(.project-picker__control--disabled) {
		background-color: var(--field-active-bg);
	}

	/* No accent ring on --open/:focus-within — the dropdown opening and the
	   chevron flipping (below) are already the "this is active" signal, on any
	   focus method: `handleInputFocus` opens the dropdown on a Tab-in exactly
	   like it does on a click. */

	.project-picker__control--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}

	.project-picker__control--disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.project-picker :global(.project-picker__icon) {
		flex-shrink: 0;
		color: var(--text-faint);
	}

	.project-picker__swatch {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-2);
		background: var(--pj);
	}

	.project-picker__field {
		flex: 1 1 auto;
		min-width: 0;
		border: none;
		background: transparent;
		color: var(--text);
		font-size: 0.875rem;
		cursor: inherit;
	}

	/* :focus-visible, not just :focus: Chromium always treats a text-editable
	   input as focus-visible on click (not only on Tab), so the bare :focus
	   rule alone would still leave theme.css's global accent ring showing —
	   suppressed here for the same reason as .project-picker__control's own
	   comment above: the dropdown opening on every focus method already says
	   "this is active". */
	.project-picker__field:focus,
	.project-picker__field:focus-visible {
		outline: none;
		box-shadow: none;
	}

	/* 16px, not the resting 14px design.md's type scale specifies — see
	   TimeInput.svelte's identical note on why, and why only while focused. */
	.project-picker__field:focus {
		font-size: 1rem;
	}

	.project-picker__field::placeholder {
		color: var(--text-faint);
	}

	.project-picker :global(.project-picker__chevron) {
		position: absolute;
		right: 0.75rem;
		flex-shrink: 0;
		color: var(--text-faint);
		transition: transform var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.project-picker :global(.project-picker__chevron--open) {
		transform: rotate(180deg);
	}

	.project-picker__listbox {
		position: absolute;
		z-index: 10;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		margin: 0;
		padding: 6px;
		list-style: none;
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--menu-border);
		border-radius: var(--radius-14);
		background-color: var(--dialog);
		box-shadow: var(--menu-shadow);
	}

	.project-picker__option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-9);
		color: var(--text);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.project-picker__option:hover,
	.project-picker__option--active {
		background-color: var(--row-hover);
	}

	.project-picker__option-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-picker__option--create {
		color: var(--accent);
	}

	.project-picker__create-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-picker__create-hint {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--text-faint);
		font-size: 0.75rem;
	}

	.project-picker__empty {
		padding: 0.5rem 0.625rem;
		color: var(--text-faint);
		font-size: 0.8125rem;
	}

	.project-picker__error {
		padding: 0.5rem 0.625rem;
		color: var(--destructive);
		font-size: 0.8125rem;
	}
</style>
