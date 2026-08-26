# CLAUDE.md

Worklog reconciles two independent streams of data — a start/stop timer and
after-the-fact activity logging — against each other, so a day's history shows when
work actually happened rather than one unbroken block. A SvelteKit UI (timer, day
timeline, projects, statistics) sits on top of the REST API, in light/dark themes and
cs/en locales. See `README.md` for the pitch and `DOCS.md` for the reference
(environment variables, the full REST API, the UI's structure, known limitations,
testing, troubleshooting).

## Specs

- [`.kiro/specs/001-worklog-domain-api/`](.kiro/specs/001-worklog-domain-api/) — the
  domain model, the data layer and the REST API. Build this first; nothing else works
  without it.
- [`.kiro/specs/002-worklog-ui/`](.kiro/specs/002-worklog-ui/) — the timer, the day
  timeline, projects and statistics. Depends on `001`.
- [`.kiro/specs/003-worklog-time-categories/`](.kiro/specs/003-worklog-time-categories/)
  — `Project.billable` and the `Leisure_Entry` (an `Activity_Entry` with no `Project`),
  and the paid/unpaid/relax category they produce, surfaced across all four screens.
  Depends on `002`.

Each spec is three files: `requirements.md` (numbered acceptance criteria),
`design.md` (architecture, contracts, correctness properties) and `tasks.md` (an
ordered plan with a dependency graph). Every criterion is covered by a task and every
task cites its criteria — there is no part of the behaviour that nothing implements.
`.design/DESIGN.md` and `.design/artboards/` are the visual contract for `002` and
`003`; where a screen and a criterion disagree, that is a defect to raise, not a choice
to make while implementing. `003`'s own three artboards are drawn dark/desktop only —
see `DOCS.md`'s Known Limitations.

## The driver deviation

This project uses `drizzle-orm/postgres-js`, not `drizzle-orm/neon-http` — the default
elsewhere in this workspace's template stack. The template's Neon HTTP driver
documents that `db.transaction()` always throws, and Worklog's correctness model
needs real interactive transactions throughout: the advisory lock that serializes
every write (`src/lib/server/store/tx.ts`), the atomic entry-plus-segments insert, and
the deferred-constraint reshuffle re-clipping performs (delete every affected
segment, then re-insert — valid only mid-transaction, since
`activity_segments_no_overlap` is `DEFERRABLE INITIALLY DEFERRED`). Schema DSL and
query style are otherwise unchanged from the template; only the driver differs, and it
also removes the Neon proxy from local and CI runs — a plain `postgres:16` container is
enough.

## The reconciliation model

Two streams, reconciled at write time rather than at read time:

- **`Work_Session`** — a play/stop pair from the timer. The union of every session is
  `Tracked_Time`; a running session (`Open_Session`) counts as tracked from its start
  to now, capped at `MAX_OPEN_SESSION_HOURS` so an abandoned timer cannot inflate
  totals (the row itself is never closed automatically, and the _uncapped_ span is
  still checked for overlap — Requirement 1.15's reason the database's own `EXCLUDE`
  constraint cannot see an open row at all).
- **`Activity_Entry`** — what the user says they worked on, as an exact interval, a
  bare duration, or nothing but a project (`Explicit_Mode` / `Duration_Mode` /
  `Open_Mode`). Its `Project` is optional: an entry with none is a **`Leisure_Entry`**
  — time logged with no project, reconciled against the `Unrestricted_Window` (the
  day itself, minus what other entries already claim) instead of `Tracked_Time`, so it
  can be logged whether or not the timer ever ran that day. Every `Project` also
  carries a `billable` flag, so every entry resolves to a `category` of `paid`,
  `unpaid` or (for a `Leisure_Entry`) `relax`; changing an entry's category — moving it
  onto or off a project, or between two projects with different `billable` values — is
  the one path that re-clips the entry against a different regime rather than just
  patching its fields. Never stored as requested: **`Clipping`**
  (`src/lib/server/domain/clipping.ts`) reduces it to the `Activity_Segment` rows that
  actually overlap `Tracked_Time` (or, for a `Leisure_Entry`, the `Unrestricted_Window`),
  producing one segment per `Work_Session` a request spans — a break inside a logged
  interval stays visible rather than being smoothed over. The entry keeps its
  original requested interval (`requestedStartedAt`/`requestedEndedAt`) unchanged, for
  auditing and so a later change can re-place it.
