/**
 * Truncates the E2E database exactly once, before any worker/test file starts —
 * see `playwright.config.ts`'s `globalSetup`.
 *
 * `resetDb()` used to run from a `worker`-scoped `auto` fixture in `fixtures.ts`
 * instead ("resets the database before the first test in each worker runs"). That
 * assumed one worker instantiation for the whole run (`workers: 1`), but Playwright
 * evidently starts a fresh worker per TEST FILE even at `workers: 1` — confirmed
 * live: the fixture's own `resetDb()` call fired again at the start of every file,
 * truncating `auth_sessions` (among everything else) and silently invalidating
 * every still-valid login session a previous file's tests had established. That
 * forced at least one real `/login` form submission per file regardless of any
 * client-side session caching (`fixtures.ts`'s `login()` helper), and with ten spec
 * files that alone exceeds `LOGIN_ATTEMPT_LIMIT` (5) well before the run finishes.
 *
 * `globalSetup` runs exactly once for the entire `playwright test` invocation, in
 * its own short-lived process, before any worker starts — the actual "once per run"
 * this reset always needed.
 */
import { resetDb } from '../setup/db';

export default async function globalSetup(): Promise<void> {
	await resetDb();
}
