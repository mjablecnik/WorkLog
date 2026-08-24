/**
 * Vitest setup for the `components` project (jsdom environment). This specification
 * (001-worklog-domain-api) has no components of its own — the project is wired here
 * because `vitest.config.ts` is owned by this spec (task 1.9) and 002-worklog-ui's
 * component tests need somewhere to run. 002 fills this in as its component-testing
 * needs require (e.g. `@testing-library/jest-dom` matchers).
 *
 * `@testing-library/jest-dom/vitest` extends `expect` with the `toBeInTheDocument`,
 * `toHaveAttribute`, etc. matchers, and registers itself automatically — no further
 * setup call is needed.
 *
 * `@testing-library/svelte`'s own top-level import registers `beforeEach`/`afterEach`
 * hooks as a side effect ONLY when `beforeEach`/`afterEach` already exist as globals
 * (`typeof beforeEach === 'function'`) — see its `src/index.js`. This project does not
 * set `test.globals: true` (tests import `describe`/`it`/`expect` explicitly from
 * `vitest` instead), so that check fails silently and DOM from one component test is
 * never unmounted before the next — confirmed empirically: without this, three
 * `render()` calls across three different tests all show up in the same `document.body`
 * and `getByText` starts throwing "found multiple elements". Registering `cleanup()`
 * here, once, fixes it for every component test in the project.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
	cleanup();
});
