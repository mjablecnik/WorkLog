# Implementation Plan: worklog-time-categories

## Overview

Add `Project.billable` and `Leisure_Entry` (an `Activity_Entry` with no `Project`,
reconciled against the `Unrestricted_Window` instead of `Tracked_Time`) to the
existing Worklog domain, API and interface. Work proceeds bottom-up exactly as
`001-worklog-domain-api`/`002-worklog-ui` did: schema and contracts first, then the
store and service layers against a real database, then the form-action layer the
interface actually writes through, then the interface itself. `clip()`'s pure math and
`Work_Session` are untouched — every task below either adds a new field or branch
beside existing code, changes what an existing function is called with, or narrows
which rows one query returns. Message keys and the palette slot land before the
components that consume them. Pure logic is covered by Vitest unit and `fast-check`
property tests; schema and aggregation changes by integration tests against
PostgreSQL; the interface by component tests and an extended Playwright pass. Test
tasks are interleaved with implementation tasks, and three checkpoints mark the data,
backend and full-stack boundaries.

## Tasks

- [ ] 1. Schema and contracts
  - [ ] 1.1 Write `migrations/002_leisure_time_categories.sql`
    - `ALTER TABLE projects ADD COLUMN billable boolean NOT NULL DEFAULT true;` — the
      `DEFAULT true` is itself the backfill; no separate `UPDATE` is needed or wanted
    - `ALTER TABLE activity_entries ALTER COLUMN project_id DROP NOT NULL;`
    - No other statement — no new constraint, no new index, no seeding. Confirm
      `activity_entries_mode_fields` and every other existing constraint reference
      neither column being touched
    - Never edit `migrations/001_init.sql`
    - _Requirements: 1.1, 1.7_

  - [ ] 1.2 Update the Drizzle schema in `src/db/schema/`
    - `projects.ts`: add `billable: boolean('billable').notNull().default(true)`
    - `activity-entries.ts`: drop `.notNull()` from `projectId`, keep the FK and
      `onDelete: 'restrict'` exactly as they are
    - Update both files' doc comments (they cite `migrations/001_init.sql` as
      authority) to also cite `002_leisure_time_categories.sql`
    - _Requirements: 1.1, 2.2_

  - [ ] 1.3 Update `src/lib/contracts/models.ts`
    - Add `export type Category = 'paid' | 'unpaid' | 'relax';`
    - `Project`: add `billable: boolean`
    - `ActivityEntry`: `projectId: string | null`, `projectName: string | null`,
      `colorIndex: number | null`, add `category: Category`
    - `NewActivityEntry`: `projectId: string | null`
    - `ProjectTotal`: add `billable: boolean`
    - Leave `ReclipOutcome`'s `projectName: string` / `colorIndex: number`
      **non-nullable** and add a comment saying why: task 2.3 filters
      `entriesAffectedBy` to `Work_Entry` rows, so no `Leisure_Entry` ever reaches
      `reclipAffected` and neither field can be null there
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [ ] 1.4 Update `src/lib/contracts/schemas.ts`
    - `createActivitySchema`: `projectId: z.uuid().optional()` (was required) — absent
      creates a `Leisure_Entry`
    - `patchActivitySchema`: `projectId: z.uuid().nullable().optional()` — three
      states: absent (no change), `null` (clear, become leisure), a uuid (set/change)
    - Add a **separate** `patchActivityFormSchema = patchActivitySchema.extend({
      clearProject: z.coerce.boolean().optional() }).strict()` — the form-action
      encoding of "convert to a `Leisure_Entry`", since a `FormData` body carries no
      null. Do **not** put `clearProject` on `patchActivitySchema` itself: that schema
      is shared with the JSON route, and because it is `.strict()`, leaving the field
      off makes the JSON route reject it with `VALIDATION_ERROR` rather than accept
      and silently drop it. Only the form action reads it; it never reaches the service
    - `createProjectSchema`: add `billable: z.boolean().default(true)`
    - `patchProjectSchema`: add `billable: z.boolean().optional()`
    - No existing `.refine()` on either activity schema needs to change — none of
      them reference `projectId`
    - _Requirements: 1.2, 1.3, 2.2, 2.3, 4.1, 4.2, 4.9, 4.10_

  - [ ] 1.5 Update `src/lib/contracts/responses.ts`
    - `DaySummary`: add `paidSeconds: number`, `unpaidSeconds: number`,
      `relaxSeconds: number`, and `leisure?: Interval[]` beside the existing
      `tracked?`/`covered?`/`uncovered?` (same `include=intervals` gating)
    - `DayResponse['totals']`: mirror the same three new numeric fields, exactly as it
      already mirrors `trackedSeconds`/`coveredSeconds`/`uncoveredSeconds`
    - `ActivityResponse.anchor.source`: add `'day-start'` to the union — a new union
      member, not a new field
    - Do **not** add `'day-start'` to `DayResponse.quickLog.anchorSource`; that is a
      separate union and `Quick_Log` has no day-start fallback (Requirement 6.6)
    - Update `DaysRangeResponse.intervalsIncluded`'s doc comment, which names
      "tracked, covered and uncovered", to name `leisure` too
    - _Requirements: 3.10, 6.2, 6.3, 6.4_

  - [ ] 1.6 Extend `tests/lib/server/store/schema.test.ts`
    - This suite asserts the Drizzle schema and the SQL migration agree — both column
      changes must be reflected in it
    - A `Project` created without `billable` defaults to `true`
    - An `activity_entries` row with a null `project_id` is accepted
    - Deleting a `Project` referenced only by `Work_Entry` rows still fails, and is
      unaffected by any `Leisure_Entry` present
    - _Requirements: 1.1, 1.7, 2.2, 6.5_

