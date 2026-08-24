<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from '../elements/Button.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		title: string;
		/** Names exactly what will be lost — never a bare "are you sure?". */
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		/** `destructive` swaps the confirm pill to a filled `--destructive` button. */
		variant?: 'primary' | 'destructive';
		/** Disables both pills and shows progress on the confirm one while the
		 * confirmed action is in flight. */
		loading?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open,
		title,
		message,
		confirmLabel,
		cancelLabel,
		variant = 'primary',
		loading = false,
		onconfirm,
		oncancel
	}: Props = $props();
</script>

<Modal {open} {title} size="sm" onclose={oncancel}>
	<p class="confirm-dialog__message">{message}</p>

	{#snippet footer()}
		<div class="modal__footer-actions">
			<Button variant="ghost" disabled={loading} onclick={oncancel}>
				{cancelLabel ?? m.common_cancel()}
			</Button>
			<Button {variant} {loading} onclick={onconfirm}>
				{confirmLabel ?? m.common_confirm()}
			</Button>
		</div>
	{/snippet}
</Modal>

<style>
	.confirm-dialog__message {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--text-dim);
	}
</style>
