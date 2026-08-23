CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Every primary key is a UUID v7 generated in the application (`Bun.randomUUIDv7()`),
-- never a v4 and never `gen_random_uuid()`. v7 is time-ordered, so inserts land at the
-- right edge of every index instead of scattering across it, and `id` breaks ties in the
-- listing order in the same direction as `created_at`.

CREATE TABLE projects (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    -- Stable slot in the eight-colour categorical palette, so adding a project
    -- never recolours the history. The palette is fixed in 002-worklog-ui.
    color_index smallint NOT NULL DEFAULT 0,
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),   -- Requirement 13.7
    CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT projects_color_index_range CHECK (color_index BETWEEN 0 AND 7)
);

-- Case- and whitespace-insensitive uniqueness (Requirement 3.2).
CREATE UNIQUE INDEX projects_name_unique ON projects (lower(btrim(name)));

CREATE TABLE work_sessions (
    id         uuid PRIMARY KEY,
    started_at timestamptz NOT NULL,
    ended_at   timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT work_sessions_interval_valid
        CHECK (ended_at IS NULL OR started_at < ended_at),
    CONSTRAINT work_sessions_no_overlap EXCLUDE USING gist (
        tstzrange(started_at, ended_at) WITH &&
    ) WHERE (ended_at IS NOT NULL)
);

-- At most one Open_Session (Requirement 1.9).
CREATE UNIQUE INDEX work_sessions_one_open
    ON work_sessions ((true)) WHERE ended_at IS NULL;

-- The real query is "sessions overlapping [from, to)", which a plain btree on
-- started_at only half covers. A gist range index matches it, as on segments.
CREATE INDEX work_sessions_range
    ON work_sessions USING gist (tstzrange(started_at, ended_at));

CREATE TABLE activity_entries (
    id                         uuid PRIMARY KEY,
    project_id                 uuid NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
    description                text NOT NULL DEFAULT '',
    mode                       text NOT NULL,
    requested_started_at       timestamptz,
    requested_ended_at         timestamptz,
    requested_duration_minutes integer,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_entries_mode_valid CHECK (mode IN ('explicit', 'duration', 'open')),
    CONSTRAINT activity_entries_description_length CHECK (char_length(description) <= 2000),
    -- EVERY mode stores the interval it resolved to; `mode` records how the times
    -- were arrived at, and Duration_Mode additionally keeps the duration asked for.
    -- Requirement 5.13: a duration entry with no interval has a null sort key (so
    -- re-clipping is not deterministic), nothing to re-place it by, and no handle to
    -- find it by once reconciliation empties it — at which point it is invisible for
    -- ever and keeps its project undeletable through ON DELETE RESTRICT.
    CONSTRAINT activity_entries_mode_fields CHECK (
        requested_started_at IS NOT NULL
        AND requested_ended_at IS NOT NULL
        AND requested_started_at < requested_ended_at
        AND (mode <> 'duration' OR (requested_duration_minutes IS NOT NULL
                                    AND requested_duration_minutes > 0))
    )
);

CREATE INDEX activity_entries_project_id ON activity_entries (project_id);
-- The deterministic re-clipping order, and the paging key (Requirement 7.13).
CREATE INDEX activity_entries_order ON activity_entries (requested_started_at, created_at, id);
-- Requirement 2.9 selects affected entries by requested interval as well as by
-- segment, and an Orphaned_Entry has only this handle left.
CREATE INDEX activity_entries_requested_range ON activity_entries
    USING gist (tstzrange(requested_started_at, requested_ended_at));

CREATE TABLE activity_segments (
    id         uuid PRIMARY KEY,
    entry_id   uuid NOT NULL REFERENCES activity_entries (id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL,
    ended_at   timestamptz NOT NULL,
    CONSTRAINT activity_segments_interval_valid CHECK (started_at < ended_at),
    -- No two activities may claim the same instant (Requirements 4.5, 6.4).
    -- Deferred so re-clipping can delete and reinsert within one transaction.
    CONSTRAINT activity_segments_no_overlap EXCLUDE USING gist (
        tstzrange(started_at, ended_at) WITH &&
    ) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX activity_segments_entry_id ON activity_segments (entry_id);
CREATE INDEX activity_segments_range
    ON activity_segments USING gist (tstzrange(started_at, ended_at));

-- Browser sessions (Requirements 11.7, 11.10, 11.14, 11.15).
-- The cookie carries the raw token; only its hash is stored, so a leaked dump
-- cannot be replayed.
CREATE TABLE auth_sessions (
    token_hash text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX auth_sessions_expires_at ON auth_sessions (expires_at);

-- Idempotency for retried writes from scripts and phone shortcuts
-- (Requirements 12.8, 12.9).
-- entry_id is ON DELETE SET NULL, not CASCADE: with CASCADE, deleting the entry
-- deletes the key, and the next retry of the same request creates a SECOND entry —
-- the exact outcome the key exists to prevent. The status is stored beside the body
-- (Requirement 12.16), because replaying a 201 as a 200 is a different answer.
CREATE TABLE idempotency_keys (
    key            text PRIMARY KEY,
    entry_id       uuid REFERENCES activity_entries (id) ON DELETE SET NULL,
    status         smallint NOT NULL,
    -- sha256, lowercase hex, of the CANONICAL request body: the object as Zod parsed it
    -- (defaults applied), re-serialised with JSON.stringify over keys sorted ascending.
    -- Deliberately not the raw bytes — a retry differing only in whitespace or key order
    -- is the same request and must replay. Catches replaying a genuinely different body
    -- under the same key (409 IDEMPOTENCY_KEY_REUSED, Requirement 12.22).
    request_hash   text NOT NULL,
    response       jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT idempotency_keys_key_shape
        CHECK (char_length(key) BETWEEN 1 AND 200 AND key ~ '^[A-Za-z0-9_-]+$')
);

CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);

-- The Day_Boundary_Config the data was created under (Requirement 10.10).
-- A single row, written by the server at startup when absent (Requirement 10.11) —
-- the migration cannot seed it, because it does not know TIMEZONE or DAY_START_HOUR.
-- The server refuses to start when it disagrees with the configured values.
CREATE TABLE day_boundary_config (
    id             boolean PRIMARY KEY DEFAULT true CHECK (id),
    timezone       text NOT NULL,
    day_start_hour smallint NOT NULL CHECK (day_start_hour BETWEEN 0 AND 23),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- `schema_migrations` is deliberately absent here. `scripts/migrate.sh` creates it
-- before it applies anything, so declaring it again in the first migration raises
-- 42P07 on a clean database and no migration ever succeeds. One owner: the script.

-- Requirement 13.7: updated_at must reflect the last modification, not the insert.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_sessions_set_updated_at BEFORE UPDATE ON work_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER activity_entries_set_updated_at BEFORE UPDATE ON activity_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
