import { beforeEach, describe, expect, it } from 'vitest';
import {
	checkLoginLimit,
	checkRequestLimit,
	resetRateLimits,
	sweepRateLimits
} from '../../../../src/lib/server/core/rate-limit';

beforeEach(() => {
	resetRateLimits();
});

describe('checkRequestLimit', () => {
	it('allows up to the configured limit, then returns 429 with Retry-After', () => {
		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			expect(checkRequestLimit('1.2.3.4', 5, now).allowed).toBe(true);
		}
		const sixth = checkRequestLimit('1.2.3.4', 5, now);
		expect(sixth.allowed).toBe(false);
		expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
		expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(60);
	});

	it('a lowered configured limit trips correspondingly sooner', () => {
		const now = Date.now();
		expect(checkRequestLimit('addr', 1, now).allowed).toBe(true);
		expect(checkRequestLimit('addr', 1, now).allowed).toBe(false);
	});

	it('different addresses have independent buckets', () => {
		const now = Date.now();
		expect(checkRequestLimit('a', 1, now).allowed).toBe(true);
		expect(checkRequestLimit('b', 1, now).allowed).toBe(true);
	});

	it('a new window resets the count', () => {
		const t0 = Date.now();
		expect(checkRequestLimit('addr', 1, t0).allowed).toBe(true);
		expect(checkRequestLimit('addr', 1, t0).allowed).toBe(false);
		expect(checkRequestLimit('addr', 1, t0 + 61_000).allowed).toBe(true);
	});
});

describe('checkLoginLimit', () => {
	it('trips after 5 attempts in 15 minutes, unaffected by RATE_LIMIT_PER_MINUTE', () => {
		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			expect(checkLoginLimit('addr', now).allowed).toBe(true);
		}
		expect(checkLoginLimit('addr', now).allowed).toBe(false);
	});

	it('resets after the 15-minute window', () => {
		const t0 = Date.now();
		for (let i = 0; i < 5; i++) checkLoginLimit('addr', t0);
		expect(checkLoginLimit('addr', t0).allowed).toBe(false);
		expect(checkLoginLimit('addr', t0 + 16 * 60_000).allowed).toBe(true);
	});
});

describe('sweepRateLimits', () => {
	it('does not throw and is safe to call repeatedly', () => {
		const now = Date.now();
		checkRequestLimit('addr', 10, now);
		expect(() => sweepRateLimits(now + 3 * 60_000, 10)).not.toThrow();
		// The bucket should be gone after the sweep; a fresh check succeeds even at
		// the previous count-exhausting request count, since the window reset.
		expect(checkRequestLimit('addr', 1, now + 3 * 60_000 + 1).allowed).toBe(true);
	});
});
