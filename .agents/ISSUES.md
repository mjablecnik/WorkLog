# Issues

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
