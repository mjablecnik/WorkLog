import {
	pgTable,
	uuid,
	text,
	smallint,
	boolean,
	timestamp,
	uniqueIndex,
	check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Mirrors `migrations/001_init.sql` and `migrations/002_leisure_time_categories.sql`,
 * for typed queries only. `EXCLUDE` constraints and expression-based partial indexes
 * are not expressible in the Drizzle DSL, so the SQL migrations are the authority for
 * those; `tests/lib/server/store/schema.test.ts` asserts the two stay in agreement on
 * what IS expressible here (columns and types).
 */
export const projects = pgTable(
	'projects',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		colorIndex: smallint('color_index').notNull().default(0),
		/** Whether a Work_Entry attributed to this Project is paid (true) or unpaid (false). */
		billable: boolean('billable').notNull().default(true),
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Case- and whitespace-insensitive uniqueness (Requirement 3.2). Declared here
		// for the schema-agreement test; the migration is what actually creates it.
		uniqueIndex('projects_name_unique').on(sql`lower(btrim(${table.name}))`),
		check('projects_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 200`),
		check('projects_color_index_range', sql`${table.colorIndex} BETWEEN 0 AND 7`)
	]
);
