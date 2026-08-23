import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
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
			TEST_DATABASE_URL:
				process.env.TEST_DATABASE_URL ?? 'postgres://worklog:worklog@localhost:5432/worklog_test'
		}
	}
});
