<script lang="ts">
	interface Props {
		size?: number;
		/** Accessible name for the `status` role. Left to the caller — this is a generic,
		 * data-driven element and must not hardcode UI-facing text (see `src/lib/ui/elements`
		 * conventions). Omit it if the surrounding context already announces the loading state. */
		label?: string;
		class?: string;
	}

	let { size = 20, label, class: className = '' }: Props = $props();
</script>

<svg
	class="spinner {className}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	role="status"
	aria-label={label}
>
	<circle
		class="spinner__track"
		cx="12"
		cy="12"
		r="10"
		stroke="currentColor"
		stroke-width="3"
		opacity="0.25"
	/>
	<path
		class="spinner__indicator"
		d="M12 2a10 10 0 0 1 10 10"
		stroke="currentColor"
		stroke-width="3"
		stroke-linecap="round"
	/>
</svg>

<style>
	.spinner {
		display: inline-block;
		flex-shrink: 0;
		color: currentColor;
		animation: spinner-rotate 0.8s linear infinite;
	}

	@keyframes spinner-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.5s;
		}
	}
</style>