- **`reclipAffected`** (`src/lib/server/domain/reclip.ts`) re-runs `Clipping` for
  every entry a `Work_Session` change might affect. An entry reconciliation empties
  entirely becomes an `Orphaned_Entry` — no segments, but still selectable by its
  requested interval, and recoverable by a `PATCH` that supplies a new interval.
- **`Dry_Run`** (Requirement 14) evaluates any write in full, including every
  rejection, without saving anything — the same code path as the real write, rolled
  back inside the same transaction (`withTx({ dryRun: true })`), so a preview and the
  write it previews can never drift apart. Its `Preview_Token` fingerprints the stored
  rows the outcome was computed against, never any elapsed or current time, so a
  running timer does not invalidate a preview every second it stays open.

This is exactly the property `tests/lib/server/store/overlap.property.test.ts`'s
Property 22 checks after a random sequence of operations: every stored `Work_Entry`
segment, no matter what got created, patched or deleted along the way, lies entirely
within `Tracked_Time` as the database then holds it. `003-worklog-time-categories`
amended this property to a `Work_Entry`'s own segments only — a `Leisure_Entry`'s
segments are reconciled against the `Unrestricted_Window` instead, by design, so they
are not expected to lie inside `Tracked_Time` at all.

## The interface

Four screens (`/` timer, `/day/[date]` day timeline, `/projects`, `/stats`) inside a
shared `Shell`/`Topbar`/`BottomNav`, plus `/login`, `/logout` and `/offline`.
`modules/<feature>/` holds feature-specific logic and components; `lib/ui/` holds
generic building blocks (`Modal`, `Fab`, `SettingsMenu`, form elements); `lib/theme/`
and `lib/core/i18n/` hold the theme (light/dark) and locale (cs/en) state.

Every dialog that can discard tracked time or extend a session — session and activity
create/edit alike — goes through the same `Dry_Run`/`Preview_Token` mechanism the API
exposes directly: preview the write via `ChangePreview`, then confirm explicitly.
Reuse that pattern for any new write with a visible consequence rather than inventing
a second one.

`src/lib/theme/palette.css` and `src/lib/theme/timeline-heights.css` are **generated**
(`bun run generate:css`, called by `bun run check`) from tokens elsewhere — never hand-edit
either file; `check` fails the build if a fresh generation would differ from what is
committed.

See `DOCS.md`'s Known Limitations for the current list of open gaps.

## Commands

```bash
bun install                # install dependencies
cp .env.example .env       # then fill it in
./scripts/migrate.sh       # apply the schema — the only supported way to do it

bun run dev                 # development server
bun run check                # type and Svelte checks
bun run lint                  # eslint
bun run format                 # prettier --write
bun run test                    # unit, property and integration tests (needs PostgreSQL)
bun run test:e2e:local           # Playwright, via scripts/test-e2e.sh
bun run test:all                  # check + test + test:e2e:local — intended gate before pushing
bun run build                      # production build

./scripts/start-docker.sh   # build and run the production image locally
./scripts/stop-docker.sh
./scripts/deploy.sh prod    # or: dploy release prod
./scripts/backup.sh prod    # pg_dump into backups/
./scripts/hash-passphrase.sh # produces WORKLOG_PASSPHRASE_HASH
```

`bun run test` (and everything it wraps) always runs through
`scripts/run-vitest.sh`, never `vitest`/`bunx vitest` directly — see the
`bunfig.toml`/PATH-shim entry in `DOCS.md`'s Troubleshooting section before touching
the test scripts.

Likewise, `dev`/`build`/`preview` always run through `scripts/run-vite.sh`, never
`vite`/`bunx vite` directly — Bun's own `.env` loader corrupts `WORKLOG_PASSPHRASE_HASH`
(a `$`-bearing argon2id hash) by expanding it as shell-style variable references; see
the same Troubleshooting section.