- [ ] 2. Store layer
  - [ ] 2.1 Update `src/lib/server/store/projects.ts`
    - `toProject`: read `billable` off the row
    - `createProject(tx, name, billable)`: accept and store the flag
    - `updateProject`: accept `billable` in its patch object alongside the existing
      `name`/`archived`/`colorIndex` fields, with the same empty-patch no-op handling
    - _Requirements: 1.2, 1.3, 1.4, 5.5_

  - [ ] 2.2 Update `src/lib/server/store/activities.ts` for a nullable project
    - `hydrate()`: collect only non-null `projectId` values before the
      `inArray(projects.id, projectIds)` lookup; a row whose `projectId` is null maps
      to `project = null` directly, never through the existing "project not found for
      entry" throw, which stays reserved for a real integrity violation
    - `toEntry()`: accept `project: … | null`; derive `category` (`relax` when
      `project === null`, else `paid`/`unpaid` from `project.billable`); set
      `projectName`/`colorIndex` to `null` when `project === null`, never wrapping a
      leisure row into a `Palette_Slot`
    - Add `mostRecentWorkEntry(tx)`: same query and ordering as `mostRecentEntry`,
      filtered to `project_id IS NOT NULL`
    - `coveredIntervals`, `segmentsOverlapping`, `entriesOverlapping`,
      `listEntriesOverlapping`, `orphanedEntriesOverlapping` keep seeing **both**
      kinds — they answer "does this instant already belong to something" and a
      person cannot work and rest at once. `entriesBlockingProject` and
      `entryIdsForProject` already filter `project_id = <id>`, which excludes NULLs
      by construction. Verify each still compiles and behaves without modification
    - _Requirements: 1.5, 1.6, 2.2, 3.2, 4.7, 5.1, 5.2, 5.3, 5.4, 6.5, 6.6_

  - [ ] 2.3 Filter `entriesAffectedBy` to `Work_Entry` rows
    - Add `project_id IS NOT NULL` to **both** branches of `entriesAffectedBy` in
      `src/lib/server/store/activities.ts` — the segment-overlap select and the
      requested-interval select
    - This is the one query in the file that filters on kind. It is the sole input to
      `reclipAffected`, which deletes an entry's segments and re-clips them against
      real `Tracked_Time`; without the filter, a `Work_Session` created near a
      `Leisure_Entry` silently deletes the part of it outside the session
    - `src/lib/server/domain/reclip.ts` itself is **not** modified — only its port
    - _Requirements: 3.11, 4.8_

  - [ ] 2.4 Write unit tests for category derivation
    - `tests/lib/server/store/activities.test.ts`: `toEntry` with a billable project
      → `paid`; with a non-billable project → `unpaid`; with `project: null` →
      `relax`, and `projectId`/`projectName`/`colorIndex` all `null`
    - **Property 1: Category is a pure function of stored state** — the derived
      category always agrees with a fresh computation from `projectId` and the
      project's current `billable`, including after the flag is flipped
    - **Validates: Requirements 1.5, 1.6, 5.2**

  - [ ] 2.5 Write integration tests for `store/projects.ts` and `store/activities.ts`
    - `tests/lib/server/store/projects.test.ts`: create defaults `billable` to `true`;
      create/patch with an explicit value; patch leaves it unchanged when absent;
      renaming/archiving/recolouring never changes it
    - `tests/lib/server/store/activities.test.ts`: create a `Leisure_Entry`
      (`projectId: null`) and read it back hydrated with `category: 'relax'` and
      `projectName`/`colorIndex` both `null`; `mostRecentWorkEntry` skips a more
      recent `Leisure_Entry` and returns the latest `Work_Entry`, and returns `null`
      when only `Leisure_Entry` rows exist
    - _Requirements: 1.1, 1.2, 1.4, 4.7, 5.1, 5.2, 5.3, 6.6_

  - [ ] 2.6 Update `src/lib/server/store/aggregates.ts`
    - Split `fetchSegments` into `fetchWorkSegments` (adds `AND
      activity_entries.project_id IS NOT NULL` to the existing join — feeds
      `Covered_Time`/`Uncovered_Time`/`byProject`) and `fetchLeisureSegments`
      (`WHERE activity_entries.project_id IS NULL`, no project join — feeds
      `Leisure_Time`/`relaxSeconds` only)
    - Narrow `fetchWorkSegments`'s returned `projectId` to `string` explicitly:
      Drizzle infers `string | null` off the now-nullable column, which the filter
      makes impossible but the type system cannot see
    - `daySummaries()`: source `coveredInDay`/`uncoveredInDay`/`byProject` from
      `fetchWorkSegments` exactly as today (now provably free of a null-`projectId`
      key); add `paidSeconds`/`unpaidSeconds` by splitting `byProject` on each
      project's `billable`; add `relaxSeconds` from `fetchLeisureSegments`, clamped
      and summed the same way `coveredSeconds` is
    - `dayIntervals()`: add a fourth parallel array `leisure: Interval[][]`, built
      from `fetchLeisureSegments` and clamped per day exactly as `tracked`/`uncovered`
    - `coverageForRange()`: switch its internal segment fetch to `fetchWorkSegments`,
      so `/api/coverage`'s `covered`/`uncovered`/totals keep meaning `Work_Entry`
      time only
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 2.7 Extend the property harness for leisure
    - Extend `tests/lib/server/store/overlap.property.test.ts`'s generator to also
      produce `Leisure_Entry` rows (random intervals with `projectId: null`,
      independent of any `Work_Session` fixture)
    - **Amend that file's existing Property 22 assertion first**: it currently asserts
      every stored segment lies inside `Tracked_Time`, which a leisure segment is by
      design not. Filter the assertion loop to `Work_Entry` segments. Adding leisure
      rows without this change fails the suite deterministically
    - **Property 2: Mutual exclusivity holds across categories** — no two stored
      `Activity_Segment` rows overlap, `Leisure_Entry` included
    - **Property 3: Covered_Time excludes Leisure_Time** — `covered`/`uncovered`,
      computed with `Leisure_Entry` rows present in the same range, still reconstruct
      exactly the reported `Tracked_Time` and never include a leisure interval
    - **Property 4: The paid/unpaid split is a true partition of Covered_Time** —
      `paidSeconds + unpaidSeconds === coveredSeconds` for every generated day
    - **Validates: Requirements 3.2, 6.1, 6.2**

  - [ ]* 2.8 Write leisure-immunity tests for re-clipping
    - `tests/lib/server/domain/reclip.test.ts` and
      `tests/lib/server/domain/reclip.property.test.ts`: a `Leisure_Entry` overlapping
      a window a `Work_Session` change touches is never returned by
      `entriesAffectedBy` and is never re-clipped
    - **Property 6: A Work_Session change never disturbs a Leisure_Entry** — after any
      sequence of session creates, patches and deletes, every stored `Leisure_Entry`
      and each of its segments is unchanged, and none is left orphaned. The concrete
      regression: leisure 20:00–22:00 logged with no timer running, then a session
      19:00–20:30 added
    - **Validates: Requirements 3.11, 4.8**

  - [ ]* 2.9 Extend `tests/lib/server/store/aggregates.test.ts`
    - Task 2.6 is the largest store change in this specification — `fetchSegments`
      split in two, three new figures, a fourth interval array — and this is its
      integration suite
    - A fixture day mixing a billable `Project`'s `Work_Entry`, a non-billable one's,
      and a `Leisure_Entry` with no `Work_Session` overlapping it at all: assert
      `coveredSeconds`/`uncoveredSeconds` are unchanged by the leisure rows,
      `paidSeconds`/`unpaidSeconds`/`relaxSeconds` each match hand computation, and
      `dayIntervals`'s new `leisure` array holds exactly the leisure interval
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 3. Checkpoint — data layer proven against a real database
  - Start PostgreSQL, run `./scripts/migrate.sh`, then `bun run test
    tests/lib/server/store tests/lib/server/domain`

