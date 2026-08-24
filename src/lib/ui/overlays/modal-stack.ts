/**
 * Shared modality bookkeeping for every `Modal`-based surface (write dialogs,
 * `ConfirmDialog`, the mobile `Settings_Menu` sheet). Requirements 14.20–14.24.
 *
 * A page can have more than one modal surface open at once — a confirmation
 * opened from inside a write dialog, for instance — so this is a stack, not a
 * single flag. `document.body` is scroll-locked and its other children are
 * marked `inert` only on the 0 → 1 transition, and restored only on the 1 → 0
 * transition; everything in between just pushes/pops an id.
 *
 * Each `Modal` instance calls `pushModal`/`popModal` with its own portal node
 * (the element it appended to `document.body`) so that node itself — and
 * anything already open above it — is excluded from the `inert` sweep.
 */

let stack: symbol[] = [];
let inertedElements: HTMLElement[] = [];

export function pushModal(id: symbol, portalNode: HTMLElement): void {
	if (stack.length === 0) {
		document.body.classList.add('modal-scroll-lock');
		inertedElements = Array.from(document.body.children).filter(
			(el): el is HTMLElement => el instanceof HTMLElement && el !== portalNode
		);
		for (const el of inertedElements) el.inert = true;
	}
	stack.push(id);
}

export function popModal(id: symbol): void {
	stack = stack.filter((entry) => entry !== id);
	if (stack.length === 0) {
		for (const el of inertedElements) el.inert = false;
		inertedElements = [];
		document.body.classList.remove('modal-scroll-lock');
	}
}

/** True when `id` is the top-most (most recently opened) modal — the only one
 * that should react to Escape or a scrim activation. */
export function isTopModal(id: symbol): boolean {
	return stack.length > 0 && stack[stack.length - 1] === id;
}
