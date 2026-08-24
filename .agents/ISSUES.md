# Issues

## [LOW] Four Icon.svelte glyphs have no artboard source
- Run: 2026-08-24-0659
- Phase: impl
- Status: OPEN
- What: `src/lib/ui/elements/Icon.svelte` was rewritten as an inline-SVG registry
  sourcing real path geometry from `.design/artboards/*.dc.html` per Requirement
  17.19/14.6 ("no icon set substitution"). Twelve icons were extracted verbatim. Four
  — `search`, `sun`, `moon`, `check`/circle-check — are not drawn in any artboard (no
  search affordance, no visible theme-switcher sun/moon, no success glyph), so the
  implementing agent drew sober fallback geometry in the same stroke convention
  (round caps, stroke-width 1.7–1.8) rather than inventing icons that look inconsistent.
- Impact: these four icons are not literally taken from the Design_Contract, which
  Requirement 17.19 requires. Cosmetic risk only — the fallback follows the same
  visual language — but it is a real, not hypothetical, disagreement between the spec
  and the artboards: `search` is needed by `SearchInput`/`ProjectPicker`, `sun`/`moon`
  by the `Theme_Switcher` (spec text implies these appear in `Settings`/`SettingsMobile`
  but the artboards use a "CS" text label there, not an icon), `check` by success toasts.
- Tried: grepped every artboard's `<svg` blocks; confirmed absence.
- Next: raise with whoever owns `.design/` — either the artboards are missing these
  icons and should be extended, or the requirement should note they're out of scope.

## [LOW] Two different mechanisms for hover/active surface-alpha derivation
- Run: 2026-08-24-0659
- Phase: impl
- Status: OPEN
- What: task 1.4 (`src/lib/theme/theme.css`) computed explicit hand-derived tokens
  (`--chip-hover`, `--panel-hover`, etc., alpha +0.03/+0.06 with the arithmetic shown
  in comments) for the "one interaction-state rule" design.md requires. Task 1.3's
  `elements/` port instead used CSS relative-color syntax (`rgb(from var(--field) r g
  b / calc(alpha + 0.03))`) inline in component `<style>` blocks, written before
  theme.css's tokens existed. Both implement the same +0.03/+0.06 rule but by two
  different mechanisms in different files.
- Impact: no functional bug (both compute the same visual result on modern browsers),
  but it's an inconsistency that makes the "one rule, not thirty drawings" design
  principle harder to audit — a future change to the hover rule has two places to
  edit instead of one.
- Tried: nothing yet; both pass `bun run check` and were accepted as-is to keep wave 1
  moving.
- Next: a later cleanup pass should pick one mechanism (the theme.css named-token
  approach is more consistent with how the rest of the app applies tokens, and avoids
  relying on CSS relative-color syntax browser support) and convert the other.

## [MEDIUM] timeline-geometry.ts's `continues` flag uses a UTC-midnight approximation
- Run: 2026-08-24-0659
- Phase: impl
- Status: OPEN
- What: `layOutDay` (`src/modules/day/components/timeline-geometry.ts`) receives no
  Logical_Day boundary (no `DAY_START_HOUR`, no time zone), so it cannot compute the
  real day boundary to decide whether an open session's block "continues" past the
  displayed day. It approximates with `session.startedAt`'s UTC calendar date versus
  `now`'s UTC calendar date, documented inline. It also adds an undocumented
  `fillsColumn: boolean` field to `LaidOutSegment` (design.md's literal type has no
  such field) for the one-segment-per-column `.tl-h-fill` case.
- Impact: the `continues` flag could be wrong near a Logical_Day boundary that isn't
  UTC midnight (Worklog's default `DAY_START_HOUR` is not midnight) — a session
  started just after the real day boundary but before UTC midnight, or vice versa,
  could be flagged incorrectly.
- Tried: nothing yet — flagged for the day-page load function (task 3.7) and
  `DayTimeline`/`WorkBlock` (tasks 3.4/3.5), which have the real day bounds and can
  either pass them into `layOutDay` (extending its signature) or override the flag
  after the fact.
- Next: when task 3.7 (day page) is implemented, check whether `layOutDay`'s
  signature needs an explicit day-bounds parameter instead of inferring `continues`
  internally, and reconcile `fillsColumn` with whatever `WorkBlock.svelte` (task 3.4)
  expects for the tl-h-fill class.

## [LOW] dry-run.ts drops colorIndex from SessionPreview.reclipped
- Run: 2026-08-24-0659
- Phase: impl
- Status: OPEN
- What: `src/modules/day/dry-run.ts` maps the server's `ReclipOutcome` (which carries
  `colorIndex`) into `SessionPreview.reclipped`, but design.md's literal type for that
  field omits `colorIndex`. The implementing agent followed the literal design.md
  shape rather than silently adding a field.
- Impact: `ChangePreview.svelte` (task 5.2) draws "a 3 × 18 slot-coloured tick" beside
  each affected entry per design.md's own prose in the "Edit session" dialog
  description — which needs a colour per reclipped entry. As written, the preview
  client doesn't carry one.
- Tried: nothing yet.
- Next: when building task 5.2, either restore `colorIndex` to `SessionPreview.reclipped`
  in `dry-run.ts` (one-line fix) or resolve the colour another way; the former is
  almost certainly correct and should just be done at that point.