- [ ] 4. Service and reconciliation layer
  - [ ] 4.1 Widen the service argument types and normalize `effectiveProjectId`
    - `CreateActivityArgs.projectId` becomes `string | undefined`;
      `PatchActivityArgs.projectId` becomes `string | null | undefined`. The Zod
      schema changes of task 1.4 are not sufficient — these exported types are what
      the routes and form actions call through
    - `createActivity` resolves `effectiveProjectId = args.projectId ?? null`
    - `patchActivity` resolves `effectiveProjectId = args.projectId === undefined ?
      existing.projectId : args.projectId`
    - Every downstream branch added or changed by tasks 4.2–4.5 tests
      `effectiveProjectId === null`, never `args.projectId === undefined` — on the
      PATCH path those two differ, and using `undefined` routes a convert-to-leisure
      request into the `Work_Entry` regime
    - _Requirements: 2.1, 4.1, 4.2_

  - [ ] 4.2 Guard `assertProjectUsable` and implement the `Unrestricted_Window`
    - Call `assertProjectUsable` only when `effectiveProjectId !== null`, at **both**
      call sites: `createActivity` (currently unconditional, so every leisure create
      would 400) and `patchActivity` (currently guarded by `!== undefined`, and
      `null !== undefined` is true, so every convert-to-leisure PATCH would 400)
    - Add `unrestrictedTracked(mode, requested, dayBounds): Interval[]` per the
      design's component 3 signature — `[dayBounds]` in `Duration_Mode`,
      `[requested]` otherwise
    - In `resolveCreateWindow`, in `clipAndRescue`'s `runClip`/`rerunClip` closures,
      and in `patchActivity`'s equivalents: select `sessionsStore.trackedIntervals`
      when `effectiveProjectId !== null` and `unrestrictedTracked` when it is null
    - Compute `openSessionSpan` only when `effectiveProjectId !== null`
    - Verify the consequence rather than coding it: `discarded` and `extend` come back
      empty for a leisure write in every mode, so `untrackedPolicy` is accepted
      without effect
    - _Requirements: 2.1, 2.6, 2.7, 3.1, 3.6, 3.7_

  - [ ] 4.3 Implement the day-start `Placement_Anchor` fallback at both catch sites
    - There are **two** `NoPlacementAnchorError` catches: one in `resolveCreateWindow`
      and one inside `patchActivity` (reached by a PATCH supplying `durationMinutes`).
      Both need the fallback, or a leisure duration PATCH still 409s
    - When `effectiveProjectId === null`, substitute `dayBounds.start` as the anchor
      with `source: 'day-start'` instead of throwing `NO_PLACEMENT_ANCHOR`
    - Thread that source **out of** the catch. Both sites recompute
      `anchorInfo.source` after the `try`/`catch` from `daySegments.length > 0`, so
      substituting only the anchor value leaves `'day-start'` overwritten a few lines
      later
    - Widen the **local** `AnchorInfo` alias (`services/activities.ts:175`, currently
      `source: 'explicit' | 'last-segment' | 'first-session'`) with `'day-start'`
      alongside `ActivityResponse.anchor` (task 1.5) — assigning the new source to the
      un-widened alias does not compile
    - Do **not** modify `resolveAnchor` in `domain/clipping.ts` — this is service-layer
      only
    - Confirm, without adding new code for it, that `Open_Mode` leisure on a past day
      with no `Work_Session` still resolves to an empty interval and is rejected with
      the existing `NOTHING_TO_LOG` (`empty-interval`) — the deliberate behaviour of
      Requirement 3.12
    - _Requirements: 3.8, 3.10, 3.12_

  - [ ] 4.4 Implement category transitions in `patchActivity`
    - Add `crossesProjectBoundary(existing, args): boolean` per the design's
      component 3 signature — false when `projectId` is absent, false for a
      `Project`-to-`Project` change, true only across the null/non-null boundary
    - When `selectPatchMode` would otherwise return `'meta'` but
      `crossesProjectBoundary` is true, take the interval-re-clipping path instead:
      re-run `clip()` in `explicit` mode over the entry's own stored
      `requestedStartedAt`/`requestedEndedAt`, with `tracked` resolved by the **new**
      `effectiveProjectId`
    - On zero resulting segments, return `NOTHING_TO_LOG` and perform no write at all
      — verify no partial state (segments deleted, `projectId` not yet set) is ever
      committed
    - On success, update both `projectId` and the segments in the same transaction
    - Leave a PATCH changing only the description, or `projectId` between two non-null
      values, on the existing meta-only/interval-only paths
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 4.5 Thread `effectiveProjectId` into the entry writes and the idempotency hash
    - Every `createEntry`/`updateEntryRequested` call site passes
      `projectId: effectiveProjectId` rather than assuming a value is present
    - `canonicalRequestHash` needs no change — it iterates keys generically and
      `JSON.stringify` drops `undefined` while keeping `null`, so the three states
      already hash distinctly. Pass `projectId: effectiveProjectId` into it anyway, so
      the canonical form is deterministic rather than presence-dependent
    - `computePreviewToken` needs no change: it fingerprints only session and segment
      ids and times, so a leisure `Dry_Run` is already covered and a `billable` flip
      invalidates nothing. Confirm, do not modify
    - _Requirements: 2.1, 2.2_

  - [ ]* 4.6 Write unit tests for the service-layer branches
    - `tests/lib/server/services/activities.test.ts`: `unrestrictedTracked` for all
      three modes; the day-start anchor fallback at both catch sites, firing only when
      `effectiveProjectId` is null and the day holds neither a segment nor a session;
      `crossesProjectBoundary` for every combination of (existing null/non-null) ×
      (incoming absent/null/uuid)
    - _Requirements: 3.1, 3.8, 4.3_

  - [ ] 4.7 Update `src/lib/server/services/projects.ts`
    - `createProject`/`patchProject`: thread `billable` through to the store calls of
      task 2.1
    - _Requirements: 1.2, 1.3_

  - [ ] 4.8 Update `Quick_Log` and `recentEntry` resolution
    - Three files resolve the "most recent entry" this feature changes, not one:
      `src/routes/api/days/[date]/+server.ts`, `src/routes/+page.server.ts`, and
      `src/routes/day/[date]/+page.server.ts`. All three switch from `mostRecentEntry`
      to `mostRecentWorkEntry` (task 2.2), filtering the in-memory day list to
      `projectId !== null` before taking the last one
    - The exclusion governs the **`Project` resolution only**. The `Quick_Log`
      interval's own `Placement_Anchor` keeps consulting `coveredIntervals` unfiltered,
      so the offered interval never overlaps a `Leisure_Entry` and then fails
      `ACTIVITY_OVERLAP` on submission
    - The same resolution supplies `ActivityDialog`'s `recentEntry` prop, which gains
      the resolved `category` (task 10.1) — reuse the lookup rather than adding a
      second query
    - _Requirements: 6.6, 10.7_

  - [ ] 4.9 Update the REST API routes
    - `src/routes/api/activities/+server.ts` and `[id]/+server.ts`: pass
      `body.projectId` through unchanged in shape (`string | undefined` on create,
      `string | null | undefined` on patch) — confirm no route-level code assumes it
      is always a string
    - `src/routes/api/projects/+server.ts` and `[id]/+server.ts`: pass `billable`
      through from the updated schemas
    - The activities routes keep validating against `patchActivitySchema`, which does
      **not** carry `clearProject` — so a JSON body supplying it is rejected by that
      schema's own `.strict()` rather than accepted and dropped (Requirement 4.10).
      `projectId: null` stays the one JSON encoding of the conversion
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 4.1, 4.2, 4.10_

  - [ ]* 4.10 Write API tests
    - `tests/api/activities.test.ts`: create a `Leisure_Entry` in each of
      `Explicit_Mode`/`Duration_Mode`/`Open_Mode`, including one on a day with no
      `Work_Session` anywhere (exercises the day-start anchor); an empty description
      accepted; the shared description-length, `FUTURE_TOLERANCE_SECONDS`,
      `AMBIGUOUS_MODE` and `INVALID_INTERVAL` validations rejecting a leisure request
      exactly as a work one; a sub-`MIN_INTERVAL_SECONDS` result discarded as a
      sliver; a `Duration_Mode` leisure entry bounded at the `Target_Day` end;
      `VALIDATION_ERROR` and `PROJECT_ARCHIVED` when a supplied `projectId` is unknown
      or archived; `ACTIVITY_OVERLAP` between a `Leisure_Entry` and a `Work_Entry`;
      `NOTHING_TO_LOG` for `Open_Mode` leisure on a past day with no session; deleting
      a `Leisure_Entry`; listing one alongside `Work_Entry` records in the documented
      order; PATCH converting a `Work_Entry` to a `Leisure_Entry` and back; and
      description-only and `Project`-to-`Project` PATCHes staying meta-only; and a
      JSON PATCH supplying `clearProject` rejected with `VALIDATION_ERROR` rather than
      silently accepted, `projectId: null` remaining the one JSON encoding
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 3.3, 3.4, 3.5, 3.8, 3.9, 3.12, 4.1, 4.2, 4.5, 4.6, 4.7, 4.10_

  - [ ]* 4.11 Write API tests for projects and day figures
    - `tests/api/projects.test.ts`: create/patch `billable`, its default, and that
      rename/archive/recolour leave it untouched
    - `tests/api/days.test.ts`: `paidSeconds`/`unpaidSeconds`/`relaxSeconds` on both
      `/api/days/{date}` and `/api/days`; the `leisure` interval list under
      `include=intervals`
    - `tests/api/coverage.test.ts`: `/api/coverage`'s totals and intervals are
      unchanged by the presence of `Leisure_Entry` rows in the same range
    - _Requirements: 1.2, 1.3, 1.4, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 4.12 Write the category-transition atomicity property test
    - **Property 5: A category transition is all-or-nothing** — belongs in
      `tests/lib/server/store/atomicity.property.test.ts`, which already exercises
      all-or-nothing write behaviour: a transition rejected with `NOTHING_TO_LOG`
      leaves `projectId`, the requested interval and every segment exactly as before
    - **Validates: Requirements 4.3, 4.4**

