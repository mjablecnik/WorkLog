<script lang="ts">
	import Icon from '../elements/Icon.svelte';
	import Button from '../elements/Button.svelte';
	import type { IconName } from '../elements/Icon.svelte';

	interface EmptyStateAction {
		label: string;
		onclick: () => void;
	}

	interface Props {
		icon: IconName;
		/** The single line of body text — already translated by the caller; this
		 * component holds no literal UI text of its own. */
		message: string;
		/** Present only where there is an obvious next step (start the timer, create
		 * the first project, pick another range) — every empty state in this
		 * interface has one. */
		action?: EmptyStateAction;
		class?: string;
	}

	let { icon, message, action, class: className = '' }: Props = $props();
</script>

<div class="empty-state {className}">
	<Icon name={icon} size={20} class="empty-state__icon" />
	<p class="empty-state__message">{message}</p>
	{#if action}
		<Button variant="primary" onclick={action.onclick}>
			{action.label}
		</Button>
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		width: 100%;
		padding: 48px 24px;
		text-align: center;
	}

	.empty-state :global(.empty-state__icon) {
		color: var(--text-faint);
	}

	.empty-state__message {
		margin: 0;
		max-width: 32em;
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-dim);
	}
</style>
