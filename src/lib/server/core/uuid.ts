/**
 * UUID v7 generation, per `migrations/001_init.sql`'s comment: every primary key is a
 * UUID v7 generated in the application, never a v4 and never `gen_random_uuid()` — v7
 * is time-ordered, so inserts land at the right edge of every index instead of
 * scattering across it.
 *
 * The production runtime is always Bun, which has a native, faster implementation
 * (`Bun.randomUUIDv7()`). This module prefers it when available and falls back to a
 * plain RFC 9562 implementation over `crypto.getRandomValues` otherwise — needed only
 * because this project's test suite runs under real Node (see `scripts/run-vitest.sh`
 * and `.agents/MEMORY.md` for why), where `Bun` is not a global.
 */

function randomUuidV7Fallback(): string {
	const ts = BigInt(Date.now());
	const rand = crypto.getRandomValues(new Uint8Array(10));
	const bytes = new Uint8Array(16);
	bytes[0] = Number((ts >> 40n) & 0xffn);
	bytes[1] = Number((ts >> 32n) & 0xffn);
	bytes[2] = Number((ts >> 24n) & 0xffn);
	bytes[3] = Number((ts >> 16n) & 0xffn);
	bytes[4] = Number((ts >> 8n) & 0xffn);
	bytes[5] = Number(ts & 0xffn);
	bytes[6] = 0x70 | (rand[0] & 0x0f); // version 7
	bytes[7] = rand[1];
	bytes[8] = 0x80 | (rand[2] & 0x3f); // variant 10
	bytes[9] = rand[3];
	bytes[10] = rand[4];
	bytes[11] = rand[5];
	bytes[12] = rand[6];
	bytes[13] = rand[7];
	bytes[14] = rand[8];
	bytes[15] = rand[9];
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomUuidV7(): string {
	if (typeof Bun !== 'undefined' && typeof Bun.randomUUIDv7 === 'function') {
		return Bun.randomUUIDv7();
	}
	return randomUuidV7Fallback();
}
