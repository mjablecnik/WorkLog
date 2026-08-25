<script lang="ts">
	/**
	 * The day page's mobile FAB (design.md "Mobile" — "a 54px `+` FAB bottom
	 * right"; `.design/artboards/DayMobile.dc.html`). Written from scratch —
	 * closes .agents/ISSUES.md's "Mobile FAB two-item create sheet still has no
	 * entry point" (UC-305/UC-334): tapping the FAB opens a two-item sheet —
	 * `Přidat úkol` (Activity_Dialog, create mode) and `Přidat úsek timeru`
	 * (Session_Dialog, create mode) — the mobile equivalent of the desktop
	 * heading line's primary `+ Přidat úkol` / ghost `+ úsek` pills. The task is
	 * the everyday action and stays primary/filled here too; the timer block is
	 * the quiet second row (UC-334's own note).
	 *
	 * Portalled bottom sheet over a scrim, on the shared `modal-stack.ts` —
	 * exactly `SettingsMenu.svelte`'s own mobile presentation (grabber, scroll
	 * lock + inert while open, Escape/scrim/outside dismiss, a Tab trap, focus
	 * returned to the FAB on close). Not `Modal.svelte`: that component always
	 * carries its own header/title/close-chip chrome, which a two-row action
	 * sheet does not want.
	 */
	import Fab from '$lib/ui/layout/Fab.svelte';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import * as m from '$lib/paraglide/messages';
	import { pushModal, popModal, isTopModal } from '$lib/ui/overlays/modal-stack';

	interface Props {
		onAddActivity: () => void;
		onAddSession: () => void;
	}

	let { onAddActivity, onAddSession }: Props = $props();

	let open = $state(false);
	let triggerWrapEl: HTMLElement | undefined = $state();
	let panelEl: HTMLElement | undefined = $state();
	let portalEl: HTMLElement | undefined = $state();

	const modalId = Symbol('create-fab-sheet');
	const instanceId = $props.id();
	const panelId = `${instanceId}-create-fab-panel`;

	const FOCUSABLE_SELECTOR = 'button:not([disabled])';

	function focusableElements(): HTMLElement[] {
		if (!panelEl) return [];
		return Array.from(panelEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
	}

	function openSheet(): void {
		open = true;
	}

	function closeSheet(): void {
		if (!open) return;
		open = false;
		triggerWrapEl?.querySelector('button')?.focus();
	}

	function toggleSheet(): void {
		if (open) closeSheet();
		else openSheet();
	}

	function handleAddActivity(): void {
		closeSheet();
		onAddActivity();
	}

	function handleAddSession(): void {
		closeSheet();
		onAddSession();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (!isTopModal(modalId)) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			closeSheet();
			return;
		}

		if (event.key !== 'Tab') return;
		const focusable = focusableElements();
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

	function handleScrimActivate(): void {
		if (!isTopModal(modalId)) return;
		closeSheet();
	}

	/** Same portal pattern as `Modal.svelte`/`SettingsMenu.svelte` — required so
	 * `pushModal`'s inert sweep never inerts the sheet along with the rest of
	 * the page. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy(): void {
				node.remove();
			}
		};
	}

	$effect(() => {
		if (!open || !portalEl) return;
		pushModal(modalId, portalEl);
		const target = focusableElements()[0] ?? null;
		target?.focus();
		return () => popModal(modalId);
	});
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

<span bind:this={triggerWrapEl} class="create-fab__trigger-wrap">
	<Fab
		icon="plus"
		label={m.aria_open_create_menu()}
		onclick={toggleSheet}
		ariaHaspopup="dialog"
		ariaExpanded={open}
		ariaControls={open ? panelId : undefined}
	/>
</span>

{#if open}
	<div use:portal bind:this={portalEl}>
		<!-- The scrim is a click target only — Escape (handled on the window
		     above) is its keyboard equivalent, exactly like Modal.svelte/
		     SettingsMenu.svelte. `role="presentation"` already exempts it from
		     the click/key-events a11y rule. -->
		<div class="create-fab__scrim" onclick={handleScrimActivate} role="presentation"></div>
		<div
			bind:this={panelEl}
			id={panelId}
			class="create-fab__panel"
			role="dialog"
			aria-modal="true"
			aria-label={m.aria_open_create_menu()}
			tabindex="-1"
		>
			<div class="create-fab__grabber" aria-hidden="true"></div>
			<button
				type="button"
				class="create-fab__item create-fab__item--primary"
				onclick={handleAddActivity}
			>
				<span class="create-fab__icon" aria-hidden="true"><Icon name="plus" size={16} /></span>
				{m.day_add_activity()}
			</button>
			<button type="button" class="create-fab__item" onclick={handleAddSession}>
				<span class="create-fab__icon" aria-hidden="true"><Icon name="plus" size={16} /></span>
				{m.day_add_session()}
			</button>
		</div>
	</div>
{/if}

<style>
	.create-fab__trigger-wrap {
		display: contents;
	}

	.create-fab__scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: var(--scrim);
		animation: create-fab-scrim-in var(--dur-panel) var(--ease-standard);
	}

	.create-fab__panel {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 61;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px 16px calc(20px + env(safe-area-inset-bottom));
		background: var(--dialog);
		border-radius: 20px 20px 0 0;
		box-shadow: var(--dialog-shadow);
		--focus-gap: var(--dialog);
		animation: create-fab-sheet-in var(--dur-panel) var(--ease-standard);
	}

	.create-fab__grabber {
		align-self: center;
		width: 38px;
		height: 4px;
		margin-bottom: 4px;
		border-radius: var(--radius-9999);
		background: var(--grabber);
	}

	.create-fab__item {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 52px;
		padding: 0 14px;
		border: none;
		border-radius: var(--radius-14);
		background: var(--chip);
		color: var(--text);
		font-size: 14.5px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}

	.create-fab__item:hover {
		background: var(--chip-hover);
	}
	.create-fab__item:active {
		background: var(--chip-active);
		transform: none;
	}
	.create-fab__item:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--dialog)),
			0 0 0 4px var(--accent);
	}

	.create-fab__item--primary {
		background: var(--accent);
		color: var(--ink-on-accent);
	}
	.create-fab__item--primary:hover {
		background: var(--accent-hover);
	}
	.create-fab__item--primary:active {
		background: var(--accent-hover);
	}

	.create-fab__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		border-radius: var(--radius-9);
		background: color-mix(in srgb, currentColor 14%, transparent);
	}

	@keyframes create-fab-scrim-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes create-fab-sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@media (min-width: 768px) {
		.create-fab__scrim,
		.create-fab__panel {
			display: none;
		}
	}
</style>