## [LOW] Paraglide plural/select messages use the plugin's native array form, not literal ICU
- Run: 2026-08-24-0659
- Phase: impl
- Status: OPEN
- What: design.md's Message Catalogue writes plural/select messages in classic ICU
  MessageFormat syntax (`{count, plural, one {...} other {...}}`). The actually
  installed `@inlang/plugin-message-format` does not parse that syntax from a plain
  string — it requires a separate `[{ declarations, selectors, match }]` JSON array
  per message. The ten affected keys (`timer_gauge_label`, `timer_stale_body`,
  `day_segment_label`, `session_delete_body`, `preview_parts`, `preview_total`,
  `projects_meta`, `stats_observation_nights`, `stats_observation_idle`,
  `errors_project_in_use`) were converted to that native form, preserving every
  wording and plural category exactly. Boolean-style selectors (`running`, `part`)
  now compare against the literal string `"true"`, not a JS boolean.
- Impact: none on correctness (verified by inspecting the compiled output), but any
  future call site that passes `running: true` (a JS boolean) instead of `running:
  'true'` (the string) will silently fall through to the `other`/`false` branch.
- Tried: verified against compiled `src/lib/paraglide/messages/*.js`.
- Next: whoever wires up call sites for these ten keys (timer page, day timeline,
  session dialog, change preview, projects page, stats rhythm panel, projects-in-use
  error) must remember to pass the string `'true'`/`'false'` for these selectors, not
  a boolean. Worth a one-line comment at each call site.

> The eighteen entries below the next section were opened by the `cases` phase, which
> reads code and writes documents and executes nothing. Each was found by reading the
> implementation against `requirements.md`. The `verify` phase (run 2026-08-23-2200)
> confirmed every one of them against a real running server, fixed all but three
> (`/logout` exemption, the idempotency-replay status column, and the login passphrase
> non-record — each left `OPEN` with its own reasoning below), and found six further
> code defects plus three non-code findings that only running the API — not reading
> it — could surface. Those nine are listed first, newest first.

## [HIGH] tx.ts's error translation never matches a Drizzle-wrapped Postgres error
- Run: 2026-08-23-2200
- Phase: verify
- Status: RESOLVED (2026-08-23-2200)
- What: `translateConstraintError` and `translateOrRethrow` in
  `src/lib/server/store/tx.ts` read `err.code`/`err.constraint_name` directly. This
  project's `drizzle-orm` version wraps every driver failure in its own
  `DrizzleQueryError` before it reaches a caller — verified with a live repro (`SET
  statement_timeout`, then a blocking `pg_sleep`): the thrown object's own `.code` is
  `undefined`; the real `postgres.js` `PostgresError` (`.code`, `.constraint_name`)
  survives only as `.cause`. Every check in both functions therefore never matches.
- Impact: Requirement 13.6/13.14 ("a query exceeding `DB_QUERY_TIMEOUT_SECONDS` answers
  503 `SERVICE_UNAVAILABLE`") was completely unreachable — confirmed live: holding the
  advisory lock from a second `psql` session for longer than `DB_QUERY_TIMEOUT_SECONDS`
  produced a 500 `INTERNAL_ERROR`, not 503. The constraint-violation safety net
  (`SESSION_OVERLAP`/`ACTIVITY_OVERLAP`/`PROJECT_EXISTS`/`PROJECT_IN_USE` on a genuine
  race) was equally dead, though harder to observe directly since this single-instance,
  advisory-lock-serialized app's own proactive pre-checks catch the ordinary case first
  — exactly why eighteen rounds of reading and a full green test suite never caught it.
- Tried: Fixed by unwrapping one level (`err.code ?? err.cause?.code`, same for
  `constraint_name`) in a shared `unwrapPgError` helper both functions now call.
  Re-ran the live repro after rebuilding: the blocked query now answers 503 with
  `retryAfterSeconds`, as specified.
- Next: None — watch for a future `drizzle-orm` upgrade changing the wrapping shape
  again; the helper's doc comment says explicitly what it depends on.

## [HIGH] A malformed {id} path parameter answers 500, not 400
- Run: 2026-08-23-2200
- Phase: verify
- Status: RESOLVED (2026-08-23-2200)
- What: `event.params.id` was passed straight into a Drizzle query on
  `/api/projects/{id}`, `/api/sessions/{id}` and `/api/activities/{id}` (PATCH, DELETE,
  and GET for activities) with no validation. A path segment that is not a UUID at all
  (`.../not-a-uuid`) reached Postgres as a bind parameter, which rejects it with
  "invalid input syntax for type uuid" — an error `errorResponse` does not recognise,
  so it became 500 `INTERNAL_ERROR` with the query and params logged.
- Impact: None of `.agents/USE_CASES.md`'s cases named this exact input (they use a
  syntactically-valid random UUID for "not found"), so `cases`-phase reading never hit
  it; VERIFY_TASKS step 13's PATCH testing surfaced it by accident when a prior request
  in the same batch failed and left a literal `null`/`not-a-uuid` id in a later call.
  Requirement 12.3 (no internals in an error body) and the general "validate at the
  boundary" principle both apply to path parameters, not only bodies and queries.
- Tried: Added `export const idParam = z.uuid()` to `schemas.ts` and
  `parseRequest(idParam, event.params.id)` at the top of every affected handler.
  Confirmed: the same malformed id now answers 400 `VALIDATION_ERROR` with
  `fields_invalid_id`, consistently across all three resources.
- Next: None.