- [ ] 5. Form actions — the path the interface actually writes through
  - [ ] 5.1 Update `src/lib/server/services/activity-form-actions.ts`
    - `createActivityAction`: pass `form.data.projectId` (now `string | undefined`)
      straight through — absent creates a `Leisure_Entry`, exactly as over JSON
    - `patchActivityAction`: validate against `patchActivityFormSchema` (task 1.4),
      not `patchActivitySchema`, and translate its `clearProject` field into
      `projectId: null` before calling `patchActivityService`; otherwise pass
      `form.data.projectId` through. `clearProject` true together with a `projectId`
      is a `VALIDATION_ERROR` — the two name contradictory outcomes
    - This file is the only write path `ActivityDialog` uses; the REST routes of task
      4.9 do not cover it
    - _Requirements: 4.1, 4.2, 4.9_

  - [ ] 5.2 Add the `billable`/`unbillable` actions to `src/routes/projects/+page.server.ts`
    - Mirror the existing `archive`/`unarchive` pair exactly — one named action per
      operation, each validated by a row-scoped schema built from `projectIdSchema`,
      each calling `patchProject` with the corresponding value
    - Do **not** introduce a general `patchProject` action; the granular convention is
      the established one in this file
    - Thread the new `billable` field from `createProjectSchema` through the existing
      `create` action
    - _Requirements: 1.2, 1.3, 9.4_

