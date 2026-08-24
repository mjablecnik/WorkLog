/**
 * Task 1.14. Message coverage — design.md's "Message coverage test" paragraph.
 *
 * Runs under the `components` (jsdom) Vitest project by location
 * (`tests/lib/*.test.ts` in `vitest.config.ts`); the plural-rendering assertions
 * import the compiled Paraglide catalogue directly and pass `{ locale: 'cs' }`
 * per-call (every generated message function accepts a `{ locale }` option — see
 * `src/lib/paraglide/messages/preview_total.js`), so no global locale-switching
 * machinery (`initLocale`/`switchLocale`) is needed just to force Czech for one call.
 *
 * `ALL_ERROR_CODES` below is a deliberate, hand-kept copy of `errors.ts`'s
 * `ErrorCode` union — the same convention `tests/lib/server/core/errors.test.ts`
 * already uses for its own `ALL_CODES` — since `ErrorCode` is a type, not a runtime
 * value, and `errors.ts` exports no array of codes to iterate.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../src/lib/server/core/errors';
import * as m from '../../src/lib/paraglide/messages';

const MESSAGES_DIR = resolve(__dirname, '../../messages');
const SRC_DIR = resolve(__dirname, '../../src');

function loadCatalogue(locale: 'cs' | 'en'): Record<string, unknown> {
	const raw = readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8');
	return JSON.parse(raw);
}

function messageKeys(catalogue: Record<string, unknown>): Set<string> {
	return new Set(Object.keys(catalogue).filter((k) => k !== '$schema'));
}

const cs = loadCatalogue('cs');
const en = loadCatalogue('en');
const csKeys = messageKeys(cs);
const enKeys = messageKeys(en);

function symmetricDifference(a: Set<string>, b: Set<string>): { onlyA: string[]; onlyB: string[] } {
	return {
		onlyA: [...a].filter((k) => !b.has(k)).sort(),
		onlyB: [...b].filter((k) => !a.has(k)).sort()
	};
}

describe('cs.json / en.json key parity', () => {
	it('hold identical key sets', () => {
		const { onlyA, onlyB } = symmetricDifference(csKeys, enKeys);
		expect(onlyA, `keys only in cs.json: ${onlyA.join(', ')}`).toEqual([]);
		expect(onlyB, `keys only in en.json: ${onlyB.join(', ')}`).toEqual([]);
	});

	it('carry the same key count in both files', () => {
		// Observed at 255 (excluding $schema) as of the timer-page task, which added
		// timer_stop_discarded (the sub-minimum-interval "nothing saved" toast). Earlier
		// snapshots of this count (249-254) are stale by construction — every task that
		// legitimately extends the catalogue bumps it again. What this test actually pins
		// is that cs/en agree, which the count-equality assertion below already covers
		// regardless of the literal number; the literal is a tripwire for an ACCIDENTAL
		// catalogue change, not a ceiling, and is expected to need updating whenever a
		// future task adds a key on purpose.
		expect(csKeys.size).toBe(enKeys.size);
		expect(csKeys.size).toBe(255);
	});
});

describe('Message Catalogue namespace coverage (spot-check)', () => {
	// Every namespace prefix design.md's Message Catalogue documents. Enumerating all
	// 250 keys by hand would just re-transcribe the catalogue; spot-checking that each
	// namespace is represented in both files is the pragmatic proxy the task allows.
	const NAMESPACE_PREFIXES = [
		'common_',
		'nav_',
		'shell_',
		'settings_',
		'auth_',
		'timer_',
		'day_',
		'activity_',
		'session_',
		'preview_',
		'projects_',
		'stats_',
		'feedback_',
		'offline_',
		'error_page_',
		'errors_',
		'fields_',
		'aria_'
	];

	it.each(NAMESPACE_PREFIXES)('namespace "%s" has at least one key in both catalogues', (prefix) => {
		const inCs = [...csKeys].some((k) => k.startsWith(prefix));
		const inEn = [...enKeys].some((k) => k.startsWith(prefix));
		expect(inCs, `no cs.json key starts with ${prefix}`).toBe(true);
		expect(inEn, `no en.json key starts with ${prefix}`).toBe(true);
	});
});

describe('every ErrorCode has its base errors_* key', () => {
	// Hand-kept copy of src/lib/server/core/errors.ts's ErrorCode union — same
	// convention as tests/lib/server/core/errors.test.ts's ALL_CODES, since ErrorCode
	// is a type with no runtime array to import.
	const ALL_ERROR_CODES: ErrorCode[] = [
		'VALIDATION_ERROR',
		'INVALID_INTERVAL',
		'AMBIGUOUS_MODE',
		'RANGE_TOO_LARGE',
		'UNAUTHORIZED',
		'NOT_FOUND',
		'SESSION_ALREADY_RUNNING',
		'NO_SESSION_RUNNING',
		'SESSION_OVERLAP',
		'ACTIVITY_OVERLAP',
		'OUTSIDE_TRACKED_TIME',
		'NO_PLACEMENT_ANCHOR',
		'NOTHING_TO_LOG',
		'PROJECT_EXISTS',
		'PROJECT_IN_USE',
		'PROJECT_ARCHIVED',
		'FUTURE_TIMESTAMP',
		'INTERVAL_TOO_SHORT',
		'STALE_PREVIEW',
		'IDEMPOTENCY_KEY_REUSED',
		'METHOD_NOT_ALLOWED',
		'PAYLOAD_TOO_LARGE',
		'RATE_LIMITED',
		'SERVICE_UNAVAILABLE',
		'INTERNAL_ERROR'
	];

	function baseKeyFor(code: ErrorCode): string {
		return `errors_${code.toLowerCase()}`;
	}

	it.each(ALL_ERROR_CODES)('%s -> errors_* key exists in both catalogues', (code) => {
		const key = baseKeyFor(code);
		expect(csKeys.has(key), `cs.json is missing ${key}`).toBe(true);
		expect(enKeys.has(key), `en.json is missing ${key}`).toBe(true);
	});
});

describe('Czech plural forms render correctly for 1, 2 and 5', () => {
	it('preview_total: one / few / other counts', () => {
		const duration = '30 min';
		const one = m.preview_total({ count: 1, duration }, { locale: 'cs' });
		const few = m.preview_total({ count: 2, duration }, { locale: 'cs' });
		const other = m.preview_total({ count: 5, duration }, { locale: 'cs' });

		expect(one).toContain('záznam');
		expect(one).not.toContain('záznamy');
		expect(one).not.toContain('záznamů');

		expect(few).toContain('záznamy');
		expect(few).not.toContain('záznamů');

		expect(other).toContain('záznamů');

		// All three forms must actually differ from one another.
		expect(new Set([one, few, other]).size).toBe(3);
	});

	it('stats_observation_nights: one / few / other counts', () => {
		const eveningHour = '20:00';
		const workdays = '10';
		const one = m.stats_observation_nights({ eveningHour, nights: 1, workdays }, { locale: 'cs' });
		const few = m.stats_observation_nights({ eveningHour, nights: 2, workdays }, { locale: 'cs' });
		const other = m.stats_observation_nights({ eveningHour, nights: 5, workdays }, { locale: 'cs' });

		expect(one).toContain('1 den');
		expect(few).toContain('2 dny');
		expect(other).toContain('5 dnů');
		expect(new Set([one, few, other]).size).toBe(3);
	});

	it('errors_project_in_use: one / few / other counts', () => {
		const projectName = 'Client Work';
		const one = m.errors_project_in_use({ projectName, entryCount: 1 }, { locale: 'cs' });
		const few = m.errors_project_in_use({ projectName, entryCount: 2 }, { locale: 'cs' });
		const other = m.errors_project_in_use({ projectName, entryCount: 5 }, { locale: 'cs' });

		expect(one).toContain('1 záznam,');
		expect(few).toContain('2 záznamy,');
		expect(other).toContain('5 záznamů,');
		expect(new Set([one, few, other]).size).toBe(3);
	});
});

// --------------------------------------------------------------------------------------
// No literal user-facing text outside a message call.
//
// This is a PRAGMATIC heuristic, not an exhaustive parser — a naive "any text between
// tags" check produces false positives on template expressions (a `>`/`<` inside a
// `{condition > 0 ? a : b}` reads like a tag boundary to a regex) and could in
// principle produce false negatives too (text hidden inside an unusual construct this
// heuristic does not anticipate). It works as follows and is only as good as this:
//   1. Strip every <script>...</script> and <style>...</style> block, and every HTML
//      comment, from the raw file.
//   2. Strip every balanced `{...}` span from what remains, at ANY nesting depth,
//      across the WHOLE file (not per-fragment) — this is what avoids the ternary
//      false positive above, since `{x > 0 ? a : b}` disappears as one unit before
//      the tag-boundary scan ever sees its internal `>`.
//   3. Scan what remains for `>(...)<` text-node spans; if the captured text still
//      contains a run of 3+ letters after step 2, it is a candidate literal.
// An attribute value (`role="dialog"`, `aria-label="..."`) is naturally excluded,
// since it sits between `<` and `>` of the same tag-opening, never between `>` and
// `<`. Run once against this codebase's actual `src/`, this produced exactly one
// finding: `src/routes/+page.svelte`'s `<p>Worklog</p>` — a documented placeholder
// route (its own comment: "This file is scaffolding... 002-worklog-ui replaces it"),
// not a real UI surface. That one is allowlisted below by exact file + text; any
// OTHER literal text node anywhere else under src/ still fails this test.
// --------------------------------------------------------------------------------------

const ALLOWED_LITERAL_TEXT: { file: string; text: string }[] = [
	{ file: 'routes/+page.svelte', text: 'Worklog' } // placeholder scaffold route, see comment above
];

function listSvelteFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listSvelteFiles(full));
		} else if (entry.isFile() && entry.name.endsWith('.svelte')) {
			files.push(full);
		}
	}
	return files;
}

function stripScriptStyleComments(src: string): string {
	return src
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
}

/** Removes every balanced {...} span, any nesting depth, from the whole string. */
function stripBraces(text: string): string {
	let result = '';
	let depth = 0;
	for (const ch of text) {
		if (ch === '{') {
			depth++;
			continue;
		}
		if (ch === '}') {
			if (depth > 0) depth--;
			continue;
		}
		if (depth === 0) result += ch;
	}
	return result;
}

