import { getContext, setContext } from 'svelte';
import type { Snippet } from 'svelte';

/**
 * The FAB passthrough between the root layout and whichever page wants to
 * supply mobile floating-action-button content — the mechanism
 * .agents/ISSUES.md's "No FAB-content mechanism exists between the shell and
 * pages" asked for. `Shell.svelte` only reserves the `fab` snippet slot and
 * its fixed position; it has no way to know what a routed page wants there,
 * and a page has no prop path to reach a slot two components up. This closes
 * that gap with a small Svelte context, read by `FabSlot.svelte`.
 *
 * A context, not a module-level `$state` store like `theme.svelte.ts`/
 * `toast-store.svelte.ts`: those are seeded identically (or empty) on every
 * request, but the FAB's content genuinely differs per route — a module
 * singleton would need every request's render to stay strictly synchronous
 * with no `await` between the day page's assignment and the shell's read to
 * avoid one request's FAB content leaking into another's response. Context
 * sidesteps the question entirely: `createFabSlot()` hands `+layout.svelte`
 * a fresh object every time its own component instance is created (once per
 * request server-side, once per app mount client-side), so there is nothing
 * to leak across requests in the first place.
 */

const FAB_SLOT_KEY = Symbol('fab-slot');

export interface FabSlot {
	content: Snippet | null;
}

/** Called once, from the root layout, before `Shell` is rendered. */
export function createFabSlot(): FabSlot {
	const slot = $state<FabSlot>({ content: null });
	setContext(FAB_SLOT_KEY, slot);
	return slot;
}

/** Called by `FabSlot.svelte`, the only intended consumer — see its own doc
 * comment for how a page uses it. */
export function getFabSlot(): FabSlot {
	const slot = getContext<FabSlot | undefined>(FAB_SLOT_KEY);
	if (!slot) {
		throw new Error('getFabSlot() called outside the root layout — no fab-slot context found');
	}
	return slot;
}
