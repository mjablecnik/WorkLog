/**
 * The elapsed-time store — a rune-based factory holding exactly one number, the
 * elapsed seconds of the open session, which is exactly what
 * `GET /api/sessions/current` returns (Requirement 3.3). It never treats its own
 * ticking as truth: `sync()` replaces it from the server on load, on
 * `visibilitychange` back to visible, and after every start and stop
 * (Requirement 3.10).
 *
 * Deliberately does **not** hold `trackedSecondsToday` — the endpoint does not return
 * it, so nothing here could refresh it, and the day's totals come from the page data
 * instead (which the caller invalidates on the same `visibilitychange`, per
 * Requirement 3.12, so the two go stale and fresh together rather than one lagging
 * the other).
 */
import type { CurrentSessionResponse } from '$lib/contracts/responses';

export function createElapsed(initial: { openedAt: Date | null }) {
	const startingSeconds = initial.openedAt
		? Math.max(0, Math.floor((Date.now() - initial.openedAt.getTime()) / 1000))
		: 0;

	let running = $state(initial.openedAt !== null);
	// The seconds elapsed as of `baseAtMs` — from the server's own `elapsedSeconds`
	// after a sync(), or 0 at a fresh start(). The tick between syncs is computed from
	// the CLIENT's clock, but the anchor itself always comes from the server, so a
	// skewed device clock cannot make the number wrong for longer than one tick.
	let baseSeconds = $state(startingSeconds);
	let baseAtMs = $state(Date.now());
	let nowMs = $state(Date.now());
	let stale = $state(false);

	$effect(() => {
		if (!running) return;
		const id = setInterval(() => {
			nowMs = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	const runningSeconds = $derived(
		running ? baseSeconds + Math.max(0, Math.floor((nowMs - baseAtMs) / 1000)) : baseSeconds
	);

	return {
		get runningSeconds() {
			return runningSeconds;
		},
		get stale() {
			return stale;
		},
		/** Called on load, on `visibilitychange` back to visible, and after every start/stop. */
		sync(state: CurrentSessionResponse) {
			running = state.session !== null;
			baseSeconds = state.elapsedSeconds;
			baseAtMs = Date.now();
			nowMs = baseAtMs;
			stale = state.stale;
		},
		/** Optimistic — the caller rolls back with `sync()` if the start action fails. */
		start() {
			running = true;
			baseSeconds = 0;
			baseAtMs = Date.now();
			nowMs = baseAtMs;
			stale = false;
		},
		/** Optimistic — the caller rolls back with `sync()` if the stop action fails. */
		stop() {
			running = false;
			baseSeconds = 0;
			baseAtMs = Date.now();
			nowMs = baseAtMs;
			stale = false;
		}
	};
}

/**
 * Requirement 3.18: the current Logical_Day rolls over while a page is open, and the
 * browser never computes the boundary itself — it only schedules against the instant
 * `event.locals.today.bounds.end` already handed it. Returns a cleanup function.
 * Not part of `createElapsed`'s own return type because the rollover affects every
 * open page, not only the timer page's elapsed readout; a page wires this up with its
 * own `invalidateAll` from `$app/navigation`.
 */
export function scheduleLogicalDayRollover(boundsEnd: Date, onRollover: () => void): () => void {
	const delayMs = boundsEnd.getTime() - Date.now();
	// A boundary already in the past (a stale server render) fires on the next tick
	// rather than never, and setTimeout clamps a very large delay on its own.
	const id = setTimeout(onRollover, Math.max(0, delayMs));
	return () => clearTimeout(id);
}
