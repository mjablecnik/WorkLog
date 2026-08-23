# Memory

## Bun's `bun run` PATH shim breaks zod + postgres.js together under Vitest
- Project: worklog
- Problem: Any Vitest test file that (directly or via a setup file) imports both
  `zod` and `postgres` (the `postgres.js` driver) fails with
  `TypeError: undefined is not an object (evaluating 'z.object')` — `import { z }
  from 'zod'` silently resolves to `undefined` partway through the suite. Reproduced
  down to a two-line repro (`import { z } from 'zod'; await import('postgres');`)
  with zero application code involved. This affects every "server"-project test file
  once `tests/setup/db.ts` (which needs `postgres` to reset the test database) runs
  as a `setupFiles` entry, since nearly every route/schema module also pulls in `zod`.
- Solution: it is **not** a Vite/Vitest/zod/postgres bug at all — it is Bun's `bun
  run <script>` execution model. This project's `bunfig.toml` sets `[run] bun = true`
  (required elsewhere for `Bun.password.hash` and automatic `.env` loading), which
  makes Bun put a shim directory at the **front of `PATH`** whose `node` is actually
  Bun itself (`which node` inside a `bun run` script resolves to
  `/tmp/bun-node-*/node`, not the real interpreter) — so *every* subprocess spawned
  during a `bun run` session, however deeply nested (even an explicit `node ...` call
  inside a plain shell script), still executes under Bun's own transpiler, which has
  the zod+postgres interaction bug. Plain `node`, and `bunx vitest` run directly from
  an interactive shell (never through `bun run`), are both unaffected — confirming
  it's specific to Bun's own JS engine, not the dependency combination itself.
  Fix: `scripts/run-vitest.sh` resolves the real, non-shimmed `node` explicitly via
  `type -ap node | grep -v '/bun-node-' | head -1` and `exec`s vitest through it
  (`node --env-file-if-exists=.env node_modules/vitest/vitest.mjs "$@"`), and
  `package.json`'s `test`/`test:watch`/`test:coverage` scripts call that shell script
  instead of `vitest` directly. A `.sh` file has no Node shebang for Bun to intercept,
  but the PATH shim still needed to be worked around explicitly inside it.
- Source: impl, 2026-08-23T23:03Z

## Tests now run under real Node — every Bun-only global needs a fallback
- Project: worklog
- Problem: The fix above means `bun run test` executes Vitest under real Node, not
  Bun. Any production code calling a Bun-only global (`Bun.randomUUIDv7()`,
  `Bun.password.hash`/`verify`) throws `ReferenceError: Bun is not defined` the
  moment a test exercises that code path — even though the same code runs fine in
  the actual deployed app (Docker image, `bun run build/index.js`), which always
  runs under real Bun.
- Solution: give every Bun-only primitive a thin cross-runtime wrapper in
  `src/lib/server/core/`: prefer the native Bun API when `typeof Bun !== 'undefined'`,
  fall back to a Node-compatible implementation otherwise. Done for UUID v7
  generation (`core/uuid.ts`'s `randomUuidV7()` — RFC 9562 fallback over
  `crypto.getRandomValues`). Not yet needed for password hashing (task 7.1,
  `core/auth.ts`) — when that lands, `Bun.password.hash`/`verify` (argon2id) will
  need the same treatment: real argon2id via Bun in production, a clearly-marked
  fallback format (never claiming to be `$argon2id$`) for the Node test runtime only,
  dispatched by the hash's own prefix in `verify`.
- Source: impl, 2026-08-23T23:07Z
