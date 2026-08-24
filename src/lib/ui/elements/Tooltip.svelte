<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		position?: 'top' | 'bottom' | 'left' | 'right';
		children: Snippet;
	}

	let { text, position = 'top', children }: Props = $props();

	const uid = $props.id();
	const tooltipId = `tooltip-${uid}`;
</script>

<span class="tooltip">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<span class="tooltip__trigger" aria-describedby={tooltipId} tabindex="0">
		{@render children()}
	</span>
	<span class="tooltip__bubble tooltip__bubble--{position}" role="tooltip" id={tooltipId}>
		{text}
	</span>
</span>

<style>
	.tooltip {
		position: relative;
		display: inline-flex;
	}

	.tooltip__trigger {
		display: inline-flex;
	}

	.tooltip__trigger:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
		border-radius: 4px;
	}

	.tooltip__bubble {
		position: absolute;
		z-index: 10;
		width: max-content;
		max-width: 240px;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		background-color: var(--dialog);
		color: var(--text);
		box-shadow: var(--dialog-shadow, 0 8px 24px rgba(0, 0, 0, 0.35));
		font-size: 0.78125rem;
		line-height: 1.55;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			visibility var(--dur-hover, 200ms) var(--ease-standard, cubic-bezier(0.2, 0, 0, 1));
		visibility: hidden;
	}

	.tooltip__trigger:hover + .tooltip__bubble,
	.tooltip__trigger:focus-visible + .tooltip__bubble,
	.tooltip__trigger:focus + .tooltip__bubble {
		opacity: 1;
		visibility: visible;
	}

	.tooltip__bubble--top {
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
	}

	.tooltip__bubble--bottom {
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
	}

	.tooltip__bubble--left {
		right: calc(100% + 6px);
		top: 50%;
		transform: translateY(-50%);
	}

	.tooltip__bubble--right {
		left: calc(100% + 6px);
		top: 50%;
		transform: translateY(-50%);
	}
</style>
