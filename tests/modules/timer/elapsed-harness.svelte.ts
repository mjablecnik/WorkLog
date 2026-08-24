/**
 * Test-only harness for `createElapsed` (task 6.9). `elapsed.svelte.ts` calls `$effect`
 * internally (the once-a-second tick), and Svelte 5 requires an effect context for
 * that — calling `createElapsed()` from a bare `.test.ts` file throws `effect_orphan`
 * (confirmed empirically while writing this test: "`$effect` can only be used inside
 * an effect"). A `.svelte` host component (the pattern `DayGaugeHost.svelte` and
 * `ChangePreviewHost.svelte` already establish for props a plain `render()` call can't
 * express) is one way to supply that context; this file is the equivalent for a bare
 * store with no markup of its own, using `$effect.root()` directly rather than
 * mounting a component. It only works because THIS file has the `.svelte.ts`
 * extension — Svelte's Vite plugin compiles `.svelte.js`/`.svelte.ts` files too, which
 * is what makes runes legal here at all; a plain `.test.ts` file is never compiled and
 * cannot use them (confirmed empirically too: `rune_outside_svelte`).
 *
 * `flushSync()` is required after both root creation and every call that changes
 * state the internal tick `$effect` depends on (`running`) — reading `$derived`
 * getters is a pull, but the `$effect` that sets up/tears down `setInterval` only
 * reruns on a flush, exactly like a real component only re-renders after one.
 */
import { flushSync } from 'svelte';
import { createElapsed } from '../../../src/modules/timer/elapsed.svelte';

/**
 * Runs `fn` against a freshly created `createElapsed(initial)` inside an
 * `$effect.root()`, flushing once after creation so the tick effect's initial
 * `setInterval`/no-op decision has already run before `fn` sees the store. The root
 * is torn down (cancelling any pending `setInterval`) before this returns.
 */
export function withElapsed<T>(
	initial: { openedAt: Date | null },
	fn: (store: ReturnType<typeof createElapsed>) => T
): T {
	let store!: ReturnType<typeof createElapsed>;
	const cleanup = $effect.root(() => {
		store = createElapsed(initial);
	});
	flushSync();
	try {
		return fn(store);
	} finally {
		cleanup();
	}
}

/** Flushes pending Svelte reactivity — call after anything that mutates the store's
 * state (`start()`, `stop()`, `sync()`) and before reading `runningSeconds`/`stale`
 * again, so the tick effect has had a chance to notice a `running` change. */
export { flushSync };
