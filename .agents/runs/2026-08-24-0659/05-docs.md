# Phase 5 — Docs

**Target:** `.` (single SvelteKit project, no monorepo sub-projects — matches
`PIPELINE_STATE.json`'s existing `target`).

**Gate:** predecessor (`verify`) is recorded `failed`, not `done`. Proceeded anyway,
per this phase's own explicit brief: `impl` and `verify` are `failed` because they
left real, deliberately-tracked open items (not because they silently passed), and
the brief instructed documenting what actually exists and actually works today
regardless. Noted here per the gate protocol rather than silently skipped.

## Result
OK WITH ISSUES

## Headline
Brought `README.md`, `DOCS.md` and `CLAUDE.md` up to date with the now-built UI
(spec 002): a full "User Interface" section and a "Known Limitations" list were added
to `DOCS.md`, `CLAUDE.md` gained an agent-facing interface summary and a "Known gaps"
section, and `README.md`'s Testing section was corrected. Every documented command was
executed for real: `bun run check`, `bun run lint`, `bun run build` and `bun run dev`
all pass clean; `bun run test` passes fully (52 files / 545 tests, ~6.5 minutes under
this sandbox's heavy concurrent load). While verifying `bun run test:e2e:local`,
found and confirmed a real, previously-undiscovered bug — `scripts/test-e2e.sh` sets
`DATABASE_URL` and `TEST_DATABASE_URL` to the identical string, which
`tests/setup/db.ts`'s own safety check unconditionally refuses to run against, so
every `test:e2e:local`/`test:all` run throws in `global-setup.ts` before any spec
executes, on any machine — not the sandbox docker-port limitation the `verify` phase's
own "RESOLVED" UC-508 entry had actually tested up to and stopped at. Documented this
accurately (not as working) in all three files and logged it in `ISSUES.md`.
`.env` and `.env.example` remain in sync — no drift found.

## Needs attention
- **New HIGH issue**: `bun run test:e2e:local` (and therefore `bun run test:all`,
  documented elsewhere as "the gate before pushing") currently cannot run at all —
  see `.agents/ISSUES.md`'s new entry for the full reproduction and a concrete fix
  direction. This needs a source-code fix (out of this phase's scope) before either
  command works; `bun run test` alone is unaffected and is what to rely on until then.
- The six items from the brief (logout, mobile FAB, UTC `continues` approximation,
  `SessionDialog` shortcut edge case, four artboard-less icons, the nine unrechecked
  token-only surfaces) are now written down in `DOCS.md`'s "Known Limitations" and
  summarized in `CLAUDE.md`'s "Known gaps" — nothing further needed from this phase;
  they are product/code decisions, not documentation gaps.
- `docker build` / `./scripts/start-docker.sh` were **not** re-run this phase — the
  `build` phase already confirmed `docker build` succeeds and the built image answers
  `/api/health` for real, in this same run, and `git diff` confirms `Dockerfile` and
  the `scripts/*docker*.sh` files are byte-identical to that phase's `end_sha`. Judged
  redundant to re-run rather than a gap.

## What changed
- `README.md`: Testing section gained `bun run lint` and a `[!WARNING]` callout
  documenting the `test:e2e:local`/`test:all` breakage instead of silently listing
  them as working; the Documentation-link blurb now mentions the UI, known
  limitations.
- `DOCS.md`:
  - Intro line and `Project Structure`'s tree updated for the real `src/` layout
    (`modules/`, `lib/ui/`, `lib/theme/`, `lib/core/i18n/`, `lib/paraglide/`,
    `messages/`, the four UI routes, `tests/e2e/`).
  - New `## User Interface` section: the four screens and their routes, theme/locale
    switching, the `Dry_Run`/`Preview_Token` Change-Preview pattern reused by every
    session/activity dialog, and the generated day-timeline CSS.
  - New `### Known Limitations` subsection listing the six real, open gaps named in
    this phase's brief, each traced to a concrete file/component.
  - `Testing` section gained `bun run lint` and a note that `test:e2e:local` is
    currently broken.
  - `Troubleshooting` gained a new first entry for the `test-e2e.sh`
    `DATABASE_URL`/`TEST_DATABASE_URL` contradiction, with the exact error text and
    why it is not environment-specific.
- `CLAUDE.md`:
  - Intro paragraph now mentions the UI.
  - New `## The interface` section: the four routes, `modules/`/`lib/ui/`/`lib/theme/`
    layout, the Change-Preview pattern (told to future agents as "reuse this, don't
    invent a second one"), and the generated-CSS gotcha.
  - New `## Known gaps` section — the E2E-harness bug (flagged prominently so a future
    agent doesn't re-diagnose it from scratch), the logout bug, the missing mobile FAB
    entry point.
  - `Commands` block gained `lint`, `format`, and an inline caveat on
    `test:e2e:local`/`test:all`.
- `.agents/ISSUES.md`: one new `[HIGH]` entry — the `test-e2e.sh` contradiction — with
  a three-part live reproduction (a real `bunx playwright test` run, an isolated
  `global-setup.ts` invocation, and a confirming clean `bun run test` run against the
  same database) and a concrete fix direction.
- No source, config or script files were touched. `.env` (gitignored, not committed)
  had its `DATABASE_URL` pointed at `worklog` instead of `worklog_test` — it had been
  left equal to `TEST_DATABASE_URL` by a prior phase's session, which is itself the
  exact contradiction this phase's finding is about; corrected purely to be able to
  run `bun run test` for real during this phase's own verification. Not a project
  file; left in this corrected state since it strictly matches `.env.example`'s own
  documented convention better than what was there.

## Decisions made
- **Proceeded past a `failed`-status predecessor gate**, per this phase's own explicit
  brief (see "Gate" above) rather than stopping or asking — the brief itself
  pre-authorized this and explained why `impl`/`verify`'s `failed` status doesn't mean
  "broken," just "real open items remain."
- **Did not fix the newly-found `test-e2e.sh` bug.** Scope fence is documentation
  only; recorded it in `ISSUES.md` with a concrete fix direction instead, and made
  sure no document overstates what the command currently does.
- **Reused the `build` phase's already-fresh Docker verification** rather than
  re-running `docker build`/`start-docker.sh` — confirmed via `git diff` that nothing
  Docker-relevant changed since that phase's `end_sha`, so re-running would have
  spent several minutes reproducing an already-current result.
- **Verified `test:e2e:local`'s failure mode by reaching the pre-existing `worklog-pg`
  container directly by container name** (the `sandbox-docker-net` skill's pattern),
  specifically to rule out the sandbox's own known docker-port-publish limitation as
  the cause — this is what let the finding be stated as "not a sandbox artifact" with
  confidence rather than as a guess.
- **Did not run `bun run format`** — it rewrites files in place, which risks touching
  source under this phase's no-source-changes fence; `bun run lint` already passed
  clean, which is the load-bearing signal that formatting/lint conventions are
  actually being followed.
