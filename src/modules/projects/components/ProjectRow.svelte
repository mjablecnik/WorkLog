<script lang="ts">
	/**
	 * One row of the projects page (tasks.md 7.1; design.md's "Projects" and
	 * "Statistics and Projects, Mobile" sections; Requirement 11).
	 *
	 * One `<div class="project-row">` serves both densities — only its `flex-direction`
	 * changes at the 768 px breakpoint, exactly like `ProjectBreakdown.svelte`'s own
	 * reflow. `.project-row__main` (icon box, name, archived badge) is always line one;
	 * `.project-row__meta` (duration, share bar, then either the three action buttons or
	 * the single overflow button) is the rest of the same line on desktop and a second
	 * line on mobile. `order` on its children — never DOM reordering — lets one DOM
	 * order (duration, bar, actions, overflow) read as "bar, duration, actions" on
	 * desktop (the artboard's order) and "duration, bar, overflow" on mobile (the
	 * written mobile contract's order) without a JS density prop.
	 *
	 * The share bar is the same SVG-`<rect>`-percentage technique
	 * `ProjectBreakdown.svelte` (task 8.2) established — a `viewBox="0 0 100 H"` with a
	 * `--track` rect and a `--pj` rect sized by a `width="{percent}%"` presentation
	 * attribute, never a CSS custom property or an inline `style=`. `H`/radius here are
	 * 6/3 rather than `ProjectBreakdown`'s 8/4 because that is what `Projects.dc.html`
	 * draws for this page — the technique is shared, the artboard's own pixel value for
	 * *this* surface is not.
	 *
	 * The colour control (Requirement 11.10) lives inside the row it changes on both
	 * densities: the identity icon box is itself the desktop trigger (design.md: "the
	 * row's swatch" is what activates the strip), and the mobile action sheet carries
	 * "Změnit barvu" as its fourth item — both toggle the same `colorStripOpen` state
	 * and render the same eight-swatch strip beneath the row.
	 *
	 * The mobile overflow sheet reuses `SettingsMenu.svelte`'s own MECHANISM — the
	 * shared `modal-stack.ts` (`pushModal`/`popModal`/`isTopModal` for scroll-lock,
	 * `inert` and top-modal Escape/scrim handling) plus its `portal` action, ported
	 * verbatim rather than re-derived — while the panel content (four project actions,
	 * not the theme/locale/logout block `SettingsMenu` owns) is this component's own.
	 * `SettingsMenu.svelte` itself is left untouched, per the task's file list.
	 */
	import { enhance, applyAction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import type { Project } from '$lib/contracts/models';
	import { projectSlotClass, PALETTE_SIZE } from '$lib/viz/palette';
	import { formatDuration } from '$lib/viz/format';
	import * as m from '$lib/paraglide/messages';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import Badge from '$lib/ui/elements/Badge.svelte';
	import Spinner from '$lib/ui/elements/Spinner.svelte';
	import ConfirmDialog from '$lib/ui/overlays/ConfirmDialog.svelte';
	import { pushModal, popModal, isTopModal } from '$lib/ui/overlays/modal-stack';
	import { addErrorToast } from '$lib/ui/overlays/toast-store.svelte';

	interface Props {
		project: Project & { coveredSeconds: number };
		/** All projects' thirty-day `Covered_Time` summed — this row's share denominator
		 * (Requirement 11.14). */
		totalCoveredSeconds: number;
	}

	let { project, totalCoveredSeconds }: Props = $props();

	const uid = $props.id();
	const nameErrorId = `${uid}-project-row-name-error`;
	const sheetPanelId = `${uid}-project-row-sheet`;

	const colourIndices = Array.from({ length: PALETTE_SIZE }, (_, i) => i);

	function fmtDuration(seconds: number): string {
		return formatDuration(seconds, '');
	}

	const sharePercent = $derived(
		totalCoveredSeconds > 0 ? (project.coveredSeconds / totalCoveredSeconds) * 100 : 0
	);
	const archiveActionUrl = $derived(project.archived ? '?/unarchive' : '?/archive');

	/** A submission's own `enhance` callback is the source of truth for this row's UI
	 * (whether the field stays open, which error shows) — never the page's shared
	 * `form` export, which one row's submission would otherwise make every other row
	 * react to as well. */
	async function fallbackHandle(result: ActionResult): Promise<void> {
		if (result.type === 'success') {
			await invalidateAll();
		} else if (result.type !== 'failure') {
			await applyAction(result);
		}
	}

	// ---------------------------------------------------------------------------
	// Rename — an inline text field replacing the name (Requirement 11.4).
	// ---------------------------------------------------------------------------
	let editingName = $state(false);
	// Never read before `startRename()` sets it from `project.name` — the field only
	// renders once `editingName` is true, and only `startRename()` sets that. Starting
	// empty (rather than `$state(project.name)`) avoids capturing just the prop's
	// initial value, which Svelte would otherwise warn about.
	let nameDraft = $state('');
	let renaming = $state(false);
	let renameErrors = $state<string[]>([]);
	let nameInputEl: HTMLInputElement | undefined = $state();

	function startRename(): void {
		nameDraft = project.name;
		renameErrors = [];
		editingName = true;
		queueMicrotask(() => nameInputEl?.focus());
	}

	function cancelRename(): void {
		editingName = false;
		renameErrors = [];
	}

	function handleNameKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename();
		}
	}

	function handleRenameEnhance() {
		renaming = true;
		return async ({ result }: { result: ActionResult }) => {
			renaming = false;
			if (result.type === 'success') {
				renameErrors = [];
				editingName = false;
				await invalidateAll();
				return;
			}
			if (result.type === 'failure') {
				const data = result.data as { form?: { errors?: { name?: string[] } } } | undefined;
				renameErrors = data?.form?.errors?.name ?? [];
				return;
			}
			await applyAction(result);
		};
	}

	// ---------------------------------------------------------------------------
	// Archive / unarchive — one form, its action swapping with the project's state
	// (Requirement 11.5). Also submittable from the mobile sheet.
	// ---------------------------------------------------------------------------
	let archiving = $state(false);
	let archiveFormEl: HTMLFormElement | undefined = $state();

	function handleArchiveEnhance() {
		archiving = true;
		return async ({ result }: { result: ActionResult }) => {
			archiving = false;
			await fallbackHandle(result);
		};
	}

	// ---------------------------------------------------------------------------
	// Delete — behind ConfirmDialog, the control always enabled (Requirement 11.7,
	// 11.8): the attempt runs regardless of reference count, and a PROJECT_IN_USE
	// response becomes a toast explaining it and suggesting archiving instead —
	// never a silent failure.
	// ---------------------------------------------------------------------------
	let confirmDeleteOpen = $state(false);
	let deleting = $state(false);
	let deleteFormEl: HTMLFormElement | undefined = $state();

	function submitDelete(): void {
		deleteFormEl?.requestSubmit();
	}

	function handleDeleteEnhance() {
		deleting = true;
		return async ({ result }: { result: ActionResult }) => {
			deleting = false;
			confirmDeleteOpen = false;
			if (result.type === 'success') {
				await invalidateAll();
				return;
			}
			if (result.type === 'failure') {
				const data = result.data as { projectInUse?: { entryCount: number } } | undefined;
				if (data?.projectInUse) {
					addErrorToast(
						m.errors_project_in_use({
							projectName: project.name,
							entryCount: data.projectInUse.entryCount
						})
					);
				}
				return;
			}
			await applyAction(result);
		};
	}

	// ---------------------------------------------------------------------------
	// Colour — the eight Palette_Slot swatches expand inside the row (Requirement
	// 11.10). Desktop's trigger is the identity icon box itself; the mobile sheet's
	// "Změnit barvu" item opens the same strip.
	// ---------------------------------------------------------------------------
	let colorStripOpen = $state(false);
	let recoloring = $state(false);

	function toggleColorStrip(): void {
		colorStripOpen = !colorStripOpen;
	}

	function handleRecolorEnhance() {
		recoloring = true;
		return async ({ result }: { result: ActionResult }) => {
			recoloring = false;
			colorStripOpen = false;
			await fallbackHandle(result);
		};
	}

	// ---------------------------------------------------------------------------
	// Mobile overflow sheet — SettingsMenu.svelte's mobile mechanism, ported: the
	// shared modal stack plus a body-portalled scrim+sheet. Requirement 14.24's
	// modal surfaces list already names "the mobile Settings_Menu sheet"; this one
	// follows the identical contract for the identical reason (nothing beneath the
	// scrim may carry its own `opacity`, dimming comes from the scrim alone).
	// ---------------------------------------------------------------------------
	let sheetOpen = $state(false);
	let sheetPanelEl: HTMLElement | undefined = $state();
	let sheetPortalEl: HTMLElement | undefined = $state();
	let overflowBtnEl: HTMLButtonElement | undefined = $state();
	const sheetModalId = Symbol('project-row-sheet');

	const SHEET_FOCUSABLE_SELECTOR = 'button:not([disabled])';

	function sheetFocusable(): HTMLElement[] {
		if (!sheetPanelEl) return [];
		return Array.from(sheetPanelEl.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE_SELECTOR));
	}

	function openSheet(): void {
		sheetOpen = true;
	}

	function closeSheet(): void {
		if (!sheetOpen) return;
		sheetOpen = false;
		overflowBtnEl?.focus();
	}

	function toggleSheet(): void {
		if (sheetOpen) closeSheet();
		else openSheet();
	}

	function handleSheetRename(): void {
		closeSheet();
		startRename();
	}

	function handleSheetArchive(): void {
		closeSheet();
		archiveFormEl?.requestSubmit();
	}

	function handleSheetDelete(): void {
		closeSheet();
		confirmDeleteOpen = true;
	}

	function handleSheetRecolor(): void {
		closeSheet();
		colorStripOpen = true;
	}

	function handleSheetScrimActivate(): void {
		if (!isTopModal(sheetModalId)) return;
		closeSheet();
	}

	function handleSheetKeydown(event: KeyboardEvent): void {
		if (!sheetOpen || !isTopModal(sheetModalId)) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeSheet();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = sheetFocusable();
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function sheetPortal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy(): void {
				node.remove();
			}
		};
	}

	$effect(() => {
		if (!sheetOpen || !sheetPortalEl) return;
		pushModal(sheetModalId, sheetPortalEl);
		const target = sheetFocusable()[0] ?? null;
		target?.focus();
		return () => popModal(sheetModalId);
	});
