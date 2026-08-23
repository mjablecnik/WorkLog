import { pgTable, uuid, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Mirrors `migrations/001_init.sql`. The `EXCLUDE USING gist` constraint
 * (`work_sessions_no_overlap`) and the partial unique index
 * (`work_sessions_one_open`) are not expressible here — the SQL migration is the
 * authority for both; this definition exists for typed queries only.
 */
export const workSessions = pgTable(
	'work_sessions',
	{
		id: uuid('id').primaryKey(),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		check(
			'work_sessions_interval_valid',
			sql`${table.endedAt} IS NULL OR ${table.startedAt} < ${table.endedAt}`
		)
	]
);
