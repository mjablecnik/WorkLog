# Phase 5 — Docs

**Target:** `.` (repository root — this is a single-project repo; `README.md`, `DOCS.md`
and `CLAUDE.md` all live at the root alongside `.kiro/` and `.agents/`).

## Result
OK

## Headline
`README.md`, `DOCS.md` and `CLAUDE.md` already existed (written during `impl`) and were,
on inspection, thorough and accurate. Every documented command was executed for real —
`bun run check`, `bun run test` (327/327, clean single-process run), `bun run build`,
`docker build`, a `docker run` of the built image with live `curl`-equivalent calls
against `/api/health`, `/api/sessions/*`, `/api/projects`, `/api/activities` (including
the `dryRun` and "open mode — everything since the last entry ended" examples the
README shows verbatim), and `./scripts/migrate.sh` against the real `worklog-pg`
container — all passed and all matched what the docs claim. One real documentation gap
was found and fixed: `scripts/run-vite.sh`, which `dev`/`build`/`preview` now route
through, was completely undocumented even though its existence is exactly the kind of
footgun a Troubleshooting section exists for.

## Needs attention
Nothing requiring a decision. One thing worth knowing for the next phase:

- `bun run test:e2e:local` could not be executed in this sandbox — `scripts/test-e2e.sh`
  publishes PostgreSQL on a host port (`-p 55432:5432`) and this sandbox's own shell
  cannot reach host-published ports (confirmed directly: started a throwaway
  `-p 55432:5432` Postgres container and `/dev/tcp/localhost/55432` refused). This is
  the same known, pre-existing sandbox constraint the `build` phase already worked
  around for its own Docker checks (per `sandbox-docker-net`) — not a code or
  documentation defect, and not something this phase can fix without editing the
  script (out of scope: documentation only). The script is correctly written for a
  real developer machine or CI; nothing in the docs was changed to compensate.

## What changed
- **`DOCS.md`** — added a Troubleshooting entry (parallel to the existing
  `scripts/run-vitest.sh`/`bunfig.toml` one) explaining why `dev`/`build`/`preview`
  route through `scripts/run-vite.sh`: Bun's own `.env` loader (both the implicit
  loading under `bun run <script>` and explicit `--env-file=`) expands any `$name`
  sequence in a value unconditionally, and `WORKLOG_PASSPHRASE_HASH` is a real
  argon2id hash (`$argon2id$v=19$...`) — confirmed live with
  `bun --env-file=.env -e 'console.log(process.env.WORKLOG_PASSPHRASE_HASH)'`, which
  prints the hash with its `$...$` fragments stripped. The entry says plainly: never
  invoke `vite`/`bunx vite` directly.
- **`CLAUDE.md`** — added a short parallel note under Commands, consistent with the
  existing `run-vitest.sh` note already there, so an agent reading only `CLAUDE.md`
  (not `DOCS.md`) still learns not to bypass `run-vite.sh`.
- Everything else — the API surface, environment variable table and defaults,
  project structure, migrations description, deployment scripts, `.env.example`
  contents — was checked against the actual code (`config.ts`'s `parseIntEnv` calls,
  `src/routes/api/**/+server.ts`, `migrations/001_init.sql`, `Dockerfile`, `fly.toml`,
  every `scripts/*.sh`) and found already accurate; no further edits were needed.

## Decisions made
- **Did not touch the sandbox-only `test:e2e:local` limitation.** It is a constraint of
  this specific sandbox's networking, not of the documented command, the script, or a
  real deployment target — documenting a workaround for it would misrepresent the
  script's actual, correct behavior on a real machine. Flagging it here rather than in
  `ISSUES.md`, since it is not a defect to fix.
- **Left the un-checked optional task `10.5` in `tasks.md`** (`- [ ]* 10.5 Write
  property tests for the gauge window and the suggested window`) alone. Nothing in
  `README.md`/`DOCS.md`/`CLAUDE.md` claims complete property-test coverage — the
  "327-test suite" figure they cite is accurate as-is — so there is no documentation
  drift here, and completing a spec task is out of this phase's scope (documentation
  only).
- **Did not restructure README.md's section content** (e.g. add an explicit "Key
  Features" bullet list under Description, as `standards-readme` describes) beyond
  what phases 1-4 already changed. The existing README already satisfies the required
  section set and order; the prompt for this phase was to close the gap between docs
  and what phases 1-4 changed, not to re-litigate stylistic choices already made
  deliberately and accepted.
- **First test run showed 9 failures — determined to be self-inflicted, not real.**
  Running `bun run test` in the background and then, out of impatience, running it a
  second time in the foreground before the first had finished, produced 9 failures
  (foreign-key violations, assertion mismatches) from two processes truncating and
  writing to the same `TEST_DATABASE_URL` concurrently — exactly the failure mode
  `vitest.config.ts`'s own `fileParallelism: false` comment warns about, just across
  whole invocations rather than files within one. A single clean re-run confirmed
  327/327 passing, matching what `DOCS.md` already claims. No `ISSUES.md` entry was
  warranted; the code was never at fault.

## Commands executed and verified
```
bun run check                              # 0 errors, 0 warnings
./scripts/migrate.sh                       # idempotent, "up to date"
bun run test                               # 327/327 passed (clean single run)
bun run build                              # succeeded
docker build -t worklog:latest .           # succeeded
docker run --network trayline-net --env-file .env worklog:latest
  → GET  /api/health                       # 200, matches documented shape
  → POST /api/sessions/start, /stop        # 201/200, matches documented shape
  → POST /api/projects                     # 201, schema is strict({name}) — confirmed
  → POST /api/activities (open mode)       # 201, matches README's exact example
  → POST /api/activities (dryRun)          # 409 ACTIVITY_OVERLAP with conflict detail,
                                              matches documented dryRun envelope
bun --env-file=.env -e '...'               # confirmed the $-corruption bug is real
```
