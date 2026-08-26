# Phase 4 — Verify

**Target:** `.` — the repository root, matching `.agents/PIPELINE_STATE.json`'s
`"target": "."` and phase 3's own resolution. Worklog is a single-package repository;
there is no sub-project to resolve.

## Result
OK WITH ISSUES

## Headline
All 62 steps of `.agents/tmp/VERIFY_TASKS.md`'s walkthrough ran against a real
Postgres database and a real built SvelteKit instance — every one of the 90 use cases
in `.agents/USE_CASES.md` Part III was executed, not read. 88 pass. The two written as
expected failures (UC-589, UC-598) failed exactly as predicted and nothing else. Along
the way this phase found and fixed a real, user-facing bug: converting an existing
`Work_Entry` into a `Leisure_Entry` through the actual `Activity_Dialog` UI silently
failed every time, because of a `sveltekit-superforms`/`FormData` quirk that made
"the field was omitted" indistinguishable from "the field was explicitly null." Two
smaller findings were also fixed (a discarded-intervals under-report on the same code
path; a self-inflicted date collision between two of this spec's own new E2E fixtures),
and two pre-existing accessibility defects were logged for a future run rather than
fixed, being out of this spec's scope.

## Needs attention
- **UC-527's literal "Expected" text does not match the implementation's actual
  behaviour**, and the implementation's behaviour is the one already accepted by
  UC-525/526/528 and by `ISSUES.md`'s existing `[LOW]` "Requirements 3.2 and 3.3
  disagree" entry. The case says a 30-second sliver-below-the-floor produces `409
  NOTHING_TO_LOG`; the running server (consistently, confirmed twice) produces `409
  ACTIVITY_OVERLAP` instead — because the code follows the 3.3 (any-overlap-refused)
  reading throughout, and a request that partially overlaps never reaches the
  floor/sliver check at all under that reading. This is a `cases`-phase authoring
  slip (the case's numbers read as copied from a different scenario), not a product
  defect — the code is internally consistent with UC-525/526/528. No `ISSUES.md` entry
  was opened for it since the root cause is the same already-logged spec ambiguity;
  worth a one-line correction to UC-527's "Expected" text next time `USE_CASES.md` is
  touched.
- **Two pre-existing (`002-worklog-ui`-vintage) accessibility defects were newly
  surfaced** by this run's own axe sweep (broader than `tests/e2e/a11y.spec.ts`'s: a
  390px light-theme pass over `/stats`, and a scan of the `Activity_Dialog`'s
  segmented controls) and logged to `ISSUES.md` as `[HIGH]` and `[MEDIUM]` rather than
  fixed, since fixing either touches `002-worklog-ui` component behaviour this phase
  was not chartered to change:
  - `ProjectPicker.svelte`'s search input carries `aria-activedescendant` pointing at
    a listbox option ID that does not exist in the DOM while the popup is collapsed —
    `aria-valid-attr-value`, critical. Confirmed via `git log` that the wiring predates
    spec 003.
  - A shared rust-orange text colour (`#a5522e` / `#d18a6a` depending on theme)
    marginally fails 4.5:1 AA in two places axe never scanned before: the statistics
    page's new "Volný čas" row (sharing a class with the pre-existing "Bez popisu"
    row, which fails identically) and the segmented control's active-tab state in
    dark theme (the category control and the pre-existing mode control fail
    identically, sharing one CSS class).
- **The design artboards (`TimerCategories.png`, `DayCategories.png`,
  `AddTaskCategories.png`) show icons on the segmented controls and colour-swatch
  bullets on the category-figure rows that the actual implementation does not
  render.** Verified this is consistent with the pre-existing (non-category) mode
  control and the pre-existing "Bez popisu"/day-rhythm styling, not something spec
  003 introduced — and a category can aggregate many differently-coloured projects,
  so a single representative swatch per category is not well-defined the way the
  artboard's one-project-per-category mock data implies. Treated as "copy and example
  data" within the artboard-conformance cases' own stated tolerance; not logged as a
  defect.
