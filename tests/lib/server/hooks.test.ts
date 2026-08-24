import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { withTx } from '../../../src/lib/server/store/tx';
import { beginBrowserSession } from '../../../src/lib/server/store/auth-sessions';
import { mintSessionToken, SESSION_COOKIE } from '../../../src/lib/server/core/auth';
import { getConfig } from '../../../src/lib/server/core/config';
import { authenticate, handleAuth, handleCors } from '../../../src/hooks.server';

function mockEvent(opts: {
	method?: string;
	url?: string;
	headers?: Record<string, string>;
	cookie?: string;
}): RequestEvent {
	const headers = new Headers(opts.headers ?? {});
	if (opts.cookie !== undefined) headers.set('cookie', `${SESSION_COOKIE}=${opts.cookie}`);
	const url = new URL(opts.url ?? 'http://localhost/api/sessions');
	const cookieStore = new Map<string, string>();
	if (opts.cookie !== undefined) cookieStore.set(SESSION_COOKIE, opts.cookie);

	return {
		request: new Request(url, { method: opts.method ?? 'GET', headers }),
		url,
		locals: {},
		cookies: {
			get: (name: string) => cookieStore.get(name),
			set: () => undefined,
			delete: () => undefined
		},
		getClientAddress: () => '1.2.3.4'
	} as unknown as RequestEvent;
}

describe('authenticate', () => {
	it('admits a request with a valid bearer token', async () => {
		const config = getConfig();
		const event = mockEvent({ headers: { authorization: `Bearer ${config.apiToken}` } });
		expect((await authenticate(event)).kind).toBe('token');
	});

	it('rejects a wrong bearer token', async () => {
		const event = mockEvent({
			headers: { authorization: 'Bearer wrong-token-wrong-token-wrong-token' }
		});
		expect((await authenticate(event)).kind).toBe('none');
	});

	it('admits a request with a valid session cookie', async () => {
		const { token, tokenHash } = mintSessionToken();
		await withTx((tx) => beginBrowserSession(tx, tokenHash, new Date(Date.now() + 3_600_000)));
		const event = mockEvent({ cookie: token });
		expect((await authenticate(event)).kind).toBe('browser');
	});

	it('rejects an expired session cookie', async () => {
		const { token, tokenHash } = mintSessionToken();
		await withTx((tx) => beginBrowserSession(tx, tokenHash, new Date(Date.now() - 1000)));
		const event = mockEvent({ cookie: token });
		expect((await authenticate(event)).kind).toBe('none');
	});

	it('rejects a request with neither credential', async () => {
		const event = mockEvent({});
		expect((await authenticate(event)).kind).toBe('none');
	});
});

describe('handleAuth', () => {
	it('returns 401 for an unauthenticated /api request', async () => {
		const event = mockEvent({ url: 'http://localhost/api/sessions' });
		const response = await handleAuth({ event, resolve: async () => new Response('ok') } as never);
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBe('UNAUTHORIZED');
	});

	it('redirects an unauthenticated non-/api request to /login carrying the original path', async () => {
		const event = mockEvent({ url: 'http://localhost/day/2026-06-15' });
		const response = await handleAuth({ event, resolve: async () => new Response('ok') } as never);
		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toContain('/login?next=');
		expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain('/day/2026-06-15');
	});

	it('exempts /api/health without a credential', async () => {
		const event = mockEvent({ url: 'http://localhost/api/health' });
		let resolved = false;
		await handleAuth({
			event,
			resolve: async () => {
				resolved = true;
				return new Response('ok');
			}
		} as never);
		expect(resolved).toBe(true);
	});

	it('admits a request with a valid bearer token through to resolve()', async () => {
		const config = getConfig();
		const event = mockEvent({
			url: 'http://localhost/api/sessions',
			headers: { authorization: `Bearer ${config.apiToken}` }
		});
		let resolved = false;
		const response = await handleAuth({
			event,
			resolve: async () => {
				resolved = true;
				return new Response('ok');
			}
		} as never);
		expect(resolved).toBe(true);
		expect(response.status).toBe(200);
	});
});

describe('handleCors', () => {
	it('answers a preflight OPTIONS request itself, before any auth logic runs — regardless of whether the origin matches', async () => {
		const event = mockEvent({
			method: 'OPTIONS',
			headers: { origin: 'https://some-origin.example', 'access-control-request-method': 'POST' }
		});
		let resolved = false;
		const response = await handleCors({
			event,
			resolve: async () => {
				resolved = true;
				return new Response('should not be reached');
			}
		} as never);
		expect(resolved).toBe(false);
		expect(response.status).toBe(204);
	});

	it('does not set CORS headers for an origin not in CORS_ORIGINS', async () => {
		const event = mockEvent({
			method: 'OPTIONS',
			headers: { origin: 'https://not-allowed.example', 'access-control-request-method': 'POST' }
		});
		const response = await handleCors({ event, resolve: async () => new Response('x') } as never);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('a plain request without an Origin header passes through unchanged', async () => {
		const event = mockEvent({ method: 'GET' });
		const response = await handleCors({ event, resolve: async () => new Response('ok') } as never);
		expect(response.headers.get('access-control-allow-origin')).toBeNull();
	});
});
