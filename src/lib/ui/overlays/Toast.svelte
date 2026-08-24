<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '../elements/Icon.svelte';
	import * as m from '$lib/paraglide/messages';
	import { SUCCESS_DISMISS_MS, type ToastAction, type ToastVariant } from './toast-store.svelte';

	interface Props {
		message: string;
		variant: ToastVariant;
		/** An accent text action — `error` toasts only (design.md's Toast spec). */
		action?: ToastAction;
		onDismiss: () => void;
	}

	let { message, variant, action, onDismiss }: Props = $props();

	const icon = $derived(variant === 'success' ? 'check' : 'warning');

	onMount(() => {
		// A failure never auto-dismisses — a message the user did not see is the
		// same as no message. Only a success carries a timer.
		if (variant !== 'success') return;
		const timer = setTimeout(() => onDismiss(), SUCCESS_DISMISS_MS);
		return () => clearTimeout(timer);
	});

	function handleAction(): void {
		action?.onclick();
		onDismiss();
	}
</script>

<div class="toast toast--{variant}" aria-atomic="true">
	<span class="toast__icon" aria-hidden="true">
		<Icon name={icon} size={15} />
	</span>
	<p class="toast__message">{message}</p>
	{#if action}
		<button type="button" class="toast__action" onclick={handleAction}>
			{action.label}
		</button>
	{/if}
	<button type="button" class="toast__close" onclick={onDismiss} aria-label={m.common_close()}>
		<Icon name="close" size={14} />
	</button>
</div>

<style>
	.toast {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		width: 100%;
		max-width: 420px;
		padding: 12px 16px;
		border-radius: var(--radius-14);
		background: var(--dialog);
		color: var(--text);
		box-shadow: var(--dialog-shadow);
		pointer-events: auto;
		animation: toast-in var(--dur-hover) var(--ease-standard);
		--focus-gap: var(--dialog);
	}

	.toast__icon {
		display: inline-flex;
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--text-dim);
	}

	.toast--success .toast__icon {
		color: var(--accent);
	}

	.toast--error .toast__icon {
		color: var(--destructive);
	}

	.toast__message {
		flex: 1;
		margin: 0;
		font-size: 13.5px;
		line-height: 1.4;
		word-break: break-word;
	}

	.toast__action {
		flex-shrink: 0;
		border: none;
		background: transparent;
		padding: 0;
		color: var(--accent);
		font: inherit;
		font-size: 13.5px;
		font-weight: 500;
		cursor: pointer;
		transition: color var(--dur-hover) var(--ease-standard);
	}
	.toast__action:hover {
		color: var(--accent-hover);
	}

	.toast__close {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		margin: -4px -6px -4px 0;
		border: none;
		border-radius: 9999px;
		background: transparent;
		color: var(--text-faint);
		cursor: pointer;
		transition:
			background-color var(--dur-hover) var(--ease-standard),
			color var(--dur-hover) var(--ease-standard);
	}
	.toast__close:hover {
		background: var(--chip);
		color: var(--text-dim);
	}
	.toast__close:active {
		transform: none;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
