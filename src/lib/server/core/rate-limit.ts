/**
 * A per-address fixed-window counter — one count and one window-start instant per
 * address, reset when the window rolls over. Fixed window rather than a token bucket
 * because `Retry-After` then has an exact answer (the seconds left in the current
 * window) instead of an invented one.
 *
 * This state is in-process: it resets on restart and is not shared between
 * instances, which is exactly why Requirement 13.25 fixes the deployment at one
 * instance. Do not describe it as a distributed limit.
 */
import { LOGIN_ATTEMPT_LIMIT, LOGIN_ATTEMPT_WINDOW_MINUTES } from './config';

type Bucket = { windowStart: number; count: number; lastSeen: number };

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

class FixedWindowLimiter {
	private buckets = new Map<string, Bucket>();

	constructor(
		private limit: number,
		private windowMs: number
	) {}

	check(key: string, now: number): RateLimitResult {
		let bucket = this.buckets.get(key);
		if (bucket === undefined || now - bucket.windowStart >= this.windowMs) {
			bucket = { windowStart: now, count: 0, lastSeen: now };
			this.buckets.set(key, bucket);
		}
		bucket.lastSeen = now;
		bucket.count += 1;
		const allowed = bucket.count <= this.limit;
		const retryAfterSeconds = Math.max(
			0,
			Math.ceil((bucket.windowStart + this.windowMs - now) / 1000)
		);
		return { allowed, retryAfterSeconds };
	}

	/** Evicts a bucket once it has been idle for `idleMs`, so memory cannot grow without bound. */
	sweep(now: number, idleMs: number): void {
		for (const [key, bucket] of this.buckets) {
			if (now - bucket.lastSeen > idleMs) this.buckets.delete(key);
		}
	}

	reset(): void {
		this.buckets.clear();
	}
}

let requestLimiter: FixedWindowLimiter | null = null;
let loginLimiter: FixedWindowLimiter | null = null;

function getRequestLimiter(limitPerMinute: number): FixedWindowLimiter {
	if (requestLimiter === null) requestLimiter = new FixedWindowLimiter(limitPerMinute, 60_000);
	return requestLimiter;
}

function getLoginLimiter(): FixedWindowLimiter {
	if (loginLimiter === null) {
		loginLimiter = new FixedWindowLimiter(
			LOGIN_ATTEMPT_LIMIT,
			LOGIN_ATTEMPT_WINDOW_MINUTES * 60_000
		);
	}
	return loginLimiter;
}

/** The general per-request bucket. `GET /api/health` is exempt — call sites skip it. */
export function checkRequestLimit(
	clientAddr: string,
	limitPerMinute: number,
	now: number
): RateLimitResult {
	return getRequestLimiter(limitPerMinute).check(clientAddr, now);
}

/** The stricter, deliberately unconfigurable login bucket (Requirement 11.13). */
export function checkLoginLimit(clientAddr: string, now: number): RateLimitResult {
	return getLoginLimiter().check(clientAddr, now);
}

/** Evicts idle buckets in both limiters — request buckets at 2x their window, login at 2x theirs. */
export function sweepRateLimits(now: number, limitPerMinute: number): void {
	getRequestLimiter(limitPerMinute).sweep(now, 2 * 60_000);
	getLoginLimiter().sweep(now, 2 * LOGIN_ATTEMPT_WINDOW_MINUTES * 60_000);
}

/**
 * Test-only: clears all in-memory bucket state and forgets the configured limit, so
 * the next call rebuilds the limiter from whatever limit it is given.
 */
export function resetRateLimits(): void {
	requestLimiter = null;
	loginLimiter = null;
}
