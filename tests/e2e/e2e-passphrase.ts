/**
 * Single source of truth for the throwaway passphrase this E2E run logs in with.
 * `tests/e2e/fixtures.ts` re-exports it for every spec's browser-side login flow.
 * `scripts/test-e2e.sh` imports it too — via a plain `bun -e` that pulls in only
 * this file, never `@playwright/test` — to mint the matching
 * `WORKLOG_PASSPHRASE_HASH` before the app starts, so the plaintext used to log in
 * and the hash the server checks against can never drift apart. Kept in its own
 * file, separate from `fixtures.ts`, specifically so a plain `bun` process (no
 * Playwright runtime) can import it without side effects.
 */
export const E2E_PASSPHRASE = 'e2e-test-passphrase-9182';
