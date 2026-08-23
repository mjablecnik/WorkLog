import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Mirrors `migrations/001_init.sql`. Stores only the hash of a `Browser_Session`
 * token (Requirement 11.7) — never the raw token.
 */
export const authSessions = pgTable('auth_sessions', {
	tokenHash: text('token_hash').primaryKey(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});