## [HIGH] Closing a Stale_Session could crash instead of answering SESSION_OVERLAP
- Run: 2026-08-23-2200
- Phase: verify
- Status: RESOLVED (2026-08-23-2200)
- What: `stopSession` (`src/lib/server/services/sessions.ts`) closes the open session
  without first checking whether the now-bounded interval overlaps a *closed* session
  written while the timer was still running — every sibling write (`createSession`,
  `patchSession`) checks `sessionsConflictingWith` before writing; `stopSession` did
  not. Reproduced live: seed a session open 13h (a `Stale_Session`), write a closed
  session later that falls inside what closing the timer would span, then stop the
  timer — `work_sessions_no_overlap` fires as a raw constraint violation, which (see
  the `tx.ts` entry above) surfaced as 500 rather than the 409 the constraint exists to
  produce.
- Impact: A real, if narrow, gap in Requirement 1.15/1.16 — closing an old-enough
  running timer could 500 instead of cleanly reporting the conflicting session.
- Tried: Added the same `sessionsConflictingWith` pre-check `createSession`/
  `patchSession` already have, before `closeOpenSession`. Confirmed: the same
  reproduction now answers 409 `SESSION_OVERLAP` with the conflicting session named.
- Next: None.

## [HIGH] adapter-node's own body-size ceiling pre-empts this app's 413
- Run: 2026-08-23-2200
- Phase: verify
- Status: RESOLVED (2026-08-23-2200)
- What: Even after fixing the streaming-limit issue below, a body over 1 MiB with no
  `Content-Length` still answered 500. adapter-node enforces its own `BODY_SIZE_LIMIT`
  (default 512K, an env var distinct from this app's `MAX_BODY_BYTES`) inside its raw
  Node HTTP body reader, *before* the SvelteKit `handle` chain — and therefore this
  app's own check — ever sees a byte. It throws a `SvelteKitError(413, ...)`, which
  `errorResponse` did not recognise (no `ApiError`, no `PAYLOAD_TOO_LARGE` message),
  so it fell through to 500 `INTERNAL_ERROR`.
- Impact: Requirement 12.6/12.15's 1 MiB ceiling was shadowed by a smaller, undocumented
  512K one for any request without a `Content-Length` header, answering the wrong
  status for a legitimate over-size upload.
- Tried: Two fixes, both applied: (1) `Dockerfile` now sets `ENV BODY_SIZE_LIMIT=2097152`
  (2 MiB, comfortably above `MAX_BODY_BYTES`) so this app's own check is always the one
  that fires; (2) `errorResponse` defensively classifies any thrown error carrying
  `status: 413` (not just the `'PAYLOAD_TOO_LARGE'` sentinel) as `PAYLOAD_TOO_LARGE`,
  so an environment that forgets the env var still answers correctly rather than
  leaking a 500. Verified live with a >1 MiB chunked body: 413 with `maxBytes` in
  `details`.
- Next: None — `scripts/start-docker.sh`/`.env.example` do not need `BODY_SIZE_LIMIT`;
  it is an adapter-node runtime knob, not part of this app's own config surface, so the
  Dockerfile is the right and only place for it.

## [MEDIUM] Idempotency-Key format errors reported the wrong messageKey
- Run: 2026-08-23-2200
- Phase: verify
- Status: RESOLVED (2026-08-23-2200)
- What: `fieldMessageKeyFor` (`src/lib/server/core/errors.ts`) mapped every
  `invalid_format`/`regex` Zod issue to `fields_invalid_date`, written when the only
  regex-validated field was `dateString`. Adding a second regex-validated field this
  same phase (the `Idempotency-Key` shape, `idempotencyKeySchema`) exposed the
  collision: `Idempotency-Key: bad/key` answered `VALIDATION_ERROR` with
  `reason: "fields_invalid_date"` — a misleading key for a header that is not a date.
- Impact: `002` would render "invalid date" copy for a rejected idempotency key.
- Tried: Disambiguated by the regex's own source (`issue.pattern`, which Zod v4
  includes on the issue) rather than by field path — both `dateString` used standalone
  (`dayDateParam`) and `idempotencyKeySchema` validate a bare string with `path: []`, so
  path alone cannot tell them apart. Confirmed: the same request now answers
  `fields_invalid` (the generic fallback); `dateString` failures are unaffected.
- Next: None.

## [LOW] An empty meta-only PATCH on an activity answers 500
- Run: 2026-08-23-2200
- Phase: verify
- Status: RESOLVED (2026-08-23-2200)
- What: The same bug already catalogued for `PATCH /api/projects/{id}` (empty `{}`
  reaching `update(...).set({})`, which Drizzle rejects) also existed in
  `updateEntryMeta` (`src/lib/server/store/activities.ts`) — a meta-only
  `PATCH /api/activities/{id}` with neither `description` nor `projectId` supplied
  (e.g. `{}`, or only `{dryRun}`/`{previewToken}`) hit the identical crash.
- Impact: Same as the projects case — a request that passed validation must never
  answer 500.
- Tried: Applied the same fix: when neither field is present, reread and return the
  row unchanged instead of issuing an empty `SET`. Confirmed via a direct PATCH with
  `{}` against a real entry — 200, entry unchanged.
- Next: None.

