/**
 * Vitest setup for the `components` project (jsdom environment). This specification
 * (001-worklog-domain-api) has no components of its own — the project is wired here
 * because `vitest.config.ts` is owned by this spec (task 1.9) and 002-worklog-ui's
 * component tests need somewhere to run. 002 fills this in as its component-testing
 * needs require (e.g. `@testing-library/jest-dom` matchers).
 */
export {};
