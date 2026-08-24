<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../elements/Icon.svelte';
	import * as m from '$lib/paraglide/messages';
	import { pushModal, popModal, isTopModal } from './modal-stack';

	interface Props {
		open: boolean;
		/** Required — every modal surface is labelled by its own heading (Requirement 14.20). */
		title: string;
		/** `sm` (420, `ConfirmDialog`'s width) · `md` (560) · `lg` (720, a wider write dialog). */
		size?: 'sm' | 'md' | 'lg';
		/** Below 768px the dialog fills the screen instead of floating — Requirement 14.15.
		 * Only the two write dialogs (`ActivityDialog`, `SessionDialog`) opt into this;
		 * `ConfirmDialog` and everything else stay a floating panel at every width. */
		fullScreenOnMobile?: boolean;
		/** A confirmation and the `Settings_Menu` close on an outside activation; a write
		 * dialog holds unsaved input and must not (Requirement 14.23) — default `true`. */
		dismissOnScrimClick?: boolean;
		/** The control focus should land on when the dialog opens — a rail edge, the
		 * `Project_Picker`, a description field. Falls back to the first focusable
		 * control inside the dialog when omitted (Requirement 14.21). */
		initialFocusEl?: HTMLElement | null;
		class?: string;
		/** Dialog body. */
		children: Snippet;
		/** Optional footer row — a hint plus a ghost/primary (or destructive) pill pair.
		 * Rendered inside a padded `--footer` band; use the `modal__footer-hint` and
		 * `modal__footer-actions` classes on its content so the mobile full-screen
		 * stacking rules (Requirement 14.15's footer table) apply. */
		footer?: Snippet;
		onclose: () => void;
	}

	let {
		open,
		title,
		size = 'md',
		fullScreenOnMobile = false,
		dismissOnScrimClick = true,
		initialFocusEl = null,
		class: className = '',
		children,
		footer,
		onclose
	}: Props = $props();

	const modalId = Symbol('modal');
	const instanceId = $props.id();
	const headingId = `${instanceId}-heading`;

	let portalEl: HTMLElement | undefined = $state();
	let dialogEl: HTMLElement | undefined = $state();
	let returnFocusEl: HTMLElement | null = null;

	const FOCUSABLE_SELECTOR =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	/** Every focusable element in the dialog, in DOM order — used by the Tab trap,
	 * which must cycle through the close button too. */
	function focusableElements(): HTMLElement[] {
		if (!dialogEl) return [];
		return Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
	}

	/** The control the dialog focuses by default (no `initialFocusEl` given) —
	 * the first focusable control in the body/footer, skipping the header's close
	 * button, which is chrome rather than dialog content. Falls back to the close
	 * button only if the dialog genuinely has nothing else focusable. */
	function defaultFocusTarget(): HTMLElement | null {
		const all = focusableElements();
		const contentOnly = all.filter((el) => !el.closest('.modal__header'));
		return contentOnly[0] ?? all[0] ?? null;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!isTopModal(modalId)) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
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

	function handleScrimClick(): void {
		if (!dismissOnScrimClick) return;
		if (!isTopModal(modalId)) return;
		onclose();
	}

	/** Moves the dialog's DOM node to `document.body` so that `inert`-ing "the page
	 * root" (whatever the root layout wraps its content in) never also inerts the
	 * dialog itself — the two have to be siblings, not ancestor/descendant. */
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

		returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		pushModal(modalId, portalEl);

		const target = initialFocusEl ?? defaultFocusTarget();
		target?.focus();

		return () => {
			popModal(modalId);
			returnFocusEl?.focus();
			returnFocusEl = null;
		};
	});
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<div use:portal bind:this={portalEl}>
		<!-- The scrim is a click target only, never a keyboard one — Escape (handled
		     on the window above) is its keyboard equivalent, and the dialog itself
		     carries the real interactive content. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="modal-overlay"
			class:modal-overlay--fullscreen={fullScreenOnMobile}
			onclick={handleScrimClick}
			role="presentation"
		>
			<div
				bind:this={dialogEl}
				class="modal dialog-panel modal--{size} {className}"
				class:modal--fullscreen-mobile={fullScreenOnMobile}
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				tabindex="-1"
				onclick={(event) => event.stopPropagation()}
			>
				<div class="modal__header">
					<h2 id={headingId} class="modal__title">{title}</h2>
					<button
						type="button"
						class="modal__close"
						onclick={onclose}
						aria-label={m.aria_close_dialog()}
					>
						<Icon name="close" size={18} />
					</button>
				</div>
				<div class="modal__body">
					{@render children()}
				</div>
				{#if footer}
					<div class="modal__footer">
						{@render footer()}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: var(--scrim);
		animation: modal-scrim-in var(--dur-panel) var(--ease-standard);
	}

	.modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-height: calc(100vh - 32px);
		border-radius: var(--radius-20);
		background: var(--dialog);
		box-shadow: var(--dialog-shadow);
		animation: modal-panel-in var(--dur-panel) var(--ease-standard);
		/* Every focusable control inside the dialog rings against the dialog's own
		   ground, not the page's, so it stays visible over an elevated surface. */
		--focus-gap: var(--dialog);
	}

	.modal--sm {
		max-width: 420px;
	}
	.modal--md {
		max-width: 560px;
	}
	.modal--lg {
		max-width: 720px;
	}

	.modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 22px 26px 18px;
	}

	.modal__title {
		margin: 0;
		font-size: 17px;
		font-weight: 500;
		line-height: 1.3;
	}

	.modal__close {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		margin-left: auto;
		border: none;
		border-radius: 9999px;
		background: var(--chip);
		color: var(--text-dim);
		cursor: pointer;
		transition:
			background-color var(--dur-hover) var(--ease-standard),
			color var(--dur-hover) var(--ease-standard);
	}
	.modal__close:hover {
		background: var(--chip-hover);
		color: var(--text);
	}
	.modal__close:active {
		background: var(--chip-active);
		transform: none;
	}

	.modal__body {
		padding: 0 26px 22px;
		overflow-y: auto;
	}

	.modal__footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 16px;
		padding: 16px 26px;
		background: var(--footer);
	}

	:global(.modal__footer-hint) {
		margin-right: auto;
		font-size: 12px;
		color: var(--text-faint);
	}

	:global(.modal__footer-actions) {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	/* --------------------------------------------------------------------
	 * Full-screen mobile — Requirement 14.15. The dialog *is* the viewport:
	 * no scrim, no radius, nothing shows through behind it.
	 * ------------------------------------------------------------------ */
	@media (max-width: 767px) {
		.modal-overlay--fullscreen {
			padding: 0;
		}

		.modal--fullscreen-mobile {
			max-width: none;
			width: 100%;
			height: 100dvh;
			max-height: 100dvh;
			border-radius: 0;
			box-shadow: none;
			animation: modal-sheet-in var(--dur-panel) var(--ease-standard);
		}

		.modal--fullscreen-mobile .modal__header {
			height: 58px;
			padding: 0 20px;
		}

		.modal--fullscreen-mobile .modal__close {
			width: 34px;
			height: 34px;
		}

		.modal--fullscreen-mobile .modal__body {
			flex: 1;
			padding: 0 20px;
		}

		.modal--fullscreen-mobile .modal__footer {
			flex-direction: column;
			align-items: stretch;
			padding: 14px 20px 24px;
			border-top: 1px solid var(--divider);
		}

		.modal--fullscreen-mobile :global(.modal__footer-hint) {
			margin-right: 0;
		}

		.modal--fullscreen-mobile :global(.modal__footer-actions) {
			flex-direction: column-reverse;
			gap: 10px;
		}
	}

	@keyframes modal-scrim-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes modal-panel-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes modal-sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
</style>
