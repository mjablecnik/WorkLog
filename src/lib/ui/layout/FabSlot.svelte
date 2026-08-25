<script lang="ts">
	/**
	 * Lets a page supply content for the mobile FAB `Shell.svelte` reserves
	 * space for, without the root layout needing to know what that page is —
	 * the other half of `fab-slot.svelte.ts`. Usage, once per page:
	 *
	 * ```svelte
	 * <FabSlot>
	 *   {#snippet children()}
	 *     <Fab icon="plus" label={m.some_label()} onclick={...} />
	 *   {/snippet}
	 * </FabSlot>
	 * ```
	 *
	 * The assignment below is a plain top-level statement, not `$effect` —
	 * Svelte effects never run during server rendering, and the FAB has to be
	 * part of the server-rendered markup like everything else in the shell,
	 * not something that only appears after hydration. `onDestroy` is what
	 * clears the slot again on a client-side navigation away from this page,
	 * since nothing else will; it only clears the slot if this instance's own
	 * snippet is still the one registered, so an already-superseded `FabSlot`
	 * unmounting late can never clobber a newer page's content.
	 *
	 * `untrack()` around the read is deliberate — the same "one-time snapshot
	 * of a prop's initial value" pattern `+layout.svelte` itself documents for
	 * `initTheme()`/`initLocale()`: a page's `children` snippet is a stable
	 * reference declared once in its own template, never reassigned to a
	 * different snippet for the lifetime of one `FabSlot` instance, so there is
	 * nothing later to react to — and `$effect` cannot run during SSR anyway,
	 * so a reactive read would only ever fire on the client, one render late.
	 */
	import type { Snippet } from 'svelte';
	import { onDestroy, untrack } from 'svelte';
	import { getFabSlot } from './fab-slot.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const slot = getFabSlot();

	untrack(() => {
		slot.content = children;
	});

	onDestroy(() => {
		if (slot.content === children) slot.content = null;
	});
</script>
