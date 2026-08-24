/**
 * Requirement 1.14 / design.md's Error Handling table: "`SERVICE_UNAVAILABLE` | a page
 * `load` → `/offline?next=<path>`; a browser-issued request → toast with a retry
 * action | renders `errors_service_unavailable` with the `Retry-After` seconds...".
 * This module is the page-`load` half.
 *
 * `src/hooks.server.ts`'s own `handleReadiness` gate only catches a database that
 * never came up in the first place (an unmigrated schema, a disagreeing
 * `Day_Boundary_Config`) — cached, checked once per `CLEANUP_INTERVAL_MINUTES`, and
 * `002` never edits that file (design.md's "File Ownership" table). What it does NOT
 * catch is a database that WAS ready and then drops mid-request — a statement
 * timeout or a lost connection, which `src/lib/server/store/tx.ts`'s
 * `translateOrRethrow` turns into the very same `ApiError('SERVICE_UNAVAILABLE', ...)`
 * thrown straight out of `withReadTx`/`withTx`. A page's own `load` is exactly where
 * that second case surfaces, and nothing before task 9.2 caught it — it fell through
 * to SvelteKit's generic error boundary instead of `/offline`.
 *
 * Shared by every `002` page `load` that reads the store directly (`day/[date]`, the
 * timer page, `projects`, `stats`) — `+layout.server.ts` deliberately does NOT use
 * this (see its own doc comment: a transient hiccup there degrades to "no open
 * session known yet" instead of pre-empting every page with a redirect, since the
 * root layout runs ahead of every page's own load and must not fail the whole
 * request over what might just be that one query).
 */
import { redirect } from '@sveltejs/kit';
import { ApiError } from '$lib/server/core/errors';

/**
 * Redirects to `/offline?next=<url>` when `err` is a `SERVICE_UNAVAILABLE` `ApiError`;
 * rethrows `err` unchanged otherwise, so a load's own `catch` stays a one-liner:
 * `catch (err) { offlineRedirectOrRethrow(err, url); }`.
 */
export function offlineRedirectOrRethrow(err: unknown, url: URL): never {
	if (err instanceof ApiError && err.code === 'SERVICE_UNAVAILABLE') {
		const next = encodeURIComponent(`${url.pathname}${url.search}`);
		redirect(303, `/offline?next=${next}`);
	}
	throw err;
}
