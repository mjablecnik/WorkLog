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