## [LOW] scripts/migrate.sh ignores a DATABASE_URL already set in the environment
- Run: 2026-08-23-2200
- Phase: verify
- Status: OPEN
- What: The script's own header comment says it "reads `DATABASE_URL` directly from
  the environment or from `.env.<environment>`", but the code unconditionally
  `export`s every key from `.env`/`.env.<environment>` (to survive the `$`-bearing
  argon2id hash safely) *after* the caller's shell would have exported one — bash's
  `export` always overwrites, so `DATABASE_URL=postgres://...worklog_test2
  ./scripts/migrate.sh` silently migrates whatever `.env`'s own `DATABASE_URL` points
  at instead. Found live this phase while migrating a throwaway unmigrated database for
  VERIFY_TASKS step 43: the command reported "up to date" against the wrong database.
- Impact: An operator who deliberately overrides `DATABASE_URL` on the command line —
  exactly the pattern the header comment describes as supported — gets no error and no
  indication the override was ignored; they only discover it when the target database
  turns out not to have been migrated at all.
- Tried: Worked around it for this session by temporarily pointing `.env`'s own
  `DATABASE_URL` at the target, running the script, then reverting — not a code change.
- Next: Change the load loop to conditional-assign (`: "${KEY:=$VALUE}"` semantics, or
  check `[[ -z "${!KEY:-}" ]]` before exporting) so a value already in the environment
  wins, matching the documented behaviour; or fix the comment instead, if unconditional
  `.env` precedence is the intended contract.

## [LOW] FIX-TOUCHING and FIX-WEEK fixtures collide on 2026-08-19
- Run: 2026-08-23-2200
- Phase: verify
- Status: OPEN
- What: `.agents/USE_CASES.md`'s fixture catalogue: `FIX-TOUCHING` seeds three sessions
  on `2026-08-19`; `FIX-WEEK` seeds one session on each of `2026-08-17/18/19`. Both
  claim `2026-08-19`, and VERIFY_TASKS step 31 groups seeding both in the same pass —
  attempting that produces a genuine `SESSION_OVERLAP` (09:00-17:00 the whole day,
  written by `FIX-WEEK`, cannot coexist with `FIX-TOUCHING`'s 09:00-11:00/11:00-12:00/
  14:00-15:00 on the same date). Confirmed live: seeded and verified each fixture in
  its own truncated pass instead, per-fixture behaviour otherwise correct.
- Impact: None on the application — this is a catalogue/handover authoring slip, not a
  code defect. It cost this phase a truncate-and-reseed it would not otherwise have
  needed.
- Tried: Seeded them separately; both verified correctly in isolation (documented in
  `04-verify.md`).
- Next: Either move `FIX-WEEK` off `2026-08-19` (e.g. `2026-08-16/17/18`) or note
  explicitly in the fixture catalogue that the two are seeded in separate passes, next
  time `USE_CASES.md` is touched.

## [LOW] /login page rendering could not be exercised over HTTP this phase
- Run: 2026-08-23-2200
- Phase: verify
- Status: OPEN
- What: `src/routes/login/+page.svelte` does not exist yet — by design, spec
  `002-worklog-ui` (not started) owns it; `001` owns only `+page.server.ts`. `GET
  /login` therefore 500s with SvelteKit's own "Missing +page.svelte component for
  route /login" before this spec's `%lang%`/`%theme%` substitution, or the page-level
  cookie-attribute behaviour, can be observed against real rendered HTML.
- Impact: VERIFY_TASKS step 10 (UC-074, UC-075) could not be ticked as fully passed —
  left unticked rather than marked done. Not a code defect in `001`:
  `handleSecurityHeaders`/`substitutePagePlaceholders`/`resolveRenderTheme` are
  unit-tested (`security-headers.test.ts`, part of the green 327-test suite), and this
  phase independently confirmed live that the three preference cookies ARE set with
  the exact Requirement 12.30 attributes (`SameSite=Lax`, `Path=/`,
  `Max-Age=31536000`, `Secure` since `APP_ENV=test`, script-readable) on both `/login`
  and `/logout` responses even though the body 500s, and that the response still
  carries the standard security headers and a request log line despite the 500 (the
  hook-ordering fix above applies here too). `lang`/`data-theme`/placeholder-survival
  on real rendered HTML remain unverified until `002` supplies the missing component.
- Tried: Confirmed the 500 is exactly the missing-component error, not a regression.
- Next: Re-run VERIFY_TASKS step 10 once `002-worklog-ui` adds
  `src/routes/login/+page.svelte`.

The eighteen entries below are `cases`-phase findings, each confirmed live this phase
and marked accordingly.

## [HIGH] A bad configuration never logs its problem list or exits non-zero
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `loadConfig()` in `src/lib/server/core/config.ts` collects every problem and
  throws a `ConfigError`, but nothing catches it. `src/hooks.server.ts:53` calls
  `getConfig()` at module load and there is no `try/catch`, no `process.exit` and no
  top-level handler anywhere in `src/` or in the container `CMD`. The carefully
  collected list of problems is therefore never logged as such — only whatever the
  runtime happens to print for a module-load throw — and the process does not exit
  deliberately.
