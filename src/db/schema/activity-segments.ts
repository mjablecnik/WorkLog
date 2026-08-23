import { pgTable, uuid, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { activityEntries } from './activity-entries';

/**
 * Mirrors `migrations/001_init.sql`. The `EXCLUDE USING gist` constraint
 * (`activity_segments_no_overlap`, `DEFERRABLE INITIALLY DEFERRED`) is not
 * expressible here — the SQL migration is the authority; this definition exists for
 * typed queries only.
 */
export const activitySegments = pgTable(
	'activity_segments',
	{
		id: uuid('id').primaryKey(),
		entryId: uuid('entry_id')
			.notNull()
			.references(() => activityEntries.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
		endedAt: timestamp('ended_at', { withTimezone: true }).notNull()
	},
	(table) => [check('activity_segments_interval_valid', sql`${table.startedAt} < ${table.endedAt}`)]
);