- [ ] 6. Checkpoint — backend, API and form actions proven end to end
  - Run `bun run check && bun run test` with PostgreSQL running

- [ ] 7. Internationalization
  - [ ] 7.1 Add message keys to `messages/en.json` and `messages/cs.json`
    - Category labels (`paid`/`unpaid`/`relax`) for the `Activity_Dialog`'s segmented
      control and wherever a `Category` is displayed as text
    - The `Billable` toggle's two states and its row label, following this file's
      existing `projects_*` convention (`projects_archive`, `projects_unarchive`, …) —
      so `projects_billable`/`projects_unbillable`, never `project_billable`
    - `Leisure_Block` and `Leisure_Time` copy: the timeline block's label, the
      statistics heading, the day-summary label, and the leisure fallback label used
      wherever a null `projectName` is rendered (task 9.1)
    - Both files must stay in exact key parity, and no literal string introduced by
      this specification may appear outside them —
      `tests/lib/i18n.test.ts` enforces both, including a no-literal-string heuristic
      with an allowlist that may need extending
    - _Requirements: 12.1, 12.2_

- [ ] 8. Palette addition
  - [ ] 8.1 Update `src/lib/viz/palette.ts`
    - Add `LEISURE_SLOT`, `LEISURE_SLOT_CLASS` (`'pj-relax'`) and `leisureColor()` per
      the design's component 9 — a ninth, reserved slot outside the `PALETTE_SIZE`-8
      wraparound, so `projectSlotClass` can never return it
    - The values are **decided**, not placeholders: `{ dark: '#7C8899', light:
      '#5F6B7A' }`. Do not substitute a "nicer" hue — the design's component 9
      records why leisure is deliberately low-chroma (0.028–0.029 against the project
      hues' 0.137–0.150) and therefore not a ninth categorical colour. Changing it to
      a saturated hue silently breaks that reasoning
    - _Requirements: 8.2_

  - [ ] 8.2 Update `scripts/generate-palette-and-heights.ts`
    - `buildPaletteCss` loops `for (i = 0; i < PALETTE_SIZE; i++)` and emits a header
      comment reading "Eight classes, `.pj-0` … `.pj-7`" — both the loop (to append
      the reserved slot after the eight) and that comment must change
    - Regenerate `src/lib/theme/palette.css` (`bun run generate:css`) and commit the
      result; `bun run check` fails if a fresh generation would differ from what is
      committed
    - _Requirements: 8.2_

  - [ ]* 8.3 Extend `tests/lib/viz/palette.test.ts`
    - This suite pins the palette literals and asserts no slot collides with the
      destructive token; `LEISURE_SLOT` needs the same separation assertion, plus one
      that `projectSlotClass` never returns `LEISURE_SLOT_CLASS` for any `colorIndex`
    - _Requirements: 8.2_

- [ ] 9. Nullable-project consumers
  - [ ] 9.1 Narrow every `projectName`/`colorIndex` consumer
    - `projectSlotClass(colorIndex: number)` is non-nullable, so every consumer of the
      now-nullable fields must narrow explicitly. Work through each per the design's
      component 7 table: `DayGauge.svelte` (receives `Work_Entry` records only — narrow
      its local `InnerPiece` type), `ChangePreview.svelte` (its draft-entry path needs
      `projectName ?? ''` and `LEISURE_SLOT_CLASS`; the `ReclipOutcome` path stays
      non-null), `SegmentBlock.svelte` (draws `Work_Entry` segments only after task
      9.3), `DaySummaryPanels.svelte` (renders across all entries — falls back to
      `LEISURE_SLOT_CLASS` and the translated leisure label)
    - `src/modules/day/dry-run.ts` holds the only two client-side `ActivityEntry`
      constructions, both upstream of `ChangePreview.svelte`: `reviveEntry` must carry
      `category` through from the wire shape and pass `projectName`/`colorIndex` as
      nullable, and the `EMPTY_ACTIVITY_ENTRY` literal must gain a `category` field or
      it stops compiling
    - `activityOverlapError` in `src/lib/server/services/activities.ts` puts
      `projectName`/`colorIndex` into `ACTIVITY_OVERLAP` details, and a `Leisure_Entry`
      is a legitimate conflict source — widen the detail shape to nullable and give
      whatever renders it the leisure label
    - `bun run check` passing is the completion condition for this task
    - _Requirements: 5.1, 5.3, 3.3_

  - [ ] 9.2 Filter `Leisure_Entry` out of the Day_Gauge's inputs
    - In `src/routes/+page.svelte` and `src/routes/day/[date]/+page.svelte`, filter
      `entries` to `category !== 'relax'` before passing them to `DayGauge`
    - `DayGauge.svelte` and `ProjectLegend.svelte` are not otherwise modified;
      `byProject` already excludes leisure by construction (task 2.6), and
      `ProjectLegend` consumes `ProjectTotal`, whose `colorIndex` stays non-null
    - Add the paid/unpaid/relax figures beside the gauge's existing worked/covered/
      uncovered readouts — a single strip, not folded into them — per
      `.design/artboards/TimerCategories.dc.html`. The gauge and its `Project_Legend`
      are not otherwise touched
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 9.3 Extend `src/modules/day/components/timeline-geometry.ts`
    - Add `LeisureBlockUnit` and `DayLayout.leisureBlocks` per the design's component
      8. `blocks` and `breaks` keep their existing inline shapes unchanged
    - **Change the early return**: `layOutDay` currently returns `{ blocks: [],
      breaks: [] }` whenever `sessions.length === 0`. The guard becomes "no sessions
      **and** no leisure segments", or a day of leisure with the timer never started
      lays out nothing
    - **Skip leisure in the work-segment loop**: the existing loop pushes every
      entry's segments through `ownerBlockIndex`, which assumes each was clipped
      server-side to the session it overlaps — false for leisure. Left alone, leisure
      segments are assigned to an arbitrary block, dropped by the following
      `intersect`, and still counted into `totalSeconds`, skewing every work segment's
      height. Skip entries whose `category === 'relax'` there
    - **Share the height budget**: a `Leisure_Block`'s duration counts into
      `totalSeconds` and its height comes out of `flex = availablePx - fixed`, floored
      at `MIN_BLOCK_PX` exactly as a `Segment_Block` — never sized from its own
      duration independently, which would break `002-worklog-ui`'s Property 2
    - `layOutDay` populates `leisureBlocks` from every `Leisure_Entry` segment
      overlapping the displayed day, in chronological order
    - _Requirements: 8.1, 8.3, 8.5_

  - [ ] 9.4 Create `src/modules/day/components/LeisureBlock.svelte`
    - Mirror `SegmentBlock.svelte`'s self-contained pressable-block shape (title,
      times, description), tinted with `LEISURE_SLOT_CLASS` instead of a project
      colour
    - Call `onActivityActivate(entry.id)` on click/Enter/Space — the same callback
      `Segment_Block` already exposes — opening the `Activity_Dialog` with `category`
      pre-set to `relax` (task 10.1 seeds this from `entry.category`)
    - _Requirements: 8.2, 8.4_

  - [ ] 9.5 Update `src/modules/day/components/DayTimeline.svelte`
    - Merge `layout.blocks`, `layout.breaks` and `layout.leisureBlocks` into one
      chronological render list by each unit's start instant, replacing today's single
      iteration over `blocks` with a break looked up by block index
    - The component currently does not call `layOutDay` at all when there are no
      sessions, rendering its empty state instead — that condition becomes "no blocks
      **and** no leisure blocks" to match task 9.3
    - Keep keyboard focus order chronological across `Work_Block` and `Leisure_Block`
      units alike
    - _Requirements: 8.1, 8.5, 8.6_

  - [ ]* 9.6 Write component and E2E tests for the timeline
    - `tests/modules/day/components/timeline-geometry.property.test.ts`: its existing
      budget property (total rendered height never exceeds the available height) must
      still hold with `Leisure_Block` units in the generated layouts
    - **Property 7: the timeline height budget still holds** — `002-worklog-ui`'s
      Property 2, re-verified with leisure units present
    - **Validates: Requirements 8.3**

  - [ ]* 9.7 Write remaining timeline component tests
    - `tests/modules/day/components/day-timeline.test.ts`: `layOutDay` places a
      `Leisure_Block` at its correct chronological position relative to surrounding
      blocks and breaks; a day with leisure and no `Work_Session` renders blocks
      rather than the empty state; height is floored at `MIN_BLOCK_PX`
    - Adding a required `category` field breaks every existing `ActivityEntry` test
      factory. Update each: `tests/modules/day/components/timeline-geometry.test.ts`
      (the non-property variant, distinct from the one in task 9.6),
      `change-preview.test.ts`, `activity-dialog.test.ts`, and
      `tests/modules/timer/components/day-gauge.test.ts` together with its
      `DayGaugeHost.svelte` fixture
    - Match `.design/artboards/DayCategories.dc.html`: a `Leisure_Block` carries no
      session rail, sits between `Work_Block` groups chronologically, and names its
      category in text beside the title
    - `src/modules/day/components/SegmentBlock.svelte` gains the same text category
      tag beside the `Project` name (`placeno`/`neplaceno`), which the artboard draws
      on every work block — without it a `Work_Entry`'s category rides on colour
      alone and Requirement 8.7 fails
    - _Requirements: 8.1, 8.3, 8.5, 8.6, 8.7, 8.8_

