/**
 * The `auth_sessions` rows. Takes hashes, never raw tokens — `core/auth.ts` does the
 * hashing. Split from `core/auth.ts` per the Module Boundaries: `core` holds no
 * persistence.
 */
import { eq, lt } from 'drizzle-orm';
import { authSessions } from '../../../db/schema';
import type { Tx } from './tx';

export async function beginBrowserSession(
	tx: Tx,
	tokenHash: string,
	expiresAt: Date
): Promise<void> {
	await tx.insert(authSessions).values({ tokenHash, expiresAt });
}

export async function findAuthSession(
	tx: Tx,
	tokenHash: string
): Promise<{ expiresAt: Date } | null> {
	const [row] = await tx
		.select({ expiresAt: authSessions.expiresAt })
		.from(authSessions)
		.where(eq(authSessions.tokenHash, tokenHash))
		.limit(1);
	return row ?? null;
}

export async function deleteAuthSession(tx: Tx, tokenHash: string): Promise<void> {
	await tx.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}

/** Deletes every expired session; returns how many were removed. */
export async function purgeExpiredAuthSessions(tx: Tx, now: Date): Promise<number> {
	const deleted = await tx.delete(authSessions).where(lt(authSessions.expiresAt, now)).returning();
	return deleted.length;
}