const LETTER_RUN_RE = /[A-Za-zÀ-ž]{3,}/;

function findLiteralTextNodes(src: string): string[] {
	const cleaned = stripBraces(stripScriptStyleComments(src));
	const findings: string[] = [];
	const re = />([^<>]*)</g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(cleaned))) {
		const raw = match[1].trim();
		if (raw.length > 0 && LETTER_RUN_RE.test(raw)) findings.push(raw);
	}
	return findings;
}

describe('no user-facing string literal outside a message call (heuristic, see comment above)', () => {
	it('every literal text node under src/**/*.svelte is either a message call or explicitly allowlisted', () => {
		const offenders: string[] = [];
		for (const file of listSvelteFiles(SRC_DIR)) {
			const relative = file.replace(`${SRC_DIR}/`, '');
			const src = readFileSync(file, 'utf8');
			for (const text of findLiteralTextNodes(src)) {
				const allowed = ALLOWED_LITERAL_TEXT.some((a) => a.file === relative && a.text === text);
				if (!allowed) offenders.push(`${relative}: ${JSON.stringify(text)}`);
			}
		}
		expect(offenders, offenders.join('\n')).toEqual([]);
	});
});

describe('no {@html} on a project name or description (Requirement 17.x)', () => {
	it('src/ contains zero uses of {@html} at all — none has ever been needed', () => {
		const offenders: string[] = [];
		for (const file of listSvelteFiles(SRC_DIR)) {
			const src = readFileSync(file, 'utf8');
			if (src.includes('{@html')) offenders.push(file.replace(`${SRC_DIR}/`, ''));
		}
		expect(offenders, `files using {@html}: ${offenders.join(', ')}`).toEqual([]);
	});
});