- [ ] 10. Activity Dialog — category control
  - [ ] 10.1 Update `src/modules/day/components/ActivityDialog.svelte`
    - Add `category: Category` to `ActivityFormValues`, rendered as a segmented
      control above the existing mode control, reusing its `role="radiogroup"` and
      arrow-key pattern
    - Compute `filteredProjects` per the design's component 11; hide the
      `Project_Picker` entirely when `category === 'relax'` rather than rendering it
      empty
    - Relax `activityFormSchema`'s **base** constraint, not only its `superRefine`:
      `projectId` is `z.string().min(1)` today, which rejects `''` before any refine
      runs. Require a non-empty `projectId` in the `superRefine` only when
      `category !== 'relax'`
    - Make `canPreview`'s `$form.projectId === ''` guard conditional on
      `category !== 'relax'`. A relax draft always satisfies it today, so the
      `Change_Preview` would never render — and since the write form only emits the
      `previewToken` when a preview exists, the leisure write would carry none
    - Gate the hidden wire form's `projectId` input on `category !== 'relax'` for a
      create, and post `clearProject` for a patch converting to leisure. Changing only
      `buildCreateInput`/`buildPatchInput` is not enough — those feed the `Dry_Run`
      fetch, not the real submission
    - `initialValues()` seeds `projectId` from the now-nullable `entry.projectId` —
      `?? ''`
    - Seed `category` from `entry.category` when opening in edit mode
    - Reset `$form.projectId` to `''` when a category change leaves it outside
      `filteredProjects`
    - Match `.design/artboards/AddTaskCategories.dc.html`: the category control sits
      above the mode control, reuses its segmented shape, and the project field's
      label names the active filter
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 10.9_

  - [ ] 10.2 Extend the `recentEntry` prop with its category
    - `recentEntry` carries only `{ projectId, description }` today, so the dialog
      cannot derive a default category from it — and looking the project up in
      `projects` fails when it is archived and absent from that list. Add the resolved
      `category`, supplied by task 4.8's `mostRecentWorkEntry` resolution
    - _Requirements: 10.7_

  - [ ]* 10.3 Write component tests
    - Selecting each category filters or hides the `Project_Picker`; switching
      category clears an incompatible selection; editing a `Leisure_Entry` opens with
      `category: 'relax'` and no project field; a relax draft produces a
      `Change_Preview` and carries its `previewToken` into the submission; a create
      submission for a relax draft posts no `projectId` field at all
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8_

