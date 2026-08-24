<script lang="ts">
	/**
	 * Task 6.7 (design.md's "Timer Page" bullet 2 and "9. Timer Control" section;
	 * Requirements 3.1, 3.2, 3.15, 3.20). The start/stop button itself — mounted in
	 * `DayGauge`'s `center` snippet by `+page.svelte`, dead-centre over the dial.
	 *
	 * A single real `<form method="POST" use:enhance>` around one `<button
	 * type="submit">` — never a `<div>` with a click handler — so Tab reaches it and
	 * both Enter and Space activate it for free, exactly as native `<button>`
	 * semantics already give any submit control in this codebase (Requirement 3.15).
	 * The form's own `action` switches between `?/start` and `?/stop` reactively with
	 * `running`; `use:enhance` reads the form's live `action`/`method` at the moment a
	 * submit actually happens, so a mid-transition state is never possible — by the
	 * time the button is next clickable, `running` (and therefore `action`) has
	 * already settled to match what the last write really produced.
	 *
	 * PROP SHAPE — the task brief's own inferred `{ running, onStart, onStop, density
	 * }` (design.md gives this component no literal `type … Props` block, same
	 * situation `DayGauge`/`QuickLog` document for themselves). `onStart`/`onStop`
	 * are fired synchronously at submit time, BEFORE the network round trip resolves
	 * — the optimistic half of Requirement 3.13/design.md's "applies the change
	 * optimistically and rolls back with the reason on failure". This component only
	 * owns that pre-submit optimism and its own submitting/disabled state; the
	 * authoritative sync-from-server-response and the rollback-on-failure both live
	 * in `+page.svelte`; they watch the shared `form` (`ActionData`) this submit
	 * naturally populates via `update()` below — the same "watch `form` reactively"
	 * mechanism `QuickLog.svelte` already uses for its own action, just centralised
	 * one level up here because start/stop/stopAt all need the identical treatment
	 * and `+page.svelte` is the one place already holding the `elapsed` store and the
	 * toast wiring. Keeping the network/rollback logic OUT of this component is also
	 * what lets it stay ignorant of `elapsed.svelte.ts`/the toast store entirely,
	 * matching how `DayGauge`'s `center` snippet and `QuickLog`'s `onLogged`/
	 * `onOpenDialog` are the only seams those siblings expose too.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/ui/elements/Icon.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { Density } from '$modules/day/components/timeline-geometry';

	interface Props {
		running: boolean;
		density: Density;
		onStart: () => void;
		onStop: () => void;
	}

	let { running, density, onStart, onStop }: Props = $props();

	let submitting = $state(false);

	const handleSubmit: SubmitFunction = () => {
		submitting = true;
		if (running) onStop();
		else onStart();
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	};

	const iconSize = $derived(density === 'desktop' ? 42 : 40);
</script>

<form method="POST" action={running ? '?/stop' : '?/start'} use:enhance={handleSubmit}>
	<button
		type="submit"
		class="timer-control timer-control--{density}"
		disabled={submitting}
		aria-label={running ? m.timer_stop() : m.timer_start()}
		title={running ? m.timer_stop() : m.timer_start()}
	>
		<Icon name={running ? 'timer-stop' : 'timer-start'} size={iconSize} />
	</button>
</form>

<style>
	.timer-control {
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: var(--radius-full);
		background-color: var(--accent);
		color: var(--ink-on-accent);
		cursor: pointer;
		box-shadow: 0 0 0 12px rgb(from var(--accent) r g b / 0.09);
		transition:
			background-color var(--dur-hover, 200ms) var(--ease-standard, ease),
			box-shadow var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.timer-control--desktop {
		width: 104px;
		height: 104px;
	}

	.timer-control--mobile {
		width: 98px;
		height: 98px;
		box-shadow: 0 0 0 11px rgb(from var(--accent) r g b / 0.09);
	}

	.timer-control:not(:disabled):hover {
		background-color: var(--accent-hover);
	}

	.timer-control:disabled {
		cursor: not-allowed;
		opacity: 0.7;
	}

	.timer-control:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}
</style>
