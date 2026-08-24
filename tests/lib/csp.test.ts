/**
 * Task 1.14. The source-level test design.md's "Theme and CSP tests" paragraph
 * describes: no `.svelte` file under `src/` may carry an inline `style="..."`
 * attribute, since the production Content-Security-Policy (`001`) forbids
 * `unsafe-inline` styles and a nonce does not cover `style=` (theme.svelte.ts's own
 * doc comment makes the same point about `Settings_Menu`'s desktop anchoring).
 *
 * Grep-based and deliberately narrow: `/\sstyle\s*=\s*["'{]/` requires `style=`
 * preceded by whitespace (so it cannot match inside a longer attribute/class name
 * like `data-style=` or the substring "style" inside a comment or class list) and
 * followed by a quote or `{` (a bound attribute, `style={...}`, is exactly as
 * forbidden as a literal one). This does not attempt to parse Svelte's template
 * grammar — a `style` word appearing outside a tag-opening position (e.g. as plain
 * prose text) could in principle false-positive, but that pattern does not occur in
 * this codebase (verified by inspecting the matches below whenever this test fails).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../src');
const INLINE_STYLE_RE = /\sstyle\s*=\s*["'{]/;

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

describe('no inline style= attributes under src/', () => {
	const svelteFiles = listSvelteFiles(SRC_DIR);

	it('finds a non-trivial number of .svelte files to check (sanity check on the walk itself)', () => {
		expect(svelteFiles.length).toBeGreaterThan(10);
	});

	it('contains no `style=` attribute in any .svelte file (Requirement 17.13 / production CSP)', () => {
		const offenders: string[] = [];
		for (const file of svelteFiles) {
			const content = readFileSync(file, 'utf8');
			if (INLINE_STYLE_RE.test(content)) offenders.push(file);
		}
		expect(offenders, `files with an inline style= attribute: ${offenders.join(', ')}`).toEqual([]);
	});
});