- [ ] 11. Projects page — Billable toggle
  - [ ] 11.1 Update `src/modules/projects/components/ProjectRow.svelte`
    - Add a two-way control posting to the `?/billable` and `?/unbillable` actions of
      task 5.2, following the existing archive-toggle hidden-`use:enhance`-form pattern
    - Add a plain text label naming the current state beside it (never colour alone)
    - _Requirements: 9.1, 9.3_

  - [ ] 11.2 Update `src/modules/projects/pages/ProjectsPage.svelte`
    - Add the same two-way control to the creation form, defaulting to paid
    - _Requirements: 9.2_

  - [ ]* 11.3 Write component tests
    - Toggling posts to the expected action; the label reflects the current state;
      creation defaults to paid
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 12. Statistics — category breakdown
  - [ ] 12.1 Update `src/modules/stats/aggregate.ts`
    - `ProjectRangeTotal` gains `billable: boolean` — `ProjectBreakdown` consumes this
      type, not the server's `ProjectTotal`, so the flag must be threaded into it
    - `foldProjectTotals` groups by `billable` **first** and applies
      `TOP_PROJECT_COUNT` **within each group**, returning `{ paid, unpaid }`. Today
      it folds one flat list, so a single "Other" row would mix paid and unpaid
      projects
    - Thread `paidSeconds`/`unpaidSeconds`/`relaxSeconds` through to what
      `StatsPage.svelte` consumes
    - `foldProjectTotals`' only call site is `src/routes/stats/+page.server.ts`
      (`projectBreakdown: foldProjectTotals(range.days)`), forwarded to
      `ProjectBreakdown` by `src/routes/stats/+page.svelte` — update both for the new
      `{ paid, unpaid }` return shape
    - _Requirements: 11.1, 11.2_

  - [ ] 12.2 Update `src/modules/stats/components/ProjectBreakdown.svelte`
    - Render the two groups under a paid and an unpaid heading, each sorted descending
      exactly as today, each with its own "Other" row
    - Add the range's total `Leisure_Time` beneath both, separated from them and never
      one of the bars
    - Present the split as text as well as colour
    - _Requirements: 11.2, 11.3, 11.5_

  - [ ] 12.3 Update `src/modules/stats/components/KpiRow.svelte`
    - Add `paidSeconds`/`unpaidSeconds`/`relaxSeconds` as individually visible
      figures, whether as additional entries or folded into the existing four
    - _Requirements: 11.1, 11.5_

  - [ ] 12.4 Update `DayRhythm.svelte` and `rhythm-geometry.ts`
    - Draw the day response's new `leisure: Interval[]` list in `LEISURE_SLOT_CLASS`,
      positioned exactly as the existing covered/uncovered draws are
    - _Requirements: 11.4_

  - [ ]* 12.5 Write component tests
    - `tests/modules/stats/components/stats.test.ts` passes `projectBreakdown` as a
      flat array today and must move to the two-group shape of task 12.1
    - `ProjectBreakdown` groups correctly, folds top-N within each group, and shows
      the leisure total; `KpiRow` shows all three new figures as text; `DayRhythm`
      draws a leisure interval in the correct slot and position
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 12.6 Include the `leisure` interval array in the two range readers
    - `src/routes/api/days/+server.ts` and `src/routes/stats/+page.server.ts` both
      destructure `dayIntervals`'s arrays **by name** (`const { tracked, covered,
      uncovered } = ...`) and assign them per day. Add `leisure` in both, or
      Requirements 6.4 and 11.4 are silently unmet — `DaySummary.leisure` is optional,
      so omitting it is not a compile error and nothing fails until someone notices
      the rhythm strip has no leisure on it
    - _Requirements: 6.4, 11.4_

- [ ] 13. Documentation and end-to-end coverage
  - [ ] 13.1 Update `DOCS.md`
    - The API section documents `POST /api/projects` and every activity example with a
      mandatory `projectId` — update them for the optional/nullable field, the new
      `billable` field, the three new day figures and the `leisure` interval list
    - The Migrations section gains `002_leisure_time_categories.sql`
    - Known Limitations gains the `Open_Mode`-leisure-on-a-past-day dead end
      (Requirement 3.12) and the deliberate absence of a leisure filter on
      `GET /api/activities?project_id=`
    - The User Interface section describes `/day/[date]` as "every `Work_Session`/
      `Activity_Segment` for one day", which is now incomplete, and its "Day timeline
      geometry" paragraph lists the generated layout without `Leisure_Block` or the
      `pj-relax` class — update both
    - _Requirements: 3.12, 6.2, 6.3, 6.4, 8.1_

  - [ ]* 13.2 Extend the E2E suite
    - `tests/e2e/fixtures.ts`'s `createActivity(page, projectId, …)` helper requires a
      `projectId` — give it a leisure-capable variant **first**; every scenario below
      depends on it
    - `tests/e2e/day.spec.ts`: log a `Leisure_Entry` on a day with no `Work_Session`
      at all, confirm it renders on the `Day_Timeline` and the `Day_Gauge` is
      unaffected; then add a `Work_Session` overlapping it and confirm the leisure
      entry is unchanged
    - `tests/e2e/conflict.spec.ts`: a `Leisure_Entry` overlapping a `Work_Entry`'s
      segment is rejected with the conflict named
    - `tests/e2e/a11y.spec.ts`: the axe sweep covers the day page with a
      `Leisure_Block` present and the projects page with the new toggle
    - `tests/e2e/a11y-interaction.spec.ts`: its keyboard walk accounts for the
      `Leisure_Block` now in the tab order
    - _Requirements: 3.11, 7.1, 8.1, 8.5, 8.6, 9.1_

- [ ] 14. Checkpoint — full stack and E2E
  - Run `bun run test:all`; manually verify in a browser: creating a leisure entry
    with the timer never started that day, converting it to a paid `Work_Entry` and
    back, adding a session across a logged leisure interval and confirming the leisure
    entry survives untouched, and that the Day_Gauge is visually unchanged by leisure
    logging

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": [
        "1.1",
        "1.2",
        "1.3",
        "1.4",
        "1.5"
      ]
    },
    {
      "id": 1,
      "tasks": [
        "1.6",
        "2.1",
        "2.2",
        "2.3",
        "2.6",
        "7.1",
        "8.1"
      ]
    },
    {
      "id": 2,
      "tasks": [
        "2.4",
        "2.5",
        "2.7",
        "2.8",
        "8.2",
        "2.9"
      ]
    },
    {
      "id": 3,
      "tasks": [
        "4.1",
        "8.3"
      ]
    },
    {
      "id": 4,
      "tasks": [
        "4.2",
        "4.3",
        "4.4",
        "4.5",
        "4.7"
      ]
    },
    {
      "id": 5,
      "tasks": [
        "4.6",
        "4.8",
        "4.9",
        "5.1",
        "5.2"
      ]
    },
    {
      "id": 6,
      "tasks": [
        "4.10",
        "4.11",
        "4.12",
        "9.1",
        "9.2",
        "9.3"
      ]
    },
    {
      "id": 7,
      "tasks": [
        "9.4",
        "10.1",
        "11.1",
        "11.2",
        "12.1",
        "12.6"
      ]
    },
    {
      "id": 8,
      "tasks": [
        "9.5",
        "10.2",
        "11.3",
        "12.2",
        "12.3",
        "12.4"
      ]
    },
    {
      "id": 9,
      "tasks": [
        "9.6",
        "9.7",
        "10.3",
        "12.5",
        "13.1",
        "13.2"
      ]
    }
  ]
}
```

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster path to a
  working feature, exactly as `001-worklog-domain-api`/`002-worklog-ui` use the marker
  — skipping them means shipping without the property/E2E safety net, not without the
  feature itself. Task 2.8 is the one exception worth reconsidering before skipping:
  it is the only automated guard on the data-loss regression task 2.3 fixes.
