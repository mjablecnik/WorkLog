/**
 * The toast store backing `ToastContainer`/`Toast`. Requirements 15.1, 15.2, 15.8;
 * design.md's Announcements table and "Surfaces the artboards do not draw" › Toast.
 *
 * Only two variants exist — `success` and `error` — because those are the only two
 * live regions the interface has (`role="status"`/polite vs `role="alert"`/assertive).
 * A success toast self-dismisses after about four seconds; a failure toast never
 * does, because a message the user did not see is the same as no message.
 */

export type ToastVariant = 'success' | 'error';

export interface ToastAction {
	label: string;
	onclick: () => void;
}

export interface ToastItem {
	id: number;
	message: string;
	variant: ToastVariant;
	/** An `error` toast may carry one accent text action (e.g. "open the entry" on
	 * an overlap conflict); a `success` toast never does. */
	action?: ToastAction;
}

/** Roughly four seconds, per design.md — not exact, just "about". */
export const SUCCESS_DISMISS_MS = 4000;

let toasts = $state<ToastItem[]>([]);
let nextId = 1;

export function getToasts(): ToastItem[] {
	return toasts;
}

export function addToast(message: string, variant: ToastVariant, action?: ToastAction): number {
	const id = nextId++;
	toasts.push({ id, message, variant, action });
	return id;
}

export function addSuccessToast(message: string): number {
	return addToast(message, 'success');
}

export function addErrorToast(message: string, action?: ToastAction): number {
	return addToast(message, 'error', action);
}

export function removeToast(id: number): void {
	toasts = toasts.filter((toast) => toast.id !== id);
}
