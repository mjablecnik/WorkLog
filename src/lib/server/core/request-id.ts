/**
 * The `X-Request-Id` of a request: propagated when the caller supplies one, generated
 * otherwise, exposed on `locals.requestId` and echoed back on the response
 * (Requirements 12.10, 12.11).
 */

/** Reads an incoming `X-Request-Id`, or mints a UUID when the header is absent. */
export function resolveRequestId(headers: Headers): string {
	const incoming = headers.get('x-request-id');
	if (incoming !== null && incoming.trim().length > 0) return incoming;
	return crypto.randomUUID();
}
