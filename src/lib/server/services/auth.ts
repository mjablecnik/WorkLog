/**
 * The one door `/login` and `/logout` (Requirements 11.12, 11.14, 11.25) reach through
 * into authentication infrastructure — neither may import `core/auth.ts` or
 * `core/config.ts` directly (module boundary: a non-`api` route's `+page.server.ts`
 * may only import `services` or `store` from `src/lib/server/`). Thin on purpose: the
 * real logic already lives in `core/auth.ts`, this just re-shapes it for the two pages
 * that need it.
 */
import {
	hashSessionToken,
	mintSessionToken,
	safeRedirectTarget,
	sessionCookieOptions,
	verifyPassphrase,
	SESSION_COOKIE
} from '../core/auth';
import { getConfig } from '../core/config';

export { SESSION_COOKIE };

export async function verifyLoginPassphrase(passphrase: string): Promise<boolean> {
	return verifyPassphrase(passphrase);
}

export type NewBrowserSession = {
	token: string;
	tokenHash: string;
	expiresAt: Date;
	cookieOptions: ReturnType<typeof sessionCookieOptions>;
};

/** Mints a Browser_Session token and the cookie options to set it with; does not persist anything. */
export function beginBrowserSessionCookie(): NewBrowserSession {
	const { token, tokenHash } = mintSessionToken();
	const config = getConfig();
	const expiresAt = new Date(Date.now() + config.sessionDurationHours * 3_600_000);
	return { token, tokenHash, expiresAt, cookieOptions: sessionCookieOptions() };
}

/** Requirement 11.12-adjacent redirect safety: never an absolute or protocol-relative target. */
export function resolveSafeRedirect(next: string | null | undefined): string {
	return safeRedirectTarget(next ?? null);
}

export function hashSessionCookieValue(cookieValue: string): string {
	return hashSessionToken(cookieValue);
}
