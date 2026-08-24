<script lang="ts">
	/**
	 * Test-only wrapper around `ChangePreview` (task 5.3). `confirmDisabled` is a
	 * `$bindable` **output** of `ChangePreview` (see the component's own header
	 * comment) — a real caller binds a local variable to it, so the test does the
	 * same and reports every value through `onConfirmDisabledChange` rather than
	 * exposing internal Svelte state across the render() boundary, which
	 * `@testing-library/svelte` has no supported way to read back directly.
	 */
	import ChangePreview from '../../../../src/modules/day/components/ChangePreview.svelte';
	import type { Preview } from '../../../../src/modules/day/dry-run';

	interface Props {
		preview: Preview | null;
		loading: boolean;
		untrackedPolicy: 'clip' | 'extend';
		onPolicyChange: (policy: 'clip' | 'extend') => void;
		timeZone: string;
		onConfirmDisabledChange: (value: boolean) => void;
	}

	let { preview, loading, untrackedPolicy, onPolicyChange, timeZone, onConfirmDisabledChange }: Props =
		$props();

	let confirmDisabled = $state(false);

	$effect(() => {
		onConfirmDisabledChange(confirmDisabled);
	});
</script>

<ChangePreview {preview} {loading} {untrackedPolicy} {onPolicyChange} {timeZone} bind:confirmDisabled />
