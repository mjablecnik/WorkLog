<script lang="ts">
	import Toast from './Toast.svelte';
	import { getToasts, removeToast } from './toast-store.svelte';

	const toasts = $derived(getToasts());
	const successToasts = $derived(toasts.filter((toast) => toast.variant === 'success'));
	const errorToasts = $derived(toasts.filter((toast) => toast.variant === 'error'));
</script>

<!--
	Exactly two live regions in the whole interface, and both are mounted here, empty,
	at first paint — a region created only once its first message arrives is not
	announced by most screen readers (design.md's Announcements table). Never
	conditionally render either `role` container itself; only the toasts inside it
	come and go.
-->
<div class="toast-stack">
	<div class="toast-region" role="status" aria-live="polite">
		{#each successToasts as toast (toast.id)}
			<Toast
				message={toast.message}
				variant={toast.variant}
				action={toast.action}
				onDismiss={() => removeToast(toast.id)}
			/>
		{/each}
	</div>
	<div class="toast-region" role="alert" aria-live="assertive">
		{#each errorToasts as toast (toast.id)}
			<Toast
				message={toast.message}
				variant={toast.variant}
				action={toast.action}
				onDismiss={() => removeToast(toast.id)}
			/>
		{/each}
	</div>
</div>

<style>
	.toast-stack {
		position: fixed;
		z-index: 70;
		left: 16px;
		right: 16px;
		bottom: 16px;
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}

	.toast-region {
		display: flex;
		flex-direction: column-reverse;
		align-items: inherit;
		gap: 8px;
		width: 100%;
	}

	@media (min-width: 768px) {
		.toast-stack {
			left: auto;
			align-items: flex-end;
		}
	}
</style>
