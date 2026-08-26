import { pgTable, uuid, text, timestamp, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './projects';

/**
 * Mirrors `migrations/001_init.sql` and `migrations/002_leisure_time_categories.sql`.
 * The gist range index on the requested interval
 * (`activity_entries_requested_range`) is not expressible here — the SQL migration is
 * the authority; this definition exists for typed queries only.
 */
export const activityEntries = pgTable(
	'activity_entries',
	{
		id: uuid('id').primaryKey(),
		/** Null means a Leisure_Entry — no Project at all. */
		projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
		description: text('description').notNull().default(''),
		mode: text('mode').notNull(),
		requestedStartedAt: timestamp('requested_started_at', { withTimezone: true }),
		requestedEndedAt: timestamp('requested_ended_at', { withTimezone: true }),
		requestedDurationMinutes: integer('requested_duration_minutes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check('activity_entries_mode_valid', sql`${table.mode} IN ('explicit', 'duration', 'open')`),
		check('activity_entries_description_length', sql`char_length(${table.description}) <= 2000`),
		check(
			'activity_entries_mode_fields',
			sql`${table.requestedStartedAt} IS NOT NULL
				AND ${table.requestedEndedAt} IS NOT NULL
				AND ${table.requestedStartedAt} < ${table.requestedEndedAt}
				AND (${table.mode} <> 'duration' OR (${table.requestedDurationMinutes} IS NOT NULL
					AND ${table.requestedDurationMinutes} > 0))`
		)
	]
);