</script>

<svelte:window onkeydown={sheetOpen ? handleSheetKeydown : undefined} />

<div class="project-row" class:project-row--archived={project.archived}>
	<div class="project-row__main">
		<button
			type="button"
			class="project-row__icon-box {projectSlotClass(project.colorIndex)}"
			aria-expanded={colorStripOpen}
			aria-label={m.aria_project_swatch({ project: project.name })}
			onclick={toggleColorStrip}
		>
			<span class="project-row__swatch" aria-hidden="true"></span>
		</button>

		<div class="project-row__identity">
			{#if editingName}
				<form
					method="POST"
					action="?/rename"
					class="project-row__rename-form"
					use:enhance={handleRenameEnhance}
				>
					<input type="hidden" name="id" value={project.id} />
					<input
						bind:this={nameInputEl}
						name="name"
						type="text"
						class="project-row__name-input"
						class:project-row__name-input--error={renameErrors.length > 0}
						bind:value={nameDraft}
						disabled={renaming}
						aria-label={m.projects_name_label()}
						aria-invalid={renameErrors.length > 0}
						aria-describedby={renameErrors.length > 0 ? nameErrorId : undefined}
						onkeydown={handleNameKeydown}
					/>
					<button type="submit" class="project-row__rename-save" disabled={renaming}>
						{#if renaming}
							<Spinner size={14} />
						{:else}
							{m.common_save()}
						{/if}
					</button>
					<button
						type="button"
						class="project-row__rename-cancel"
						disabled={renaming}
						onclick={cancelRename}
					>
						{m.common_cancel()}
					</button>
				</form>
				{#if renameErrors.length > 0}
					<p class="project-row__error" id={nameErrorId} role="alert">{renameErrors[0]}</p>
				{/if}
			{:else}
				<span class="project-row__name">{project.name}</span>
				{#if project.archived}
					<Badge>{m.projects_archived_badge()}</Badge>
				{/if}
			{/if}
		</div>
	</div>

	<div class="project-row__meta">
		<span class="project-row__duration tabular">{fmtDuration(project.coveredSeconds)}</span>

		<svg
			class="project-row__bar"
			viewBox="0 0 100 6"
			preserveAspectRatio="none"
			role="presentation"
			aria-hidden="true"
		>
			<rect class="project-row__bar-track" x="0" y="0" width="100" height="6" rx="3" ry="3" />
			<rect
				class="project-row__bar-fill {projectSlotClass(project.colorIndex)}"
				x="0"
				y="0"
				width="{sharePercent}%"
				height="6"
				rx="3"
				ry="3"
			/>
		</svg>

		<div class="project-row__actions">
			<button
				type="button"
				class="project-row__icon-btn"
				title={m.projects_rename()}
				aria-label={m.projects_rename()}
				onclick={startRename}
			>
				<Icon name="pencil" size={15} />
			</button>

			<form
				method="POST"
				action={archiveActionUrl}
				bind:this={archiveFormEl}
				use:enhance={handleArchiveEnhance}
			>
				<input type="hidden" name="id" value={project.id} />
				<button
					type="submit"
					class="project-row__icon-btn"
					disabled={archiving}
					title={project.archived ? m.projects_unarchive() : m.projects_archive()}
					aria-label={project.archived ? m.projects_unarchive() : m.projects_archive()}
				>
					{#if archiving}
						<Spinner size={14} />
					{:else}
						<Icon name="archive" size={15} />
					{/if}
				</button>
			</form>

			<button
				type="button"
				class="project-row__icon-btn project-row__icon-btn--destructive"
				title={m.common_delete()}
				aria-label={m.common_delete()}
				onclick={() => (confirmDeleteOpen = true)}
			>
				<Icon name="trash" size={15} />
			</button>
		</div>

		<button
			bind:this={overflowBtnEl}
			type="button"
			class="project-row__overflow"
			aria-haspopup="dialog"
			aria-expanded={sheetOpen}
			aria-label={m.projects_row_actions()}
			onclick={toggleSheet}
		>
			<Icon name="more" size={16} />
		</button>
	</div>

	{#if colorStripOpen}
		<div class="project-row__colour">
			<div class="project-row__colour-head">
				<span class="project-row__colour-label">{m.projects_colour_label()}</span>
				<span class="project-row__colour-auto">{m.projects_colour_auto()}</span>
			</div>
			<form method="POST" action="?/recolor" use:enhance={handleRecolorEnhance}>
				<input type="hidden" name="id" value={project.id} />
				<div class="project-row__colour-grid" role="group" aria-label={m.projects_recolor()}>
					{#each colourIndices as i (i)}
						<button
							type="submit"
							name="colorIndex"
							value={i}
							class="project-row__colour-swatch {projectSlotClass(i)}"
							class:project-row__colour-swatch--active={i === project.colorIndex}
							aria-pressed={i === project.colorIndex}
							aria-label={m.projects_colour_option({ index: i + 1 })}
							disabled={recoloring}
						></button>
					{/each}
				</div>
			</form>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={confirmDeleteOpen}
	title={m.projects_delete_title()}
	message={m.projects_delete_body({ project: project.name })}
	variant="destructive"
	loading={deleting}
	onconfirm={submitDelete}
	oncancel={() => (confirmDeleteOpen = false)}
/>
<form
	method="POST"
	action="?/delete"
	bind:this={deleteFormEl}
	use:enhance={handleDeleteEnhance}
	class="project-row__hidden-form"
>
	<input type="hidden" name="id" value={project.id} />
</form>

{#if sheetOpen}
	<div use:sheetPortal bind:this={sheetPortalEl}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="project-row__sheet-scrim" onclick={handleSheetScrimActivate} role="presentation"
		></div>
		<div
			bind:this={sheetPanelEl}
			id={sheetPanelId}
			class="project-row__sheet-panel"
			role="dialog"
			aria-modal="true"
			aria-label={m.projects_row_actions()}
			tabindex="-1"
		>
			<div class="project-row__sheet-grabber" aria-hidden="true"></div>
			<button type="button" class="project-row__sheet-item" onclick={handleSheetRename}>
				<Icon name="pencil" size={17} />
				<span>{m.projects_rename()}</span>
			</button>
			<button type="button" class="project-row__sheet-item" onclick={handleSheetArchive}>
				<Icon name="archive" size={17} />
				<span>{project.archived ? m.projects_unarchive() : m.projects_archive()}</span>
			</button>
			<button
				type="button"
				class="project-row__sheet-item project-row__sheet-item--destructive"
				onclick={handleSheetDelete}
			>
				<Icon name="trash" size={17} />
				<span>{m.common_delete()}</span>
			</button>
			<button type="button" class="project-row__sheet-item" onclick={handleSheetRecolor}>
				<span
					class="project-row__sheet-swatch {projectSlotClass(project.colorIndex)}"
					aria-hidden="true"
				></span>
				<span>{m.projects_recolor()}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.project-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-top: 1px solid var(--divider);
	}

	.project-row__main {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.project-row__icon-box {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-9);
		background: var(--pj-tint);
		cursor: pointer;
	}

	.project-row__swatch {
		width: 11px;
		height: 11px;
		border-radius: var(--radius-2);
		background: var(--pj);
	}

	.project-row__identity {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		align-items: center;
		gap: 8px;
	}

	.project-row__name {
		overflow: hidden;
		font-size: 14px;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-row__rename-form {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.project-row__name-input {
		flex: 1 1 140px;
		min-width: 0;
		height: 34px;
		padding: 0 10px;
		border: none;
		border-radius: var(--radius-9);
		background: var(--field);
		color: var(--text);
		font: inherit;
		font-size: 14px;
	}

	.project-row__name-input:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 4px var(--accent);
	}

	.project-row__name-input--error {
		box-shadow: inset 0 0 0 1px var(--destructive);
	}

	.project-row__rename-save,
	.project-row__rename-cancel {
		flex-shrink: 0;
		height: 34px;
		padding: 0 12px;
		border: none;
		border-radius: var(--radius-9);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.project-row__rename-save {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 34px;
		background: var(--accent);
		color: var(--ink-on-accent);
	}

	.project-row__rename-cancel {
		background: var(--group);
		color: var(--text-dim);
	}

	.project-row__rename-save:disabled,
	.project-row__rename-cancel:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.project-row__error {
		flex-basis: 100%;
		margin: 0;
		font-size: 12.5px;
		color: var(--destructive);
	}

	.project-row__meta {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.project-row__duration {
		flex-shrink: 0;
		font-size: 13px;
		color: var(--text-dim);
		order: 1;
	}

	.project-row__bar {
		flex: 1 1 auto;
		min-width: 40px;
		height: 6px;
		order: 2;
	}

	.project-row__bar-track {
		fill: var(--track);
	}

	.project-row__bar-fill {
		fill: var(--pj);
		transition: width var(--dur-panel) var(--ease-standard);
	}

	.project-row__actions {
		display: none;
	}

	.project-row__icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: none;
		border-radius: var(--radius-9);
		background: var(--chip);
		color: var(--text-dim);
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}

	.project-row__icon-btn:hover:not(:disabled) {
		background: var(--chip-hover);
	}

	.project-row__icon-btn:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.project-row__icon-btn--destructive {
		color: var(--destructive);
	}

	.project-row__overflow {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		order: 3;
		padding: 0;
		border: none;
		border-radius: var(--radius-9);
		background: var(--chip);
		color: var(--text-dim);
		cursor: pointer;
	}

	.project-row__overflow:hover {
		background: var(--chip-hover);
	}

	.project-row__hidden-form {
		display: none;
	}

	/* -----------------------------------------------------------------------
	 * Colour strip — shared by both densities: eight swatches, 38 tall at
	 * radius 11, the current one ringed (design.md's "Projects" section).
	 * --------------------------------------------------------------------- */
	.project-row__colour {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 4px;
	}

	.project-row__colour-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.project-row__colour-label {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.project-row__colour-auto {
		font-size: 11px;
		color: var(--text-faint);
	}

	.project-row__colour-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 9px;
	}

	.project-row__colour-swatch {
		height: 38px;
		border: none;
		border-radius: var(--radius-11);
		background: var(--pj);
		cursor: pointer;
	}

	.project-row__colour-swatch:disabled {
		cursor: not-allowed;
		opacity: 0.7;
	}

	.project-row__colour-swatch--active {
		box-shadow:
			0 0 0 2px var(--bg),
			0 0 0 4px var(--text);
	}

	/* -----------------------------------------------------------------------
	 * Mobile action sheet — SettingsMenu.svelte's mobile mechanism, ported.
	 * --------------------------------------------------------------------- */
	.project-row__sheet-scrim {
		position: fixed;
		inset: 0;
		z-index: 2;
		background: var(--scrim);
	}

	.project-row__sheet-panel {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 14px calc(18px + env(safe-area-inset-bottom));
		border-radius: 20px 20px 0 0;
		background: var(--dialog);
	}

	.project-row__sheet-grabber {
		align-self: center;
		width: 38px;
		height: 4px;
		margin-bottom: 6px;
		border-radius: var(--radius-9999);
		background: var(--grabber);
	}

	.project-row__sheet-item {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 46px;
		padding: 0 8px;
		border: none;
		border-radius: var(--radius-9);
		background: transparent;
		color: var(--text);
		font-size: 14.5px;
		text-align: left;
		cursor: pointer;
	}

	.project-row__sheet-item:hover {
		background: var(--group);
	}

	.project-row__sheet-item--destructive {
		color: var(--destructive);
	}

	.project-row__sheet-swatch {
		flex-shrink: 0;
		width: 15px;
		height: 15px;
		border-radius: var(--radius-2);
		background: var(--pj);
	}

	@media (min-width: 768px) {
		.project-row {
			flex-direction: row;
			align-items: center;
			gap: 16px;
			padding: 16px 18px;
		}

		.project-row__main {
			flex: 1 1 auto;
		}

		.project-row__icon-box {
			width: 32px;
			height: 32px;
		}

		.project-row__swatch {
			width: 13px;
			height: 13px;
		}

		.project-row__name {
			font-size: 15px;
		}

		.project-row__meta {
			flex-shrink: 0;
			gap: 16px;
		}

		.project-row__duration {
			order: 2;
			width: 96px;
			font-size: 15px;
			font-weight: 300;
			color: var(--text);
			text-align: right;
		}

		.project-row__bar {
			order: 1;
			flex: 0 0 220px;
		}

		.project-row__actions {
			order: 3;
			display: flex;
			flex-shrink: 0;
			gap: 4px;
		}

		.project-row__overflow {
			display: none;
		}
	}
</style>
