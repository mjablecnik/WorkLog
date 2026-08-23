import type { Interval } from '$lib/contracts/models';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			requestId: string;
			auth: { kind: 'browser' } | { kind: 'token' } | { kind: 'none' };
			/** Today as a Logical_Day, and its bounds. Requirement 10.17. */
			today: { date: string; bounds: Interval };
			locale: 'cs' | 'en';
			theme: 'dark' | 'light' | 'system';
			// No `cspNonce`: `kit.csp` owns the nonce and nothing on `locals` ever holds
			// one — an always-undefined field is worse than an absent one.
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