- Impact: Requirement 13.24 ("log the complete list of problems and exit with a
  non-zero status before it accepts any connection") is not met, and neither is the
  "exit with a non-zero status" half of 13.8, 10.9, 10.13, 11.16, 13.12, 13.15, 13.17,
  13.22, 13.29, 13.33 and 13.34 — every startup check inherits the same handling. An
  operator with one bad variable gets a stack trace rather than a list of what to fix.
- Tried: Nothing — found by reading, not by running. UC-008 through UC-022 assert the
  specified behaviour.
- Next: Wrap the module-load `getConfig()` in a handler that logs every collected
  problem at error level and calls `process.exit(1)`, and confirm the container stops
  rather than restarting into the same failure.

## [MEDIUM] METHOD_NOT_ALLOWED is never produced, and framework errors escape the envelope
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `src/lib/server/core/errors.ts` declares the code, maps it to 405 and
  serializes `details.allowed[]` into an `Allow` header, but nothing in the codebase
  ever throws it — no route, no hook, no fallback. A wrong method on an existing path
  falls through to SvelteKit's built-in 405, which sets `Allow` but returns a body that
  is not the error envelope. There is also no `handleError` export, so framework-level
  404s and 500s escape the envelope too.
- Impact: Requirement 12.24 is unimplemented; Requirements 12.2 and 12.5 do not hold
  for a path the router does not match. A client that handles errors in one place, as
  12.2 exists to allow, breaks on exactly these responses.
- Tried: Nothing — found by reading. UC-069 asserts the specified behaviour.
- Next: Add the missing method exports (or a `+server.ts` fallback) that throw
  `ApiError(405, 'METHOD_NOT_ALLOWED', …)` with `allowed[]`, and add a `handleError`
  hook that renders the envelope for framework-raised failures.

## [MEDIUM] The streaming body-size limit answers 500 instead of 413
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `handleBodySizeLimit` wraps the request body in a `TransformStream` that errors
  with a plain `Error('PAYLOAD_TOO_LARGE')` once the cumulative byte count passes
  `MAX_BODY_BYTES`. Every route wraps its own body read in
  `try { … } catch (err) { return errorResponse(err, …) }`, which turns a non-`ApiError`
  into 500 `INTERNAL_ERROR` before the hook's own catch can see it. Only the
  `Content-Length` pre-check returns a real 413.
- Impact: Requirement 12.15 (enforce the limit while reading the stream) produces the
  wrong status for a chunked request carrying no `Content-Length`, so a caller cannot
  tell an over-sized body from a server defect.
- Tried: Nothing — found by reading. UC-057 covers both paths.
- Next: Make the transform error an `ApiError(413, 'PAYLOAD_TOO_LARGE', …)`, or have the
  routes rethrow an unrecognised body-read failure so the hook's catch can classify it.

## [MEDIUM] Cross-origin session-cookie rejection is production-only
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `src/hooks.server.ts:333-336` ignores a `Browser_Session` cookie on a request
  carrying a foreign `Origin` **only when** `config.appEnv === 'production'`. In
  `development` and `test` the cookie authenticates a cross-origin request.
- Impact: Requirement 11.18 is unconditional, and Requirement 13.35 says `test` may
  relax nothing but the `Secure` cookie flag. The end-to-end suite therefore runs
  against a weaker rule than production, which is precisely the arrangement that lets a
  CSRF regression pass its own tests.
- Tried: Nothing — found by reading. UC-048 asserts the unconditional rule.
- Next: Drop the `appEnv` condition; the check needs `PUBLIC_ORIGIN`, so give it a
  sensible value in `development` and `test` rather than skipping the check.

## [MEDIUM] The three preference cookies are read but never set
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `handleLocals` and `resolveRenderTheme` read `worklog_locale`, `worklog_theme`
  and `worklog_theme_resolved`, but nothing in `src/` ever sets any of them, so the
  attribute table of Requirement 12.30 (`SameSite=Lax`, explicit `Path`,
  `Max-Age=31536000`, `Secure` outside development, script-readable) is unimplemented
  on the server side.
- Impact: Requirement 12.30 says the server "SHALL set and accept" all three. Accepting
  them works; setting them does not exist. Spec `002` may be intended to write them from
  script, but nothing in `001` guarantees the attributes the requirement fixes.
- Tried: Nothing — found by reading. UC-076 asserts it.
- Next: Decide whether `001` owns setting them (add a small helper plus the route that
  uses it) or whether the requirement belongs to `002`; if the latter, that is a spec
  change and needs the user, not a silent reassignment.

## [MEDIUM] DELETE /api/projects/{id} answers 204 for an unknown id
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `src/lib/server/store/projects.ts:167` deletes without checking that the row
  exists, so a `DELETE` naming a project that was never created answers 204.
  `updateProject` (same file, line 139) does raise `NOT_FOUND`, so the two disagree.
- Impact: Requirement 12.5 ("WHEN a path identifier does not reference an existing
  record … 404 NOT_FOUND") is not met on this route. A client cannot distinguish "I
  deleted it" from "there was nothing there", which matters when two devices race.
- Tried: Nothing — found by reading. UC-056 covers all four resources.
- Next: Check the delete's affected-row count and raise
  `ApiError(404, 'NOT_FOUND', …, { resource: 'project', id })` when it is zero.

## [MEDIUM] POST /api/sessions reports reversed bounds as INTERVAL_TOO_SHORT
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `src/routes/api/sessions/+server.ts:43` runs `assertIntervalNotTooShort` before
  any ordering check, and `createSession` in `src/lib/server/services/sessions.ts:243`
  has no `start < end` guard at all — unlike `patchSession`, which does. A request whose
  `endedAt` is at or before its `startedAt` therefore answers 400 `INTERVAL_TOO_SHORT`
  with a negative `actualSeconds`.
- Impact: Requirement 2.6 specifies `INVALID_INTERVAL` for exactly this case. The wrong
  code sends the client down the wrong branch, and a negative `actualSeconds` in
  `details` is nonsense a caller may render.
- Tried: Nothing — found by reading. UC-109 covers both the POST and the PATCH path.
- Next: Add the ordering check to `createSession` ahead of the length check, mirroring
  `patchSession`.

## [MEDIUM] /api/days/{date} accepts an impossible but well-formatted date
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `dayDateParam` in `src/lib/contracts/schemas.ts:183` validates only the shape
  `^\d{4}-\d{2}-\d{2}$`, so `2026-13-45` passes and is handed straight to
  `dayResolver.bounds`, which answers 200 for a day that does not exist.
- Impact: Requirement 8.7 requires 400 `VALIDATION_ERROR` for a `{date}` that is not a
  valid `YYYY-MM-DD` date. A typo silently returns a plausible-looking empty day.
- Tried: Nothing — found by reading. UC-179 covers both the malformed and the
  impossible case.
- Next: Add a calendar check to the schema (round-trip the parsed date and compare) so
  the impossible values are rejected before they reach the resolver.

## [LOW] An empty PATCH body on a project answers 500
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `patchProjectSchema` accepts `{}` (every field is optional), and
  `src/lib/server/store/projects.ts:136` then issues `update(...).set({})`, which
  Drizzle rejects — surfacing as 500 `INTERNAL_ERROR`.
- Impact: A request that passes validation should never produce a 500. The requirements
  do not legislate for an empty patch either way, so the target is a no-op 200 or a 400
  — not an internal error.
- Tried: Nothing — found by reading. UC-083 asserts "no-op 200 or 400, never 500".
- Next: Return the unchanged project when no field was supplied, or reject the empty
  object in the schema. Whichever is chosen, state it in the spec.

## [LOW] A readiness 503 carries no security headers and writes no log line
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `handleReadiness` sits second in the handle sequence, before both
  `handleRequestLog` and `handleSecurityHeaders`, so its 503 carries only
  `x-request-id`, `content-type` and `retry-after`, and it is the one response that
  produces no `request` log line.
- Impact: Requirement 12.12 asks for the three security headers on **every** response
  and 12.10 for one log line per request. A degraded service is also the moment an
  operator most wants the log line.
- Tried: Nothing — found by reading. UC-003 asserts both.
- Next: Move `handleReadiness` after `handleRequestLog` and `handleSecurityHeaders`
  while keeping it ahead of auth, or apply both explicitly on the 503 path.

## [LOW] The readiness probe re-runs on every request while it is failing
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `getReadiness` nulls `readinessPromise` whenever the probe fails
  (`src/hooks.server.ts:143`), so the next request starts a fresh probe. Its own
  comment, `design.md` ("re-run at most once per `CLEANUP_INTERVAL_MINUTES`") and
  `tasks.md` all describe a throttled re-probe.
- Impact: With the database down, every inbound request costs a connection attempt and
  a round-trip timeout, which is the worst moment to add load and latency.
- Tried: Nothing — found by reading.
- Next: Cache the failed result with a timestamp and re-probe only after
  `CLEANUP_INTERVAL_MINUTES`.

## [LOW] reason=session_expired is never produced
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `handleAuth` redirects an unauthenticated page request to `/login?next=…` only.
  The string `session_expired` appears nowhere in `src/` or `messages/`, so the
  `reason` parameter Requirement 11.25 defines is accepted but never set.
- Impact: A user whose session expired is indistinguishable from one who never logged
  in, and `002` has a message it can never show.
- Tried: Nothing — found by reading. UC-050 asserts it.
- Next: Have the auth hook distinguish "cookie present but expired" from "no cookie" and
  append `reason=session_expired` in the first case.

## [LOW] The activity preview token fingerprints the requested start's day, not the Target_Day
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `src/lib/server/services/activities.ts:351` (and 623) computes the preview
  window as `dayResolver.bounds(dayResolver.dateOf(requested.start))`. `design.md`
  specifies "the whole `Logical_Day` of the `Target_Day`". For an explicit interval
  spanning two logical days, the second day is left unfingerprinted.
- Impact: A change inside the second day does not invalidate the preview, so a
  confirmed write can differ from what was previewed — the one thing the
  `Preview_Token` exists to prevent (Requirement 14.7, 14.8).
- Tried: Nothing — found by reading. UC-214 and UC-215 exercise the token but not this
  two-day edge.
- Next: Fingerprint the union of every `Logical_Day` the request touches, and add a
  two-day case to the dry-run tests.

## [LOW] An idempotent replay ignores the status it stored
- Run: 2026-08-23-2200
- Phase: cases
- Status: OPEN
- What: `idempotency_keys.status` is written as the literal `201` and never read back;
  the route re-hardcodes `201` when replaying.
- Impact: Requirement 12.16 asks for the original status to be retained **and
  replayed**. Today every replayable write is a 201, so nothing is observably wrong —
  but the column is decorative and the next replayable status will be wrong silently.
- Tried: Nothing — found by reading. UC-059 checks the replay body and status.
- Next: Replay `status` from the stored row.

## [LOW] /logout is exempt from authentication
- Run: 2026-08-23-2200
- Phase: cases
- Status: OPEN
- What: `src/hooks.server.ts:361` exempts `/logout` alongside `/api/health`, the login
  route and the static assets. Requirement 11.1 enumerates the exemptions and does not
  include it.
- Impact: Practically none — the route only deletes the session named by the cookie the
  caller already presented, and an unauthenticated call is a no-op that still redirects.
  It is a divergence from an enumerated list, which is the kind of thing that should be
  either fixed or written into the requirement rather than left as folklore.
- Tried: Nothing — found by reading. UC-052 records the exemption and this issue.
- Next: Decide with the user whether 11.1 should name `/logout`; do not "fix" it by
  requiring auth without checking that logout still works from an expired session.

## [LOW] ALLOW_DAY_BOUNDARY_CHANGE rejects the truthy spellings tasks.md requires
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `loadConfig` accepts only the literal `true` or `false`; any other value is a
  fatal configuration problem. `tasks.md` line 403 requires `1`, `true` and `yes` all to
  be read as true.
- Impact: An operator following the task description sets `ALLOW_DAY_BOUNDARY_CHANGE=1`
  and the server refuses to start, at exactly the moment they are trying to repair a
  day-boundary mismatch.
- Tried: Nothing — found by reading. UC-006 uses the accepted spelling.
- Next: Accept `1`/`true`/`yes` (and `0`/`false`/`no`) case-insensitively, or amend
  `tasks.md` — the two must agree.

## [LOW] CORS_ORIGINS='*' is accepted in development but matches nothing
- Run: 2026-08-23-2200
- Phase: cases
- Status: RESOLVED (2026-08-23-2200)
- What: `loadConfig` permits the wildcard when `APP_ENV=development`, but `matchesOrigin`
  is an exact list membership test, so `*` is stored and never matches an origin.
  Entries are also never trimmed, so `a, b` yields a literal `" b"` that can never
  match.
- Impact: Requirement 11.17 permits a development wildcard, and a developer who sets one
  gets silence rather than the permissive behaviour they asked for.
- Tried: Nothing — found by reading. UC-021 and UC-047 cover the surrounding rules.
- Next: Either honour `*` in development or refuse it everywhere and say so; trim the
  entries either way.

## [LOW] The login passphrase behind the stored hash is not recorded anywhere
- Run: 2026-08-23-2200
- Phase: cases
- Status: OPEN
- What: `.env` holds a real argon2id `WORKLOG_PASSPHRASE_HASH`, but the passphrase that
  produced it appears nowhere in the repository, `.agents/`, the docs or the run
  reports.
- Impact: Every use case that needs a `Browser_Session` — UC-035, UC-036, UC-037,
  UC-038, UC-039, UC-040, UC-041, UC-043, UC-048, UC-049, UC-050 — cannot be exercised
  as written without either minting a new hash for a chosen passphrase or inserting an
  `auth_sessions` row directly. The bearer-token path is unaffected.
- Tried: Grepped the repository, `.agents/MEMORY.md`, `.agents/runs/` and the docs.
- Next: For verification, mint a throwaway hash with `./scripts/hash-passphrase.sh` and
  use it in the scratch environment only. Do not change the committed `.env`, and do not
  record any passphrase in a tracked file.

## [LOW] scripts/start-docker.sh's --network host untestable in this sandbox
- Run: 2026-08-23-2200
- Phase: impl
- Status: RESOLVED (2026-08-23-2200)
- What: Task 12's checkpoint (`./scripts/start-docker.sh`, apply migrations, exercise
  the worked example, confirm `/api/health`, `./scripts/backup.sh`,
  `./scripts/stop-docker.sh`) could not be run through `start-docker.sh` literally as
  written: it runs the container with `--network host` (correct for a real Linux
  deployment reaching a `DATABASE_URL=localhost` Postgres), but this sandbox's Docker
  daemon is itself accessed through a remote/proxied setup where `worklog-pg` (the
  Postgres this session has used throughout) is only reachable by container name on
  the `trayline-net` bridge network — `--network host` bypasses Docker's embedded DNS
  entirely, so the container could never resolve it.
- Impact: None on the shipped artifact — `start-docker.sh` itself was not modified.
  This is purely a sandbox networking limitation (documented in the
  `sandbox-docker-net` skill: host-published ports are unreachable from this shell).
- Tried: Ran the equivalent verification directly instead — built the exact image
  `scripts/build.sh` produces, ran it with `docker run --network trayline-net`
  (bridge, not host) and `--env-file .env`, then ran every checkpoint step against it:
  `scripts/migrate.sh` inside the container reported up to date, `/api/health`
  answered `{"status":"ok",...}` with the correct version/timezone/day start, the
  worked Clipping example (13:00-16:00 over the 08:00-14:48/15:12-18:00 frame)
  produced the documented two segments with the break discarded, `scripts/backup.sh`
  produced a real 13KB `pg_dump` with 8 `COPY` statements (one per table), and the
  container was torn down cleanly. Every part of `start-docker.sh` this substitution
  could not itself exercise (the `--network host` flag) was already covered
  structurally: `docker run --env-file .env` is the only meaningfully different piece,
  and that pattern is identical to what `docker run --network trayline-net --env-file
  .env` just verified.
- Next: None — re-verify with the literal script on a real machine or CI runner where
  Postgres is reachable at `localhost`, but nothing here suggests it would behave
  differently.

## [LOW] bun audit reports two transitive vulnerabilities blocked upstream
- Run: 2026-08-23-2200
- Phase: impl
- Status: OPEN
- What: `bun audit` (checkpoint task 12) reports two: `cookie@0.6.0` (low —
  GHSA-pxg6-pf52-xh8x, out-of-bounds characters accepted in a cookie name/path/
  domain, fixed in cookie >=0.7.0) via `@sveltejs/kit@2.70.3 > cookie`; and
  `esbuild@0.18.20/0.25.12/0.28.2` (moderate — GHSA-67mh-4wv8-2f99, esbuild's dev
  server accepts requests from any origin, fixed in esbuild >0.24.2) via
  `drizzle-kit > @esbuild-kit/core-utils@3.3.2 > esbuild` and `vite > tsx > esbuild`.
- Impact: Low in practice for both. Every cookie this application ever sets uses a
  fixed, hardcoded name (`worklog_session`, `worklog_locale`, `worklog_theme`,
  `worklog_theme_resolved`) — never user-controlled input — so the `cookie` advisory's
  attack surface (an attacker-chosen name/path/domain) does not exist here. The
  `esbuild` advisory is about its own dev-server accepting cross-origin requests; this
  project never runs `esbuild serve` directly — `drizzle-kit`'s internal use of it
  (schema introspection tooling) never exposes a server, and it is a devDependency
  only, never shipped in the production Docker image (`bun install --frozen-lockfile
  --production` in the runtime stage).
- Tried: `bun audit fix` and `bun audit fix --latest` — both report "blocked by a
  dependent's range": `@sveltejs/kit@2.70.3` itself pins `cookie@^0.6.0` (not this
  project's own declared range, which is `^2.63.0` for `@sveltejs/kit` and already
  resolves to its latest matching patch), and `@esbuild-kit/core-utils@3.3.2`
  (transitive, via `drizzle-kit`) pins `esbuild@~0.18.20`. Neither is fixable by
  changing a range in this project's own `package.json` — only a newer major release
  of `@sveltejs/kit` or of `drizzle-kit`'s own dependency chain would move either.
