import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	clientAddress,
	hashPassphrase,
	hashSessionToken,
	mintSessionToken,
	safeRedirectTarget,
	secretsMatch,
	sessionCookieOptions,
	verifyPassphraseAgainst
} from '../../../../src/lib/server/core/auth';

function mockEvent(headers: Record<string, string>, socketAddr = '9.9.9.9'): RequestEvent {
	return {
		request: new Request('http://localhost/', { headers }),
		getClientAddress: () => socketAddr
	} as unknown as RequestEvent;
}

describe('secretsMatch', () => {
	it('true for identical secrets', () => {
		expect(secretsMatch('abc', 'abc')).toBe(true);
	});
	it('false for different secrets of the same length', () => {
		expect(secretsMatch('abc', 'abd')).toBe(false);
	});
	it('false for different lengths', () => {
		expect(secretsMatch('abc', 'abcd')).toBe(false);
	});
});

describe('hashPassphrase / verifyPassphraseAgainst', () => {
	it('round-trips: the correct passphrase verifies, a wrong one does not', async () => {
		const hash = await hashPassphrase('correct horse battery staple');
		expect(await verifyPassphraseAgainst('correct horse battery staple', hash)).toBe(true);
		expect(await verifyPassphraseAgainst('wrong', hash)).toBe(false);
	});

	it('the stored hash never equals the submitted passphrase', async () => {
		const hash = await hashPassphrase('hunter2');
		expect(hash).not.toBe('hunter2');
		expect(hash.includes('hunter2')).toBe(false);
	});

	it('two hashes of the same passphrase differ (random salt)', async () => {
		const a = await hashPassphrase('same passphrase');
		const b = await hashPassphrase('same passphrase');
		expect(a).not.toBe(b);
	});
});

describe('mintSessionToken / hashSessionToken', () => {
	it('the minted hash matches hashing the token independently', () => {
		const { token, tokenHash } = mintSessionToken();
		expect(hashSessionToken(token)).toBe(tokenHash);
	});

	it('two mints never collide', () => {
		const a = mintSessionToken();
		const b = mintSessionToken();
		expect(a.token).not.toBe(b.token);
		expect(a.tokenHash).not.toBe(b.tokenHash);
	});
});

describe('safeRedirectTarget', () => {
	it('accepts a local path', () => {
		expect(safeRedirectTarget('/day/2026-06-15')).toBe('/day/2026-06-15');
	});
	it('rejects a protocol-relative path', () => {
		expect(safeRedirectTarget('//evil.example')).toBe('/');
	});
	it('rejects an absolute URL', () => {
		expect(safeRedirectTarget('https://evil.example')).toBe('/');
	});
	it('falls back to / when absent', () => {
		expect(safeRedirectTarget(null)).toBe('/');
	});
});

describe('clientAddress', () => {
	it('uses the socket address when TRUSTED_PROXY_HOPS is 0, ignoring X-Forwarded-For', () => {
		const event = mockEvent({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' });
		expect(clientAddress(event, 0)).toBe('9.9.9.9');
	});

	it('drops the rightmost N entries and takes the next one', () => {
		const event = mockEvent({ 'x-forwarded-for': 'client, proxy1, proxy2' });
		// With 1 trusted hop, the rightmost (proxy2) is dropped and proxy1 is taken.
		expect(clientAddress(event, 1)).toBe('proxy1');
	});

	it('a caller cannot escape its own bucket by prepending addresses', () => {
		const real = mockEvent({ 'x-forwarded-for': 'proxy1, proxy2' }); // 2 real hops
		const spoofed = mockEvent({ 'x-forwarded-for': 'fake1, fake2, fake3, proxy1, proxy2' });
		// With TRUSTED_PROXY_HOPS=1, both resolve to the same address — the one just
		// before the last hop — regardless of how many entries were prepended.
		expect(clientAddress(real, 1)).toBe(clientAddress(spoofed, 1));
	});
});

describe('sessionCookieOptions', () => {
	it('is httpOnly, sameSite strict, with an explicit path and maxAge', () => {
		const opts = sessionCookieOptions();
		expect(opts.httpOnly).toBe(true);
		expect(opts.sameSite).toBe('strict');
		expect(opts.path).toBe('/');
		expect(opts.maxAge).toBeGreaterThan(0);
	});
});
