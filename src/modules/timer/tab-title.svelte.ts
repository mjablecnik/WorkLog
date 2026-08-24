/**
 * Drives `document.title` from the elapsed store while an `Open_Session` exists, and
 * restores the plain title the moment it stops (Requirement 3.11). Call once, at the
 * top of a component's script — the same "factory sets up its own `$effect`" pattern
 * `createElapsed` (`elapsed.svelte.ts`) uses internally for its own ticking interval.
 *
 * Deliberately takes `running` as an explicit getter rather than deriving it from
 * `elapsed.svelte.ts`'s `runningSeconds` alone: `createElapsed`'s own header comment
 * notes it exposes no "is running" boolean by design, since the caller already knows
 * whether a session is open from page data. This function is otherwise decoupled from
 * `createElapsed` — it only reads two getters, so any store shaped the same way works.
 *
 * Requirement 15's Announcements table lists the tab title alongside the hero elapsed
 * readout and the `Running_Indicator` as digits that are never announced — that rule
 * is about ARIA live regions and `aria-hidden`, neither of which applies here:
 * `document.title` has no accessibility-tree presence at all, so there is nothing to
 * guard beyond simply never routing this value through a live region (which this
 * function, touching only `document.title`, cannot do by construction).
 */
import { formatClock } from '$lib/viz/format';

export function useTabTitle(options: {
	/** A getter, since Svelte 5 runes need read access inside the effect, not a snapshot. */
	runningSeconds: () => number;
	/** Whether an `Open_Session` currently exists — the caller's own page data, per `createElapsed`'s design. */
	running: () => boolean;
	/** Restored the moment `running()` becomes false, and on unmount while an override is active. */
	plainTitle: string;
}): void {
	const { runningSeconds, running, plainTitle } = options;

	$effect(() => {
		if (typeof document === 'undefined') return;

		if (!running()) {
			document.title = plainTitle;
			return;
		}

		document.title = formatClock(runningSeconds());

		return () => {
			document.title = plainTitle;
		};
	});
}