- Next: Re-run `bun audit` after a future `bun update` once `@sveltejs/kit` or
  `drizzle-kit` ship a release that bumps these transitive pins; do not bump
  `@sveltejs/kit` or `drizzle-kit` outside their currently-tested ranges solely to
  chase this without re-verifying compatibility.

## [LOW] Task 10.5 (gauge window / suggested window property tests) not written
- Run: 2026-08-23-2200
- Phase: impl
- Status: OPEN
- What: `tests/api/days.property.test.ts` (Property 19: overtime and in-window time
  partition the day; Property 21: the suggested window brackets the bulk of the work),
  marked optional (`*`) in `tasks.md`, was not written. Tasks 10.1 (required) and
  10.2-10.4 (optional) were all implemented and verified against the real database;
  10.5 was the one optional task deliberately left for time budget reasons after the
  test suite's runtime had already grown substantially from 10.2-10.4 (real-database
  property tests are far slower than the in-memory ones in `domain/`).
- Impact: Low. The underlying behaviour Properties 19 and 21 would check —
  `overtimeSeconds` against the `Gauge_Window`, `suggestedWindow` bracketing 90% of
  `Tracked_Time` — already has deterministic coverage in `tests/api/days.test.ts`
  (day ending at 03:00 reports 3h overtime, `eveningSeconds`, a populated
  `suggestedWindow`), just not as a randomized property test sweeping DST transition
  dates and arbitrary `Gauge_Window` configurations.
