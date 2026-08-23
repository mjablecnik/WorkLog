/**
 * Vitest setup for the `server` project (every suite that touches a real database).
 * Exports `resetDb()`, which truncates every table in one statement, and registers it
 * as a `beforeEach` for every test in the file that imports this setup — which
 * `vitest.config.ts` wires in for the whole `server` project.
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
process.env.DATABASE_URL = testDatabaseUrl;
resetConfigCache();
resetDbConnection();

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

beforeEach(async () => {
	await resetDb();
});

afterAll(async () => {
	await client.end();
	await closeDb();
});
