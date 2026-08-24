import type { Action } from 'svelte/action';

/**
 * Native date/time inputs only open their picker when the calendar icon itself is
 * clicked. This opens it for a click anywhere in the field, matching how other
 * inputs behave. Ported verbatim from the template — no token to rewrite here.
 */
export const openPickerOnClick: Action<HTMLInputElement> = (node) => {
	function handleClick() {
		if (node.disabled) return;
		node.showPicker?.();
	}

	node.addEventListener('click', handleClick);

	return {
		destroy() {
			node.removeEventListener('click', handleClick);
		}
	};
};