- `bun run test` always runs through `scripts/run-vitest.sh`; `dev`/`build`/`preview`
  always run through `scripts/run-vite.sh` — see `DOCS.md`'s Troubleshooting section,
  unchanged by this specification.
- Nothing in this plan touches `src/db/schema/work-sessions.ts`,
  `src/lib/server/domain/clipping.ts`, `src/lib/server/domain/reclip.ts`,
  `src/lib/server/store/work-sessions.ts`, `src/lib/server/store/tx.ts`, or any
  `/api/sessions/*` route. If a task appears to require touching one of them, stop and
  re-read the design document's Overview — that is very likely a sign the
  `Unrestricted_Window` is being implemented as a change to `Tracked_Time` itself
  rather than as a value fed into the existing, unmodified `clip()` call. Note the
  distinction task 2.3 rests on: `domain/reclip.ts` is unchanged, but its
  `entriesAffectedBy` **port** in `store/activities.ts` is not — that store file is
  freely modifiable.
- Task 2.3 fixes a silent data-loss path, not a cosmetic one: without its filter, any
  `Work_Session` written near a logged leisure interval deletes part of that interval.
  It has no visible symptom until a user notices missing history.
- Task 4.1's `effectiveProjectId` normalization is a prerequisite for tasks 4.2–4.5,
  not a style preference: `undefined` and `null` mean different things on the two
  write paths, and branching on `args.projectId !== undefined` routes every
  convert-to-leisure PATCH into the `Work_Entry` regime.
- `LEISURE_SLOT`'s two hex values (task 8.1) and the category control's appearance are
  both **decided**, not open. The colour is argued from measurement in the design's
  component 9 — low chroma is the encoding, not a stand-in for a hue nobody picked
  yet. The category control is the project's existing three-way segmented control,
  already drawn in `.design/DESIGN.md` (the theme picker and the Add-task mode
  control) and implemented as `activity-dialog__seg-group` with `role="radiogroup"`
  and arrow-key handling; Paid/Unpaid/Relax is a fourth instance of the same shape,
  so no new component is required for it. Three artboards —
  `.design/artboards/{TimerCategories,DayCategories,AddTaskCategories}.dc.html` — are
  drawn, rendered and binding (Requirements 7.4, 8.8, 10.9); `DayCategories` also
  settles how a block names its category, with a text tag on work blocks and leisure
  blocks alike. What is still undrawn is the light-theme and mobile variant of those
  three screens, and the `Billable` toggle's exact placement in a project row — raise
  those rather than inventing them.
- Task 4.4's category-transition re-clip is the one genuinely new piece of
  reconciliation *logic* in this specification — everything else is a new field, a new
  query filter, or a new value fed into existing, unmodified functions. Give it the
  most scrutiny and the most test coverage (tasks 4.6 and 4.10).