- **`auth.spec.ts`'s "a wrong passphrase..." test failed once, hitting the login rate
  limiter** — this is `ISSUES.md`'s own pre-existing, still-`OPEN` `[LOW]` entry from
  the `2026-08-24-0659` build phase ("Full E2E suite... still occasionally exceeds the
  login rate limit"), not a new finding. No action taken here.

## What changed
- **`src/lib/server/services/activities.ts`** — `patchActivity`'s category-crossing
  meta-only branch now returns `discarded: result.discarded` instead of a hardcoded
  `[]`, matching the sibling interval/duration-change branch's own contract
  (Requirement 4.3). Found via UC-538 (step 22): the response undercounted a re-clip
  that left part of the requested interval outside the new regime's `Tracked_Time`.
- **`src/lib/server/services/activity-form-actions.ts`** — the biggest finding this
  phase. `patchActivityAction`'s "clearProject and projectId are contradictory"
  guard, and the `projectId` value it passes to the service, both used to read
  `form.data.projectId !== undefined` to mean "was this field actually submitted."
  `sveltekit-superforms` fills a `FormData`-absent nullable field in with `null`, not
  `undefined`, so that check was always true — every plain `clearProject=true`
  submission (no `projectId` field at all, exactly what the real `Activity_Dialog`
  sends when converting an existing `Work_Entry` to `Volno`) was rejected as a
  "contradictory outcome" (400, `errors_validation_error`) before this fix. Confirmed
  broken through the real browser (open an Alpha entry, switch to Volno, save — the
  dialog silently failed) before fixing, and confirmed fixed the same way afterward
  (the entry now genuinely re-renders as a `Leisure_Entry`). Fixed by checking
  `formData.has('projectId')` directly instead. Verified this does not regress the
  plain "description-only edit, category untouched" path (also tested live: Beta's
  description changed, its project stayed put) nor `tests/lib/server/services/
  activities.test.ts` (21/21 still pass).
- **`tests/e2e/conflict.spec.ts`** — the new "a Leisure_Entry overlapping a Work_Entry"
  test (task 12.2) hardcoded `2024-01-21`, which collides with `a11y.spec.ts`'s own new
  leisure fixture (also task 12.2) in the shared, once-per-run-reset database. Moved
  to the unclaimed `2024-01-24`. Confirmed by running the full suite twice — the
  collision reproduced before the fix, both specs passed together after it.
- **`.agents/ISSUES.md`** — two new entries (above), logged rather than fixed, plus
  the UC-527 note above (not a new entry — same root cause as an existing one).
- No other source file changed. `bun run check` and `bun run lint` both pass clean
  after these fixes.

## Decisions made
- **`FIX-CAT-UI-DAY`/`-UI-LEISURE`/`-UI-MANY` were seeded on a fixed past date
  (`2026-08-24`) rather than literal `TODAY`, except where the surface under test
  genuinely requires the real current day.** The app rejects any write ending more
  than `FUTURE_TOLERANCE_SECONDS` in the future, and this run executed around 13:00
  Prague time — several of these fixtures' catalogue clock times (up to 19:30) are
  themselves in the future at that hour. The day page takes an explicit date, so
  nothing about Passes 12-15 and 18 requires "today" specifically; only the timer page
  (Pass 11) does, and that fixture's structure was compressed to fit before the actual
  wall-clock time while keeping the same shape (two sessions, a break, one entry each,
  leisure after both with a gap). `FIX-CAT-UI-FOLD` (Pass 17, consumed through
  `/stats`, whose "week" range is always the real current Monday-Sunday) was seeded
  across the elapsed days of that real week (Mon/Tue fully, Wed partially) rather than
  a literal trailing seven days, since the trailing seven days do not all fall inside
  the range the stats page will actually display.
- **UC-527 is reported as a cases-phase authoring inconsistency, not re-verified
  against a guessed correct answer.** The alternative — quietly making the case pass
  by asserting whatever the server actually returns — would have hidden that the
  catalogue's own text disagrees with itself (its stated numbers belong to a different
  fixture). Recorded in "Needs attention" instead of silently reconciled.
- **The two newly found accessibility defects were logged, not fixed.** Both
  demonstrably predate `003-worklog-time-categories` (confirmed via `git log` for the
  `aria-activedescendant` one; confirmed via the identical pre-existing sibling
  element failing the same way for the contrast one) and fixing either means touching
  `002-worklog-ui` component behaviour — outside what this run was verifying.
- **Sandbox environment**: `docker compose` is blocked in this sandbox, so `worklog-pg`
  (already running, pre-existing, not started or stopped by this phase) was reached
  directly by container name — this shell is itself attached to `trayline-net`. No
  `psql` client exists in this shell; a throwaway shim forwarding to
  `docker exec -i worklog-pg psql` was used for `migrate.sh` and ad-hoc queries, with
  the migration files `docker cp`'d into the container so `\i` could resolve them.
  Neither the shim nor the copied files were committed or left behind.
- **Full E2E suite reused the manually-started app instance.** The persistent instance
  for this phase's browser passes was built and started with the exact env
  `playwright.config.ts` expects (`WORKLOG_API_TOKEN`, a `WORKLOG_PASSPHRASE_HASH`
  matching `tests/e2e/e2e-passphrase.ts`'s plaintext, port 4173) specifically so
  `reuseExistingServer` would pick it up for step 62 rather than spawning a second
  instance — meaning the same server served both the manual walkthrough and the
  automated suite.
- **Login rate limiter is in-process and resets on server restart** (confirmed via
  `src/lib/server/core/rate-limit.ts`'s own doc comment) — worth remembering for any
  future run that needs a clean login budget rather than waiting out the 15-minute
  window.

## Environment (torn down)
`worklog_test` and `worklog_test_legacy` (both scratch databases on the pre-existing
`worklog-pg` container) were dropped; the manually-built app instance on port 4173 was
stopped; the `psql` shim and the migration files copied into the container were
removed. `worklog-pg` itself was left running — it predates this phase and was not
started by it. `.agents/tmp/VERIFY_TASKS.md` and `.agents/tmp/ENV_SETUP.md` were
deleted, per this phase's own consume-and-delete responsibility.
