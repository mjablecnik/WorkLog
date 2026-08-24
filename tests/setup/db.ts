/**
 * Vitest setup for the `server` project (every suite that touches a real database).
 * Exports `resetDb()`, which truncates every table in one statement, and registers it
 * as a `beforeEach` for every test in the file that imports this setup — which
 * `vitest.config.ts` wires in for the whole `server` project.
 *
 * `tests/e2e/fixtures.ts` (002-worklog-ui, task 11) also imports this file directly,
 * for `resetDb()` alone — Playwright has no vitest runner behind it. Registering
 * `beforeEach`/`afterAll` unconditionally therefore crashed the moment fixtures.ts
 * pulled this module in outside vitest ("Vitest failed to find the runner" —
 * `beforeEach`/`afterAll`, imported from the `vitest` package, need vitest's own
 * runner context to do anything). `process.env.VITEST` is vitest's own marker,
 * set for every process it runs, and absent from a Playwright run — the guard below
 * registers the hooks only when it's actually present, so vitest's own behaviour
 * (its `beforeEach`/`afterAll` wiring for the `server` project) is unchanged and
 * Playwright gets a plain `resetDb()` function with no side effects it can't use.
 *
 * Connects to `TEST_DATABASE_URL`, never `DATABASE_URL`, and refuses to run at all
 * unless three things hold, checked before the first statement: `TEST_DATABASE_URL`
 * is set; it differs from `DATABASE_URL`; and its database name ends in `_test`. The
 * alternative is a helper that can silently erase the operator's own working
 * history — this project's invoicing evidence — and no test failure would ever
 * reveal it.
 */
import postgres from 'postgres';
import { afterAll, beforeEach } from 'vitest';
import { closeDb, resetDbConnection } from '../../src/lib/server/store/tx';
import { resetConfigCache } from '../../src/lib/server/core/config';

const REFUSAL_MESSAGE =
	'TEST_DATABASE_URL must be set, must differ from DATABASE_URL and must name a database ending in _test — refusing to truncate';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;

function extractDatabaseName(url: string): string {
	const match = /\/([^/?]+)(\?.*)?$/.exec(url);
	return match?.[1] ?? '';
}

if (
	testDatabaseUrl === undefined ||
	testDatabaseUrl.length === 0 ||
	testDatabaseUrl === originalDatabaseUrl ||
	!extractDatabaseName(testDatabaseUrl).endsWith('_test')
) {
	throw new Error(REFUSAL_MESSAGE);
}

// Point the app's own DATABASE_URL at the test database too, so the store functions
// under test — which read Config.databaseUrl through core/config.ts — connect to the
// same database this file truncates. Done before anything else imports tx.ts's
// lazily-initialized client.
//
// VITEST-ONLY (see the module doc comment above): vitest runs the app code under
// test in the SAME process as this file, so mutating `process.env.DATABASE_URL`
// here is how that in-process code ends up pointed at the test database. A
// Playwright run has no such in-process app code — the app runs in a completely
// separate `webServer` child process, pointed at the test database through
// `playwright.config.ts`'s own `webServer.env` instead — and mutating
// `process.env.DATABASE_URL` here is actively harmful for it: Playwright first
// imports every spec file once, in its own collection/listing pass, to discover
// fixtures, and THEN forks a worker process per `fork(entryScript, { env:
// {...process.env, ...} })`, inheriting whatever this collection pass already
// mutated `process.env` to. Left unguarded, the mutation below — triggered merely
// by importing this file for `resetDb()`, during collection — silently replaces
// the forked worker's own `DATABASE_URL` with `TEST_DATABASE_URL`'s value before
// the worker ever runs a test, which then makes THIS FILE's own safety check
// below throw ("must differ from DATABASE_URL") the moment the worker imports it
// again for real. Confirmed live while wiring up 002-worklog-ui's E2E suite.
if (process.env.VITEST) {
	process.env.DATABASE_URL = testDatabaseUrl;
	resetConfigCache();
	resetDbConnection();
}

const client = postgres(testDatabaseUrl, { max: 5 });

const TABLES = [
	'projects',
	'work_sessions',
	'activity_entries',
	'activity_segments',
	'auth_sessions',
	'idempotency_keys',
	'day_boundary_config'
];

/** Truncates every table in one statement. `CASCADE` makes the FK order irrelevant. */
export async function resetDb(): Promise<void> {
	await client.unsafe(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
}

if (process.env.VITEST) {
	beforeEach(async () => {
		await resetDb();
	});

	afterAll(async () => {
		await client.end();
		await closeDb();
	});
}
