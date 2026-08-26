# Memory

## Bun's own `.env` loader corrupts any value containing `$name` (the argon2id hash)
- Project: worklog
- Problem: `bun run dev` and `bun run build` (plain `vite dev`/`vite build` in
  package.json, relying on Bun's automatic `.env` loading) both crashed with
  `WORKLOG_PASSPHRASE_HASH must be present and a parseable argon2id hash` — or, with
  every field missing, depending on exactly how Bun was invoked — even though `.env`
  held a real, correctly-formatted hash. Root cause, isolated to a two-line repro:
  Bun's own `.env` parser performs shell-style `$name` variable expansion on every
  value it reads, unconditionally, whether the value is unquoted, single-quoted or
  double-quoted (confirmed on Bun 1.4.0 — this is not the documented dotenv
  convention, where single quotes suppress expansion). An argon2id hash
  (`$argon2id$v=19$m=65536,...$<salt>$<hash>`) is mostly `$something` sequences with
  no matching environment variable, so every one silently resolves to empty and the
  value comes out mangled. Separately, `bun run <script>` does not reliably propagate
  its own `.env`-loaded vars into a spawned subprocess like `vite` at all (sometimes
  every var is simply missing) — the same PATH-shim class of issue already on record
  below for Vitest, just manifesting as vars-not-loaded instead of a transpiler bug.
  A value already sitting in `process.env` before Bun starts (real shell `export`, a
  Docker `ENV` instruction, or anything not parsed from a `.env` file by Bun itself)
  is never touched — only Bun's own file-parsing corrupts it.
- Solution: never let Bun parse the `.env` file for a value that contains `$`.
  `scripts/run-vite.sh` loads `.env` the same way `migrate.sh`/`backup.sh` already
  do — plain `read` line by line, `export`ed directly, never `source`d and never
  handed to Bun's `--env-file` — then `exec bun vite "$@"`, so Bun only ever sees an
  already-populated real environment. `package.json`'s `dev`/`build`/`preview`
  scripts call this wrapper instead of `vite` directly. The Docker build is
  unaffected (its builder stage sets the placeholder config via a plain `ENV`
  instruction, never `.env`), but `scripts/` still had to be added to the builder
  stage's `COPY` list since `bun run build` now execs into it.
- Source: build, 2026-08-24T02:58Z

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

## `with { type: 'json' }` fixes Node but breaks Bun's named JSON exports
- Project: worklog
- Problem: `config.ts`'s `import { version as packageVersion } from
  '../../../../package.json'` (a bare JSON import, no attribute) built and ran fine
  under Bun/Vite (`bun run dev`/`build`/`preview`), but Playwright's own test-file
  loading executes this file's import chain under plain Node.js, which throws
  `TypeError: ... needs an import attribute of "type: json"` for a bare JSON import
  without `with { type: 'json' }`. Adding the attribute fixed Node — but then broke
  Bun: with the attribute present, Bun switches to strict (spec-conformant)
  JSON-module semantics, where a JSON module only ever has a `default` export, never
  a named export synthesized per top-level property — the exact same `import {
  version } from ...` (now with the attribute) throws `does not provide an export
  named 'version'` under Bun.
- Solution: `import packageJson from '...package.json' with { type: 'json' };
  const packageVersion = packageJson.version;` — import the default and read the
  property off it. Satisfies both runtimes' strict semantics at once.
- Source: build, 2026-08-24T16:15Z

## Playwright's worker-scoped `auto` fixture re-runs per TEST FILE, not once per run
- Project: worklog
- Problem: `tests/e2e/fixtures.ts` reset the E2E database via a `scope: 'worker',
  auto: true` fixture, on the documented assumption that `workers: 1` in
  `playwright.config.ts` means one worker for the WHOLE run, so the reset (and the
  `auth_sessions` truncation it does) would happen exactly once. In practice,
  confirmed live via `console.error` tracing an actual run, Playwright starts a
  fresh worker per TEST FILE even at `workers: 1` — the fixture re-ran at the start
  of every file, silently invalidating every login session a previous file's tests
  had established. Combined with this suite's one-`login()`-call-per-test style,
  that forced at least one real `/login` form submission per file regardless of any
  client-side session cache, and with ten spec files that alone exceeds
  `LOGIN_ATTEMPT_LIMIT` (5 per 15 minutes) well before a full run finishes — the
  "~24 logins vs ~5-6 threshold" rate-limit trip this project's own docs already
  flagged as a known issue.
- Solution: move the reset to Playwright's `globalSetup` (`tests/e2e/global-setup.ts`,
  wired via `playwright.config.ts`'s `globalSetup` option) — a hook that genuinely
  runs once, in its own short-lived process, before any worker starts. Paired with a
  file-based session cache in `fixtures.ts`'s `login()` (cookies written to
  `os.tmpdir()`, keyed by theme/locale, replayed via `context.addCookies()` and
  re-validated by navigating and checking for a redirect back to `/login`), this
  cut a full-suite run's real login count from ~24 down to ~6-7. A caveat this
  surfaced: with the database no longer reset between files, any spec that seeds
  fixture data with a hardcoded date and assumes a fresh table (e.g. calling the
  same seed helper from two different tests in one file) can now collide with
  itself — `tests/e2e/a11y.spec.ts`'s `seedADay()` needed a real "does this already
  exist" check (`GET /api/days/{date}`) rather than an in-memory guard, since even
  an in-memory boolean turned out not to reliably survive between that file's own
  separate `test.describe` blocks in practice.
- Source: build, 2026-08-24T17:00Z

## eslint.config.js never actually parsed .svelte or TypeScript files
- Project: worklog
- Problem: `bun run lint` reported 0 errors from the moment this project was
  scaffolded, but that was because `eslint.config.js` never wired in a TypeScript
  parser at all — plain `espree` (ESLint's default JS parser) was parsing every
  `.svelte`/`.ts` file, and silently choked on the first TypeScript-only syntax it
  hit (`<script lang="ts">`, a type annotation, a rune macro in a `.svelte.ts`
  file), throwing a parse error for that file that `eslint-plugin-svelte`'s config
  swallowed rather than surfaced as a lint error. The scaffold never included
  `@typescript-eslint/parser` or `svelte-eslint-parser`'s TS wiring at all — this
  had been broken since the project's very first commit (`git log --oneline --
  eslint.config.js` shows exactly one, the scaffold commit).
- Solution: add `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`
  as devDependencies, and give `eslint.config.js` two new `files` blocks —
  `**/*.{js,ts}` and `**/*.svelte` — each setting `languageOptions.parser`
  (`tsParser` directly for `.ts`, `svelteParser` with `parserOptions.parser:
  tsParser` for `.svelte`) and `@typescript-eslint/no-unused-vars` with
  `varsIgnorePattern: '^_'` to match this codebase's existing underscore
  convention for intentionally-unused parameters. Once parsing actually worked,
  it surfaced ~37 real, previously-invisible lint errors across the codebase
  (unused imports, `svelte/no-navigation-without-resolve` needing `resolve()`
  from `$app/paths`, a Svelte-5-runes anti-pattern `$state`+`$effect` mirror that
  should be a writable `$derived`, and more) — all fixed the same phase.
- Source: build, 2026-08-24T15:30Z

## `scripts/migrate.sh` needs `psql` on PATH, which this sandbox host does not have
- Project: worklog
- Problem: `./scripts/migrate.sh` fails immediately with `migrate.sh: psql is
  required but not found on PATH` — this sandbox's shell (unlike the long-running
  `worklog-pg` Postgres container it talks to) has no `postgresql-client` installed,
  and there is no `sudo`/root to add one.
- Solution: this doesn't block verifying migration state. The `worklog-pg` container
  itself bundles `psql`, and `DATABASE_URL`'s hostname (`worklog-pg`) already resolves
  from this sandbox shell over the shared `trayline-net` Docker network (see the
  `sandbox-docker-net` skill) — so both applying and checking migrations can go
  through `docker exec worklog-pg psql -U worklog -d <db> -c '...'` instead of the
  script. Concretely: `docker exec worklog-pg psql -U worklog -d worklog -tAc
  "select filename from schema_migrations order by filename;"` lists what's applied
  to the app database (and swap in `worklog_test` for the test one). If a real new
  migration ever needs applying and both are already at head, running the same SQL
  `psql` runs against the `migrations/*.sql` file via `docker exec` achieves the same
  effect as the script, just without its already-applied bookkeeping/locking — only
  needed if a fresh migration is genuinely pending.
- Source: build, 2026-08-26T10:20Z

## `worklog_test` on `worklog-pg` is the standing test database, not a throwaway
- Project: worklog
- Problem: this run's `verify` phase teardown dropped a database it called
  `worklog_test` believing it to be scratch ("`worklog_test` and
  `worklog_test_legacy` (both scratch databases...) were dropped"), but
  `worklog_test` is exactly the database `.env`'s own `TEST_DATABASE_URL` names —
  the persistent test database `bun run test` (and every earlier phase, per
  `build`'s own report) actually relies on. This phase's `bun run test` failed
  immediately with `PostgresError: database "worklog_test" does not exist`.
- Solution: recreated it and re-applied both migrations by hand (`docker exec
  worklog-pg psql -U worklog -d postgres -c 'CREATE DATABASE worklog_test'`, then
  a `schema_migrations` table and each `migrations/*.sql` file piped through
  `docker exec -i worklog-pg psql -U worklog -d worklog_test` inside a
  `BEGIN`/`INSERT INTO schema_migrations`/`COMMIT` block, mirroring
  `scripts/migrate.sh`'s own logic since no `psql` exists on this sandbox's own
  PATH — see the entry above). `bun run test` then passed clean (54 files / 618
  tests). Any phase that drops a database on `worklog-pg` to clean up its own
  scratch state must first confirm the name isn't the one `.env`'s
  `TEST_DATABASE_URL`/`DATABASE_URL` actually name — `worklog_test` looks
  disposable but is not.
- Source: docs, 2026-08-26T13:00Z
