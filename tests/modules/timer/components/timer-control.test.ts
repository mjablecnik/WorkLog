/**
 * Component tests for `TimerControl` (part of task 6.9; Requirements 3.1, 3.2, 3.13,
 * 3.15). `@testing-library/svelte` in the `components` Vitest project (jsdom), matching
 * the pattern `day-gauge.test.ts`/`activity-dialog.test.ts` already established: small
 * local fixture builders, real Paraglide messages (`baseLocale` "en" resolves with no
 * explicit init step), no fake timers.
 *
 * SCOPE — `TimerControl.svelte`'s own header comment is explicit that this component
 * only owns "pre-submit optimism and its own submitting/disabled state"; the
 * authoritative sync-from-server-response and rollback-on-failure both live one level
 * up in `+page.svelte`, driven by `elapsed.svelte.ts`'s `sync()`. This file therefore
 * does not attempt "a failed action restores the previous state and shows the reason"
 * (tasks.md 6.9's bullet) — there is nothing in `TimerControl` to restore; that
 * behaviour is `elapsed.test.ts`'s `sync()`-overrides-drift test plus `+page.svelte`,
 * which has no established route-component test pattern in this project (see this
 * task's own scoping note). Likewise "Enter and Space both activate" is not simulated
 * here: the component renders a native `<button type="submit">` inside a `<form>`,
 * which is exactly what makes both keys work for free without any JS of this
 * component's own — this file asserts that native structure instead of simulating
 * key events against it, per the task brief's own instruction.
 *
 * MOCKING `$app/forms` — grepped first (see `activity-dialog.test.ts`'s own doc
 * comment for the convention of grepping before deciding): no test anywhere in this
 * suite mocks `$app/forms` yet, so this is the first one. `use:enhance={handleSubmit}`
 * is a Svelte action: SvelteKit's real `enhance(form, submit)` attaches a submit
 * listener, calls `submit(...)` synchronously on submit, and later invokes whatever
 * callback `submit` returned with `{ result, update, ... }` once the network call
 * settles. The mock below reproduces exactly that shape and nothing more — no real
 * `fetch`, no `ActionResult` parsing — since `TimerControl`'s own `handleSubmit`
 * ignores every argument `enhance` would normally pass it and only reads `update` off
 * the object handed to the returned callback. The captured callback is exposed via
 * `getSubmitCallback()` so a test can invoke it manually, on its own schedule, with a
 * `vi.fn()` `update` — exercising the disabled-until-resolved window without an actual
 * round trip.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '../../../../src/lib/paraglide/messages';
import type { Density } from '../../../../src/modules/day/components/timeline-geometry';

type EnhanceUpdateArgs = { update: () => Promise<void> };
type EnhanceCallback = (args: EnhanceUpdateArgs) => void | Promise<void>;
type EnhanceSubmit = () => EnhanceCallback | void;

let submitCallback: EnhanceCallback | null = null;

vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: EnhanceSubmit) => {
		const listener = (event: Event) => {
			event.preventDefault();
			const result = submit();
			submitCallback = typeof result === 'function' ? result : null;
		};
		form.addEventListener('submit', listener);
		return { destroy: () => form.removeEventListener('submit', listener) };
	}
}));

import TimerControl from '../../../../src/modules/timer/components/TimerControl.svelte';

function getSubmitCallback(): EnhanceCallback {
	if (!submitCallback) throw new Error('form was not submitted (or enhance was not wired)');
	return submitCallback;
}

type TimerControlProps = {
	running: boolean;
	density: Density;
	onStart: () => void;
	onStop: () => void;
};

function renderControl(overrides: Partial<TimerControlProps> = {}) {
	return render(TimerControl, {
		props: {
			running: false,
			density: 'desktop',
			onStart: vi.fn(),
			onStop: vi.fn(),
			...overrides
		}
	});
}

beforeEach(() => {
	submitCallback = null;
});

describe('TimerControl', () => {
	it('shows the start icon and label when idle (Requirements 3.1, 3.2)', () => {
		const { container } = renderControl({ running: false });

		const button = screen.getByRole('button', { name: m.timer_start() });
		expect(button).toHaveAttribute('aria-label', m.timer_start());
		expect(button).toHaveAttribute('title', m.timer_start());

		// `Icon.svelte` draws `timer-start` as a filled play-triangle <path> with no
		// <rect>, and `timer-stop` as a filled <rect> with no <path> — asserted
		// structurally rather than by duplicating the path's `d` data, matching
		// `day-gauge.test.ts`'s own "structural, not pixel-based" convention.
		expect(button.querySelector('svg path')).not.toBeNull();
		expect(button.querySelector('svg rect')).toBeNull();
		expect(container.querySelectorAll('button').length).toBe(1);
	});

	it('shows the stop icon and label when running (Requirements 3.1, 3.2)', () => {
		renderControl({ running: true });

		const button = screen.getByRole('button', { name: m.timer_stop() });
		expect(button).toHaveAttribute('aria-label', m.timer_stop());
		expect(button).toHaveAttribute('title', m.timer_stop());
		expect(button.querySelector('svg rect')).not.toBeNull();
		expect(button.querySelector('svg path')).toBeNull();
	});

	it('is a real <button type="submit"> inside a <form> whose action tracks running (Requirement 3.15)', () => {
		const idle = renderControl({ running: false });
		const idleForm = idle.container.querySelector('form')!;
		const idleButton = idle.container.querySelector('button')!;
		expect(idleForm).not.toBeNull();
		expect(idleForm).toHaveAttribute('method', 'POST');
		expect(idleForm.getAttribute('action')).toMatch(/\?\/start$/);
		expect(idleButton).toHaveAttribute('type', 'submit');
		expect(idleForm.contains(idleButton)).toBe(true);
		idle.unmount();

		const running = renderControl({ running: true });
		const runningForm = running.container.querySelector('form')!;
		expect(runningForm.getAttribute('action')).toMatch(/\?\/stop$/);
	});

	it('fires onStart synchronously at submit time when idle (Requirement 3.13)', async () => {
		const onStart = vi.fn();
		const onStop = vi.fn();
		const { container } = renderControl({ running: false, onStart, onStop });

		const form = container.querySelector('form')!;
		await fireEvent.submit(form);

		expect(onStart).toHaveBeenCalledTimes(1);
		expect(onStop).not.toHaveBeenCalled();
	});

	it('fires onStop synchronously at submit time when running (Requirement 3.13)', async () => {
		const onStart = vi.fn();
		const onStop = vi.fn();
		const { container } = renderControl({ running: true, onStart, onStop });

		const form = container.querySelector('form')!;
		await fireEvent.submit(form);

		expect(onStop).toHaveBeenCalledTimes(1);
		expect(onStart).not.toHaveBeenCalled();
	});

	it('disables the button while submitting and re-enables it once the enhance callback resolves (Requirement 3.13)', async () => {
		const { container } = renderControl({ running: false });
		const form = container.querySelector('form')!;
		const button = container.querySelector('button')!;

		expect(button).not.toBeDisabled();

		await fireEvent.submit(form);
		await tick();
		expect(button).toBeDisabled();

		// The captured callback is exactly what `enhance` would invoke once its real
		// network round trip settles — controlled here by hand via a deferred `update`.
		let resolveUpdate!: () => void;
		const update = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveUpdate = resolve;
				})
		);
		const settle = getSubmitCallback()({ update });

		// Still disabled: `update()` has not resolved yet.
		await tick();
		expect(button).toBeDisabled();

		resolveUpdate();
		await settle;
		await tick();

		expect(update).toHaveBeenCalledTimes(1);
		expect(button).not.toBeDisabled();
	});
});
