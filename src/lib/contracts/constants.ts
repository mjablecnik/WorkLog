/**
 * Pure data, declared here because the request schemas that live beside them
 * (`schemas.ts`) need their values and `lib/contracts` may not import from
 * `lib/server`. `src/lib/server/core/config.ts` imports and re-exports these three
 * rather than declaring a second copy — see the "Fixed Constants" section of the
 * design document.
 */

/** Any queried range, in Logical_Day values — Requirements 2.4, 7.5, 8.10, 9.6. */
export const MAX_RANGE_DAYS = 366;

/** A range that may also carry per-day intervals — Requirement 8.18. */
export const MAX_INTERVAL_RANGE_DAYS = 62;

/** Activity_Entry rows returned per page — Requirement 7.13. */
export const ACTIVITY_PAGE_SIZE = 200;
