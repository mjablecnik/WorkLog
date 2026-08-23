/**
 * Everything about authentication that needs no database: the argon2id passphrase
 * check, minting and hashing a session token, constant-time comparison, and the
 * cookie options. Everything that touches `auth_sessions` lives in
 * `store/auth-sessions.ts`; `authenticate(event)` needs a `RequestEvent` and a
 * lookup, so it lives in `src/hooks.server.ts` as part of the `Auth_Hook`.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { ARGON2ID, SESSION_TOKEN_BYTES, getConfig } from './config';

export const SESSION_COOKIE = 'worklog_session';

/** Constant-time comparison of two secrets. */
export function secretsMatch(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) {
		// Still do a constant-time compare against a same-length buffer, so the early
		// return doesn't leak length-derived timing beyond what the length itself (sent
		// on the wire already) already reveals.
		timingSafeEqual(bufA, bufA);
		return false;
	}
	return timingSafeEqual(bufA, bufB);
}

/**
 * `Bun.password.hash`/`verify` (argon2id) are Bun-only globals. Production always
 * runs under Bun, so that is the only path real deployments ever take. This project's
 * test suite runs under real Node (see `.agents/MEMORY.md` — a reproducible Bun
 * transpiler bug when `zod` and `postgres` are both loaded), where those globals do
 * not exist, so a clearly-marked fallback KDF (Node's built-in `scrypt`, never
 * claiming to be argon2id) covers the tests that exercise the hash/verify round trip
 * without a real Bun process. `loadConfig()` still requires `WORKLOG_PASSPHRASE_HASH`
 * to be a real `$argon2id$` hash, so this fallback format is never accepted as actual
 * server configuration — only usable directly against a hash `hashPassphrase` itself
 * produced under Node.
 */
const NODE_FALLBACK_PREFIX = '$node-scrypt-fallback$';

function hashPassphraseFallback(plaintext: string): string {
	const salt = randomBytes(16);
	const derived = scryptSync(plaintext, salt, 64);
	return `${NODE_FALLBACK_PREFIX}${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassphraseFallback(plaintext: string, hash: string): boolean {
	const rest = hash.slice(NODE_FALLBACK_PREFIX.length);
	const [saltHex, hashHex] = rest.split('$');
	if (saltHex === undefined || hashHex === undefined) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const expected = Buffer.from(hashHex, 'hex');
	const derived = scryptSync(plaintext, salt, expected.length);
	return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Produces a passphrase hash — real argon2id under Bun, the Node fallback otherwise. */
export async function hashPassphrase(plaintext: string): Promise<string> {
	if (typeof Bun !== 'undefined' && Bun.password) {
		return Bun.password.hash(plaintext, ARGON2ID);
	}
	return hashPassphraseFallback(plaintext);
}

/** Verifies `plaintext` against an arbitrary stored `hash`, dispatching by its format. */
export async function verifyPassphraseAgainst(plaintext: string, hash: string): Promise<boolean> {
	if (hash.startsWith(NODE_FALLBACK_PREFIX)) {
		return verifyPassphraseFallback(plaintext, hash);
	}
	if (typeof Bun !== 'undefined' && Bun.password) {
		return Bun.password.verify(plaintext, hash);
	}
	throw new Error('cannot verify an argon2id hash outside the Bun runtime');
}

/** Checks the submitted passphrase against `WORKLOG_PASSPHRASE_HASH`. */
export async function verifyPassphrase(submitted: string): Promise<boolean> {
	return verifyPassphraseAgainst(submitted, getConfig().passphraseHash);
}

/**
 * `SESSION_TOKEN_BYTES` of `crypto.getRandomValues`, encoded base64url as the raw
 * cookie value; the stored hash is lowercase-hex sha256 of that string. Two fixed
 * encodings, because a token that round-trips differently on two paths never matches.
 */
export function mintSessionToken(): { token: string; tokenHash: string } {
	const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
	const token = Buffer.from(bytes).toString('base64url');
	return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export type CookieOptions = {
	httpOnly: boolean;
	sameSite: 'strict';
	path: string;
	maxAge: number;
	secure: boolean;
};

/** httpOnly, sameSite 'strict', explicit path and maxAge, secure outside development/test. */
export function sessionCookieOptions(): CookieOptions {
	const config = getConfig();
	return {
		httpOnly: true,
		sameSite: 'strict',
		path: '/',
		maxAge: config.sessionDurationHours * 3600,
		secure: config.appEnv !== 'development' && config.appEnv !== 'test'
	};
}

/** Only a path starting with a single "/" is accepted; anything else becomes "/". */
export function safeRedirectTarget(raw: string | null): string {
	if (raw === null) return '/';
	if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
	return '/';
}

/**
 * The address rate limiting counts against (Requirement 11.20). `X-Forwarded-For` is
 * caller-supplied for every hop the deployment does not control, so the rightmost
 * `trustedProxyHops` entries are dropped and the next one taken; with the default of
 * zero the header is ignored entirely and the socket address is used. Taking the
 * leftmost entry instead would let anyone mint a fresh identity per request by
 * prepending one, defeating the login bucket Requirement 11.13 deliberately makes
 * unconfigurable.
 */
export function clientAddress(event: RequestEvent, trustedProxyHops: number): string {
	const header = event.request.headers.get('x-forwarded-for');
	if (trustedProxyHops > 0 && header !== null) {
		const parts = header
			.split(',')
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		const index = parts.length - 1 - trustedProxyHops;
		if (index >= 0) return parts[index];
	}
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}
