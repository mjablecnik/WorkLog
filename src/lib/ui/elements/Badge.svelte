<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** `success` / `warning` / `info` variants from the template are dropped — this
		 * project's token set has no counterpart for them (only `--destructive` and the
		 * neutral surface tokens exist; the project palette is reserved for project
		 * identity and is never repurposed for generic UI semantics). */
		variant?: 'default' | 'error';
		class?: string;
		children: Snippet;
	}

	let { variant = 'default', class: className = '', children }: Props = $props();
</script>

<span class="badge badge--{variant} {className}">
	{@render children()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.4;
		white-space: nowrap;
	}

	.badge--default {
		background-color: var(--panel);
		color: var(--text-dim);
	}

	.badge--error {
		background-color: var(--destructive);
		color: var(--ink-on-accent);
	}
</style>
