/**
 * Extends Playwright's `test` with a worker-scoped auto fixture that resets the
 * database before the first test in each worker runs — the same `resetDb()` the
 * integration suites use (`tests/setup/db.ts`), so an E2E run starts from an empty
 * database exactly as they do. `002-worklog-ui`'s specs import `test`/`expect` from
 * here rather than from `@playwright/test` directly.
 */
import { test as base, expect } from '@playwright/test';
import { resetDb } from '../setup/db';

export const test = base.extend<object, { resetOnce: void }>({
	resetOnce: [
		async ({}, use) => {
			await resetDb();
			await use();
		},
		{ scope: 'worker', auto: true }
	]
});

export { expect };