- Tried: Nothing — deliberately deferred, not attempted and abandoned.
- Next: Write `tests/api/days.property.test.ts` per task 10.5's description if this
  spec is revisited: generate random session frames across ranges including both
  Prague DST transitions (2026-03-28, 2026-10-24) and gauge windows other than the
  default, asserting the two identities design.md states for Properties 19 and 21.

## [LOW] aggregates.ts computes day summaries in TypeScript, not SQL
- Run: 2026-08-23-2200
- Phase: impl
- Status: OPEN
- What: Design component 6 / task 4.7 specify that `daySummaries`, `dayIntervals` and
  `suggestedWindow` in `src/lib/server/store/aggregates.ts` must be computed "in SQL
  over the requested day windows... the database is never asked to reason about the
  Logical_Day", explicitly to avoid "read it all and reduce in TypeScript" for a
  366-day range. The implementation instead loads the raw `work_sessions` and
  `activity_segments` rows overlapping the requested range in two queries, then
  reduces them per day in TypeScript using the already-correct, already
  property-tested `domain/interval.ts` algebra (`clamp`, `intersect`, `subtract`,
  `normalize`, `total`).
- Impact: For a genuinely enormous number of rows (many years of dense multi-session
  days) this would pull more into process memory than the design's SQL-aggregation
  approach. For the realistic scale of a single-user personal time tracker — at most a
  few thousand `work_sessions`/`activity_segments` rows even over a full year, and
  `MAX_RANGE_DAYS` (366) hard-caps every request regardless — this is not a practical
  correctness or availability risk, just a deviation from the stated implementation
  strategy.
- Tried: Weighed writing the day-boundary-aware SQL aggregation (longest-touching-
  block merge, per-project sums, the circular suggested-window sweep) directly in
  PostgreSQL. Given how easy each of those is to get subtly wrong in raw SQL and how
  hard to test as thoroughly as the existing Vitest/fast-check coverage over
  `domain/interval.ts`, reducing in TypeScript over bounded, already-range-limited
  data was judged the better risk trade for this run.
- Next: If usage ever grows enough for this to matter (unlikely for a single-user
  app), rewrite `aggregates.ts`'s three functions as SQL window functions /
  aggregates, keeping the same exported signatures so no caller needs to change.
