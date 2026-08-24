/**
 * Shared helper for `tests/api/*.test.ts`: builds a minimal `RequestEvent` good enough
 * to call a `+server.ts` handler directly, per the design's testing strategy. Not a
 * `.test.ts` file itself, so Vitest's `tests/api/**\/*.test.ts` include glob never
 * picks it up as a suite.
 */
import type { RequestEvent } from '@sveltejs/kit';

let counter = 0;

/**
 * Returns `RequestEvent` loosely typed as `any`: every route's generated
 * `RequestHandler` type (`./$types`) names its own literal route id and `RouteParams`,
 * so no single concrete `RequestEvent<...>` return type here could satisfy every
 * `+server.ts` handler this file's callers pass it to. The object itself still has the
 * real shape a handler needs at runtime.
 */
export function mockEvent(opts: {
	method?: string;
	url: string;
	body?: unknown;
	params?: Record<string, string>;
	headers?: Record<string, string>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
	const headers = new Headers(opts.headers ?? {});
	const hasBody = opts.body !== undefined;
	if (hasBody && !headers.has('content-type')) headers.set('content-type', 'application/json');
	const init: RequestInit = { method: opts.method ?? 'GET', headers };
	if (hasBody) init.body = JSON.stringify(opts.body);

	const url = new URL(opts.url);
	counter += 1;
	return {
		request: new Request(url, init),
		url,
		params: opts.params ?? {},
		locals: {
			requestId: `test-request-${counter}`,
			auth: { kind: 'token' },
			today: { date: '2026-06-01', bounds: { start: new Date(0), end: new Date(0) } },
			locale: 'en',
			theme: 'system'
		},
		cookies: {
			get: () => undefined,
			set: () => undefined,
			delete: () => undefined
		},
		getClientAddress: () => '127.0.0.1'
	} as unknown as RequestEvent;
}

export async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	return text.length === 0 ? {} : JSON.parse(text);
}
