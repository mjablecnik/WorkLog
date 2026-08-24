# Phase 2 — Build

**Target:** `.` (repository root) — the whole project is a single SvelteKit
application over `bun`; carried forward from `PIPELINE_STATE.json`'s `target`, set by
the `impl` phase.

## Result
OK

## Headline
Install, type-check, lint, the full test suite (327 tests, 33 files), a real dev-server
request, a real production build + start, and a real `docker build` + container run
against the live `worklog-pg` database are all green. One real bug was found and fixed
along the way: `bun run dev`/`bun run build` could not start at all against a real
`.env`, because Bun's own `.env` loader corrupts any value containing `$name`
sequences — exactly what an argon2id hash is made of.

## Needs attention
Nothing new. The three issues already open in `ISSUES.md` from the `impl` phase
(`bun audit` transitive vulnerabilities, task 10.5's skipped property tests, and
`aggregates.ts` computing day summaries in TypeScript rather than SQL) are unchanged
and untouched by this phase — they are pre-existing, non-blocking, and out of this
phase's remit to resolve.

## What changed
- **`scripts/run-vite.sh`** (new) — loads `.env` line by line with plain `read`
  (never `source`d, never handed to Bun's own `.env` parser) and `export`s each
  variable into a real environment before `exec`ing `bun vite "$@"`. Mirrors the
  pattern `scripts/migrate.sh`/`scripts/backup.sh` already used for the same class of
  problem.
- **`package.json`** — `dev`, `build` and `preview` now call `./scripts/run-vite.sh
  <mode>` instead of invoking `vite` directly, so none of the three ever let Bun
  parse `.env` itself.
- **`Dockerfile`** — added `COPY scripts ./scripts` to the **builder** stage (it was
  previously only copied into the runtime stage). `bun run build` now execs into
  `scripts/run-vite.sh`, so the builder stage needs the script present even though it
  never actually reads `.env` there (the builder's placeholder config comes from a
  plain Docker `ENV` instruction, which Bun never re-parses, so no corruption risk in
  the image itself).
- **`.agents/MEMORY.md`** — recorded the root cause and fix (see below).
- Local **`.env`** (gitignored, not committed) was left with its original, unescaped
  `WORKLOG_PASSPHRASE_HASH` value — the correct form for every consumer in this
  project (Bun via the new wrapper, Node's `--env-file-if-exists` in
  `run-vitest.sh`, and the `read`-loop in `migrate.sh`/`backup.sh`). It was briefly
  edited mid-phase to a backslash-escaped form while diagnosing the bug and then
  reverted once the real fix (routing around Bun's parser entirely) was found —
  mentioned here only so a reader of the history doesn't wonder about the detour.

## Decisions made
- **Root-caused rather than worked around.** The first fix attempt (escaping every
  `$` in `.env` for Bun's benefit) made `bun run build` pass but broke `bun run test`
  and the shell scripts, which read the same file literally with no expansion at all
  — there is no single escaping convention that satisfies Bun's parser, Node's
  `--env-file`, and bash's `read` simultaneously. The real fix is structural: never
  let Bun's own loader see the file for a value that contains `$`. This matches the
  precedent already set in this project for `migrate.sh`/`backup.sh` in the `impl`
  phase, extended to the `vite` entry points that hadn't been exercised against a real
  `.env` yet.
- **Did not touch `run-vitest.sh`.** It already loads `.env` through Node's
  `--env-file-if-exists`, which — unlike Bun's loader — does not perform `$`
  expansion at all, so it was never actually broken; the 100 test failures earlier in
  this phase were caused by my own interim escaping fix, not by anything in the
  repository as `impl` left it.
- **Verified the Docker artifact end to end**, not just `docker build`: ran the built
  image with `docker run --network trayline-net --env-file .env` (this sandbox's
  Docker daemon cannot reach host-published ports directly, per the
  `sandbox-docker-net` skill) against the same `worklog-pg` container `impl` used, and
  called `/api/health` from inside the container via `docker exec ... bun -e
  "fetch(...)"` — got the same `{"status":"ok",...}` response as the local dev and
  production-build checks.
