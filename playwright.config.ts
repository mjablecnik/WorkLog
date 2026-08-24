import { defineConfig } from '@playwright/test';

// The database the whole E2E run operates against — resolved once so the running
// app (webServer, below) and the test process's own `resetDb()` (tests/e2e/fixtures.ts
// -> tests/setup/db.ts) always agree on which database is truncated and which one
// the app actually reads and writes.
const testDatabaseUrl =
	process.env.TEST_DATABASE_URL ?? 'postgres://worklog:worklog@localhost:5432/worklog_test';

export default defineConfig({
	testDir: 'tests/e2e',
	// Runs `resetDb()` exactly once for the whole run — see that file's own doc
	// comment for why this replaced a worker-scoped fixture that turned out to
	// re-truncate the database (and every login session in it) on every test file.
	globalSetup: './tests/e2e/global-setup.ts',
	workers: 1,
	fullyParallel: false,
	retries: 0,
	use: {
		baseURL: 'http://localhost:4173'
	},
	webServer: {
		command: 'bun run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		env: {
			APP_ENV: 'test',
			TEST_DATABASE_URL: testDatabaseUrl,
			// The running app only ever reads `DATABASE_URL` (never `TEST_DATABASE_URL`
			// — see src/lib/server/core/config.ts), so this is what actually points the
			// webServer at the test database rather than a developer's real one. Without
			// it the app would fall back to whatever DATABASE_URL happens to be set in
			// the Playwright process's own environment — which tests/setup/db.ts's own
			// safety check requires to literally DIFFER from TEST_DATABASE_URL, making a
			// single shared value impossible; this override is what resolves that.
			DATABASE_URL: testDatabaseUrl
		}
	}
});
