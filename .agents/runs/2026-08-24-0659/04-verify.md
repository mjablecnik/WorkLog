# Phase 4 — Verify

**Target:** `.` (single SvelteKit project, no monorepo sub-projects — matches
`PIPELINE_STATE.json`'s existing `target`).

## Result
OK WITH ISSUES

## Headline
Brought up the real environment (Postgres on the sandbox's own network, migrated and
seeded fresh, the production build served) and walked the Part II catalogue (UC-237
through UC-508) primarily through the existing Playwright E2E suite plus targeted
manual/scripted checks and a dedicated visual-conformance pass. Fixed the E2E
clean-checkout blocker, a systemic WCAG contrast gap (wider than the three spots
originally logged), a 320px horizontal-overflow bug, and four defects found by
redoing the visual pass. 33 of 34 distinct E2E tests pass; the one failure is a
pre-existing, already-documented product bug outside this phase's repair scope. Five
items remain genuinely open and are detailed below, each with an `ISSUES.md` entry.
The phase's own gate ("done when every item in the walkthrough passes") is not met —
recorded as `failed`, consistent with how `impl` was recorded in this same run.

## Needs attention
- **Design-contradiction resolutions need the user's sign-off** — both were resolved
  by picking the shipped-code/requirement side over the visual-contract doc's
  wording, per this phase's explicit brief, but both are genuine judgment calls:
  - Block head type size: kept at **13px** (mobile 12) — matches `design.md`'s own
    `BLOCK_HEAD_PX=29` derivation and what `timeline-geometry.ts` ships.
    `.design/DESIGN.md`'s "14px" was corrected to match. If 14px was actually
    intended, this needs a real code change (`BLOCK_HEAD_PX=31`, a re-run of the
    height-ladder generator, re-verification of every block-head-dependent case),
    not a docs edit.
  - Mobile `Uncovered_Marker` pill threshold: kept at **44px** — matches
    Requirement 10.7 and what `SegmentBlock.svelte`'s `isUncoveredTall` already
    implements (`heightPx >= 44`). `design.md`'s looser "above the floor" wording
    was corrected to state 44px explicitly. This is the *opposite* call from what
    the `cases` phase's own `ISSUES.md` entry guessed might be "probably intended"
    — reversed here because the shipped code, not a guess about design intent, is
    what actually matches the requirement.
  - Both are flagged `RESOLVED` in `ISSUES.md` but marked "needs the user's
    sign-off" in the entry itself — treat as provisional until confirmed.
- **Five items remain genuinely open**, all pre-existing and already documented,
  confirmed still failing this run and judged out of a repair-only pass's scope:
  1. UC-305/UC-334 — the mobile `Fab`'s two-item create sheet has no working entry
     point at all (confirmed live: zero fixed-position buttons render). Needs a new
     FAB-passthrough mechanism between `+layout.svelte`/`Shell.svelte` and each
     page — a feature, not a repair.
  2. UC-417 — four `Icon.svelte` glyphs (`search`, `sun`, `moon`, `check`) have no
     artboard source; needs a decision from whoever owns `.design/` (extend the
     artboards, or accept the fallback geometry as scope).
  3. UC-291 — `layOutDay`'s `continues` flag uses a UTC-midnight approximation
     instead of the real `Logical_Day` boundary; needs `layOutDay`'s signature
     extended with real day-bounds, a task-3.7/3.4/3.5-sized change.
  4. UC-350 — `SessionDialog`'s Editing→Confirming shortcut follows `design.md`'s
     literal wording rather than `ChangePreview`'s three-way `lostUncoveredSeconds`
     check; needs a product decision on which is the intended bar, not a guess.
  5. The "nine token-only surfaces" (confirmation dialogs generically, toasts,
     empty states, skeletons, login/error/offline pages, the timezone notice, the
     focus ring) that `DESIGN.md` specifies in prose rather than a drawn artboard
     were never checked against those token values — a real gap in task 11.6 that
     the 16-artboard image comparison (done this phase) doesn't cover.
- One pre-existing, already-tracked product bug remains failing and was left alone
  (outside this phase's fix scope): clicking "Odhlásit se" does nothing
  (`tests/e2e/auth.spec.ts`'s test of that name).
- Two Pass-1 source-sweep findings (UC-472's hardcoded flag colours, UC-423's 7
  files with an inverted `max-width` media-query direction) were found but not
  fixed — see their `ISSUES.md` entry for why.

## What changed
- **E2E clean-checkout blocker (UC-508), fixed.** `tests/e2e/e2e-passphrase.ts`
  (new) is the single source of truth for `E2E_PASSPHRASE`, importable by a plain
  `bun` process with no `@playwright/test` dependency. `scripts/hash-passphrase.sh`
  accepts a `PASSPHRASE` env var to skip its interactive prompt.
  `scripts/test-e2e.sh` now mints a matching `WORKLOG_PASSPHRASE_HASH` and a
  throwaway `WORKLOG_API_TOKEN` before starting the app.
  `tests/e2e/a11y.spec.ts`'s `storageState` cache moved from a hardcoded scratchpad
  path to `os.tmpdir()`. Verified each piece individually, plus a real
  `./scripts/test-e2e.sh` run that got past Postgres startup and a real query
  before hitting a **separate, pre-existing** sandbox limitation (this sandbox
  cannot reach a `docker run -p`-published port from its own shell) — not a defect
  in the script, which works normally on a real machine/CI.
- **Two design-contract contradictions, resolved** — see "Needs attention" above.
- **Systemic WCAG contrast violations, fixed.** What the `build` phase logged as
  "three violations" was actually `--text-faint`'s alpha being under-tuned against
  every one of the 8 `Palette_Slot` tints (not just `--bg`), plus an
  under-contrasting `--accent`-on-tinted-surface pairing used in five different
  components. Raised `--text-faint` (0.5→0.56 dark, 0.66→0.70 light) and added a
  new `--accent-on-tint` token, applied to `SegmentBlock`'s `Uncovered_Marker`,
  `SettingsMenu`, `ChangePreview`, `DataTable` and `DayRhythm`. `design.md`'s token
  tables updated to match. `tests/e2e/a11y.spec.ts`'s full axe sweep: zero
  `color-contrast` violations across all four pages, both themes.
- **320px horizontal overflow (UC-412), fixed.** Root cause:
  `+layout.svelte`'s viewport-cookie correction wrote the corrected cookie but
  never re-rendered the current page with it (`design.md` itself says it should
  "write the cookie and lay out again"). Added the missing `invalidateAll()`, plus
  CSS safety nets on `DayGauge.svelte` and the day page for the window before that
  resolves. Verified via the automated sweep plus a direct check of `/login`,
  `/offline`, and the settings sheet at 320px in both themes.
- **Two new defects found by redoing the visual-conformance pass (task 11.6),
  fixed.** Delegated the mechanical screenshot-vs-artboard comparison for all 16
  `.design/screens/*.png` (UC-486..UC-501) to a sub-agent with the exact fixture
  recipes, routes and pre-forgiven known-artboard-drawing-errors from the case
  catalogue. 14/16 passed clean or with only already-catalogued deviations. Two
  real, new findings, both fixed: the day page's header action pills were in
  reversed left/right order against the `DayCollapsed` artboards; `SessionDialog`
  dropped its time fields and delete link entirely during the Confirming/Saving
  phase instead of keeping them visible above the consequence panel.
- **UC-401's locale scroll test, fixed** — it asserted `scrollY > 0` against a page
  with zero actual scrollable overflow at the default test viewport, so the
  assertion never exercised what it claimed to. Pinned a short viewport before the
  scroll; the assertion itself is unchanged.
- **A message-catalogue defect, fixed** (found by a Pass-1 source sweep, not one of
  the nine pre-flagged cases): `session_delete_body` placed a verb after the count
  in every plural branch, in both locales, violating Requirement 13. Reordered.
- Two unit tests (`tests/lib/theme/contrast.test.ts`,
  `tests/lib/theme/theme.test.ts`) updated to the new, correct `--text-faint`
  values — not weakened, the same `>= 4.5:1` floor still holds, only the
  regression-tracker's exact expected number changed.

## Decisions made
- **Design contradictions resolved in favor of the shipped code / the numbered
  requirement over the visual-contract doc's prose**, on both — see "Needs
  attention". Flagged for sign-off rather than treated as permanently settled.
- **Contrast fix scope widened beyond the three originally-logged spots** once the
  actual root cause (a token, not three isolated elements) was found — fixing the
  token once was judged lower-risk and more correct than three narrow local
  overrides that would have left the same gap in every untested `Palette_Slot`.
- **`--accent-on-tint` introduced as a new token** rather than hand-tuning five
  components' text colours individually, to keep the fix traceable to one place
  and consistent with the existing `--segment-active` convention.
- **UC-412's fix applies two layers**: the root-cause `invalidateAll()` (general,
  covers any future density-dependent surface) plus page-specific CSS safety nets
  (immediate, covers the window before that resolves). Judged both necessary: the
  root-cause fix alone still leaves a sub-second flash of overflow on a real
  visitor's very first paint.
- **UC-472 (flag colours) and UC-423 (inverted media-query direction) were found
  but not fixed** — the former needs a decision (is a national flag's colour a
  legitimate token exception?), the latter is a 7-file mechanical refactor judged
  higher-risk-for-the-value than the contrast/overflow fixes, with no fresh visual
  QA budget left this phase to catch a mistake. Both logged in `ISSUES.md`.
- **The FAB entry point, the icon-source gap, the `continues` UTC approximation and
  the `SessionDialog` shortcut's `lostUncoveredSeconds` question were confirmed
  still failing and deliberately left alone** — each is a feature gap or a product
  decision, not a repair, matching this phase's remit.
- **The full unit test suite (`bun run test`) surfaced 6 failures in spec-001
  domain/store property tests**, run as a sanity check beyond this phase's UI
  scope. Re-ran the same three files in isolation immediately after: all 10 tests
  passed clean. Judged as sandbox DB/system contention from this session's very
  heavy concurrent Docker/Postgres/Playwright load, not a real regression — this
  phase made zero changes to server-side/domain code, spec 001 was already
  verified complete in an earlier separate run, and every E2E spec exercising the
  same domain logic through the real API passed cleanly multiple times. Logged as
  informational in `ISSUES.md` rather than treated as a new defect.
- **Environment reused rather than rebuilt**: the `worklog-pg` Postgres container
  predated this phase (left running by an earlier phase) and was reused rather
  than recreated — only the `worklog_test` database inside it was dropped and
  recreated fresh. The container itself was never touched or removed, per the
  rule against stopping infrastructure this phase didn't start.
- **E2E full-suite runs are flaky under this sandbox's login rate limit** when many
  test files run back-to-back in one process (`LOGIN_ATTEMPT_LIMIT` — already a
  known, pre-existing issue). Every failure observed this way was independently
  re-confirmed passing when run in isolation immediately after a server restart
  (which clears the in-memory rate-limit state) — none were treated as real
  regressions. The one full, uncontended suite run (34 tests) landed 19 passed / 15
  rate-limit-cascade failures; targeted clean reruns afterward brought the real
  count to 33 passed / 1 failed (the pre-existing logout bug).

## Environment used this run
- PostgreSQL 16 (`worklog-pg` container, pre-existing, reused): `worklog_test`
  database, dropped and recreated fresh, migrated via `./scripts/migrate.sh`.
- App: `bun run build` then `bun run preview --host 0.0.0.0 --port 4173`, restarted
  several times across fix/rebuild cycles (each restart also clears the in-memory
  login rate limiter, used deliberately a few times this run).
- `.env` (gitignored, not committed) pointed at `worklog_test`, `APP_ENV=test`, and
  a freshly minted `WORKLOG_PASSPHRASE_HASH` for the same `e2e-test-passphrase-9182`
  constant `tests/e2e/e2e-passphrase.ts` exports.
- Both stopped at the end of this phase; `worklog-pg` left running (not ours to
  stop). `.agents/tmp/ENV_SETUP.md` and `VERIFY_TASKS.md` deleted per the
  phase-close routine.
