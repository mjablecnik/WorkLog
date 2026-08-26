-- Adds Project.billable and makes activity_entries.project_id nullable, so an
-- Activity_Entry can be a Leisure_Entry (no Project at all), reconciled against the
-- Unrestricted_Window instead of Tracked_Time. See
-- .kiro/specs/003-worklog-time-categories/design.md, component 1.

-- The DEFAULT true is itself the backfill required by Requirement 1.7 — every
-- pre-existing Project row acquires billable = true with no separate UPDATE.
ALTER TABLE projects
    ADD COLUMN billable boolean NOT NULL DEFAULT true;

-- NULL means Leisure_Entry. ON DELETE RESTRICT is unaffected: a foreign key
-- constraint is never evaluated against a NULL value, so a Leisure_Entry never
-- blocks or is affected by a Project deletion (Requirement 6.5).
ALTER TABLE activity_entries
    ALTER COLUMN project_id DROP NOT NULL;

-- No other statement. activity_entries_mode_fields and every other existing
-- constraint from 001_init.sql reference neither column being touched here, so they
-- apply unchanged to both Work_Entry and Leisure_Entry rows. No new index: at this
-- application's single-user scale, the existing activity_entries_project_id index
-- degrades gracefully with NULLs and nothing queries "WHERE project_id IS NULL" on a
-- hot path.
