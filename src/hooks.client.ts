/**
 * The client-side counterpart to `src/hooks.server.ts`'s own error handling — task
 * 9.2 (design.md's Error Handling table, last row: "uncaught client error |
 * `hooks.client.ts` → `+error.svelte` | the same surface as a failed request, never
 * a blank page"; Requirement 15.11).
 *
 * SvelteKit calls `handleError` whenever an error reaches the client without
 * already being handled as a SvelteKit `error(...)`/`redirect(...)` — a thrown
 * exception inside a `load` function, or an unexpected one during the render that
 * follows. Left unimplemented, SvelteKit's own default still renders the nearest
 * `+error.svelte` (task 1.10, already built) rather than a blank page, but logs
 * nothing beyond the console and gives the user nothing to reference if they report
 * it. This hook adds both, without ever putting the raw error's message or stack on
 * the page itself — `+error.svelte` reads none of `page.error`'s fields (it renders
 * the fixed `error_page_title`/`error_page_body` catalogue strings unconditionally),
 * so nothing returned from here is ever shown; the security standard's "do not leak
 * internals to the page" is satisfied by that page, not by scrubbing this return
 * value, but this hook stays consistent with it anyway rather than relying on that
 * alone.
 *
 * `002` owns this file outright (design.md's "File Ownership" table) — `001` never
 * edits it.
 */
import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	// A random id purely for the user to quote if they report the failure — the
	// client has no log sink to correlate it against, unlike the server's own
	// `requestId` (`hooks.server.ts`/`request-id.ts`), but a random id beats "no way
	// to reference this occurrence at all".
	const errorId = crypto.randomUUID();

	// Never sent anywhere, never rendered — a `console.error` is the one surface
	// available client-side, and it carries the real detail so a developer looking at
	// devtools can still diagnose it, exactly as `errorResponse()`'s server-side
	// `logger.error` does for a request that fails on that side instead.
	console.error('uncaught client error', {
		errorId,
		status,
		route: event.route.id,
		url: event.url.href,
		error
	});

	// SvelteKit already computed a safe, generic `message` for this case (its own
	// default is "Internal Error" for anything that is not itself an `App.Error`) —
	// returned verbatim rather than replaced, since `App.Error` carries no field for
	// this hook to add `errorId` to without widening that shared type for a value
	// `+error.svelte` would not read anyway.
	return { message };
};
