/**
 * Walks the import graph and enforces the Module Boundaries table: `domain -> core ->
 * store -> services -> routes`, each layer importing only to its left, plus the
 * separate rule that `002-worklog-ui` may reach `src/lib/server/` only through
 * `services` or `store`, and only from a `+page.server.ts`, a `+server.ts` or a
 * `modules/*\/actions.ts` (Requirements 6.1, 6.2). Uses the TypeScript compiler API to
 * read real import/export/dynamic-import declarations rather than a regex, so a
 * multi-line or type-only import is never missed or misread as prose in a comment.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, relative } from 'node:path';
import ts from 'typescript';

const SRC = resolvePath(__dirname, '../../../src');

function walk(dir: string, extensions: string[]): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...walk(full, extensions));
		} else if (extensions.some((ext) => entry.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

type ImportInfo = { specifier: string; identifiers: string[] };

/** Every import/export-from/dynamic-import specifier in a file, via the TS AST — never a regex. */
function importsOf(file: string): ImportInfo[] {
	const content = readFileSync(file, 'utf8');
	const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
	const out: ImportInfo[] = [];

	function namedBindingsOf(node: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
		const names: string[] = [];
		if (ts.isImportDeclaration(node) && node.importClause) {
			const clause = node.importClause;
			if (clause.name) names.push(clause.name.text);
			if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
				for (const el of clause.namedBindings.elements) names.push(el.name.text);
			}
		}
		if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
			for (const el of node.exportClause.elements) names.push(el.name.text);
		}
		return names;
	}

	function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const spec = node.moduleSpecifier;
			if (spec && ts.isStringLiteral(spec)) {
				out.push({ specifier: spec.text, identifiers: namedBindingsOf(node) });
			}
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			out.push({ specifier: node.arguments[0].text, identifiers: [] });
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return out;
}

/** Every bare `RequestEvent` identifier reference anywhere in the file (never inside a comment — the AST has none). */
function referencesRequestEvent(file: string): boolean {
	const content = readFileSync(file, 'utf8');
	const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
	let found = false;
	function visit(node: ts.Node) {
		if (found) return;
		if (ts.isIdentifier(node) && node.text === 'RequestEvent') {
			found = true;
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return found;
}

const REPO_ROOT = resolvePath(__dirname, '../../..');

/** Resolves a specifier to a repo-relative path (forward slashes; this project only runs on POSIX). */
function resolveSpecifier(file: string, specifier: string): string {
	if (specifier.startsWith('.')) {
		const abs = resolvePath(dirname(file), specifier);
		return relative(REPO_ROOT, abs);
	}
	if (specifier.startsWith('$lib/')) {
		return `src/lib/${specifier.slice('$lib/'.length)}`;
	}
	return specifier; // bare package specifier, or $env/$app
}

function isUnder(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

const FORBIDDEN_BARE = ['drizzle-orm', '$env', '$app', '@sveltejs/kit'];

function bareViolation(specifier: string): string | null {
	return FORBIDDEN_BARE.find((p) => specifier === p || specifier.startsWith(`${p}/`)) ?? null;
}

describe('module boundaries: src/lib/server/domain', () => {
	const files = walk(join(SRC, 'lib/server/domain'), ['.ts']);
	it('has files to check (the guard is not vacuous)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC, file);
		it(`${rel} imports nothing from core/store/services and no Drizzle/$env/$app/SvelteKit`, () => {
			for (const { specifier } of importsOf(file)) {
				const resolved = resolveSpecifier(file, specifier);
				const bare = bareViolation(specifier);
				expect(bare, `${rel} imports forbidden package '${specifier}'`).toBeNull();
				for (const forbidden of [
					'src/lib/server/core',
					'src/lib/server/store',
					'src/lib/server/services'
				]) {
					expect(
						isUnder(resolved, forbidden),
						`${rel} imports '${specifier}' -> ${resolved}, which is under ${forbidden}`
					).toBe(false);
				}
			}
		});
	}
});

describe('module boundaries: src/lib/server/core', () => {
	const files = walk(join(SRC, 'lib/server/core'), ['.ts']);
	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC, file);
		it(`${rel} imports nothing from domain/store/services`, () => {
			for (const { specifier } of importsOf(file)) {
				const resolved = resolveSpecifier(file, specifier);
				for (const forbidden of [
					'src/lib/server/domain',
					'src/lib/server/store',
					'src/lib/server/services'
				]) {
					expect(
						isUnder(resolved, forbidden),
						`${rel} imports '${specifier}' -> ${resolved}, which is under ${forbidden}`
					).toBe(false);
				}
			}
		});
	}
});

describe('module boundaries: src/lib/server/store', () => {
	const files = walk(join(SRC, 'lib/server/store'), ['.ts']);
	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC, file);
		it(`${rel} imports nothing from services and names no RequestEvent`, () => {
			for (const { specifier } of importsOf(file)) {
				const resolved = resolveSpecifier(file, specifier);
				expect(
					isUnder(resolved, 'src/lib/server/services'),
					`${rel} imports '${specifier}' -> ${resolved}, which is under services`
				).toBe(false);
			}
			expect(referencesRequestEvent(file), `${rel} names RequestEvent`).toBe(false);
		});
	}
});

describe('module boundaries: src/lib/server/services', () => {
	const files = walk(join(SRC, 'lib/server/services'), ['.ts']);
	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC, file);
		it(`${rel} imports nothing from routes and names no RequestEvent`, () => {
			for (const { specifier } of importsOf(file)) {
				const resolved = resolveSpecifier(file, specifier);
				expect(
					isUnder(resolved, 'src/routes'),
					`${rel} imports '${specifier}' -> ${resolved}, which is under routes`
				).toBe(false);
			}
			expect(referencesRequestEvent(file), `${rel} names RequestEvent`).toBe(false);
		});
	}
});

describe('module boundaries: src/lib/contracts (browser-safe)', () => {
	const files = walk(join(SRC, 'lib/contracts'), ['.ts']);
	it('has files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC, file);
		it(`${rel} imports nothing from lib/server, $env, $app, Drizzle or SvelteKit`, () => {
			for (const { specifier } of importsOf(file)) {
				const resolved = resolveSpecifier(file, specifier);
				const bare = bareViolation(specifier);
				expect(bare, `${rel} imports forbidden package '${specifier}'`).toBeNull();
				expect(
					isUnder(resolved, 'src/lib/server'),
					`${rel} imports '${specifier}' -> ${resolved}, which is under src/lib/server`
				).toBe(false);
			}
		});
	}
});

// --- The 002-worklog-ui boundary --------------------------------------------------
// domain and core may never be reached from the interface: `002` may only go through
// `services` or `store`, and only from one of three file kinds. Everything else under
// `lib/components` (002's design system directory) or `src/modules/` may not reach
// `src/lib/server/` at all. Neither directory holds any file yet, so these checks are
// not vacuous only once 002 exists — they still run over `src/routes/login` and
// `src/routes/logout`, which already exist and already exercise the rule.

function isExceptionFile(relPath: string): boolean {
	const base = relPath.split('/').pop() ?? '';
	if (base === '+page.server.ts' || base === '+server.ts') return true;
	// modules/<feature>/actions.ts
	const parts = relPath.split('/');
	return parts[0] === 'modules' && base === 'actions.ts';
}

function checkUiBoundaryFile(file: string, relToSrc: string) {
	const exception = isExceptionFile(relToSrc);
	for (const { specifier } of importsOf(file)) {
		const resolved = resolveSpecifier(file, specifier);
		if (!isUnder(resolved, 'src/lib/server')) continue;
		expect(
			exception,
			`${relToSrc} imports '${specifier}' -> ${resolved}, but only +page.server.ts, +server.ts and modules/*/actions.ts may import from src/lib/server at all`
		).toBe(true);
		const allowed =
			isUnder(resolved, 'src/lib/server/services') || isUnder(resolved, 'src/lib/server/store');
		expect(
			allowed,
			`${relToSrc} imports '${specifier}' -> ${resolved}, which is neither services nor store`
		).toBe(true);
	}
}

describe('module boundaries: the 002-worklog-ui boundary', () => {
	const nonApiRouteFiles = walk(join(SRC, 'routes'), ['.ts', '.svelte']).filter(
		(f) => !relative(join(SRC, 'routes'), f).startsWith('api/')
	);
	const componentFiles = walk(join(SRC, 'lib/components'), ['.ts', '.svelte']);
	const moduleFiles = walk(join(SRC, 'modules'), ['.ts', '.svelte']);

	it('non-api routes reach src/lib/server only through services or store, and only from the three named file kinds', () => {
		for (const file of nonApiRouteFiles) {
			checkUiBoundaryFile(file, relative(SRC, file));
		}
	});

	it('src/lib/components reaches src/lib/server only through services or store, and only from the three named file kinds', () => {
		for (const file of componentFiles) {
			checkUiBoundaryFile(file, relative(SRC, file));
		}
	});

	it('src/modules reaches src/lib/server only through services or store, and only from the three named file kinds', () => {
		for (const file of moduleFiles) {
			checkUiBoundaryFile(file, relative(SRC, file));
		}
	});

	it('found the two existing non-api pages (the guard above is not vacuous)', () => {
		const names = nonApiRouteFiles.map((f) => relative(SRC, f));
		expect(names).toContain('routes/login/+page.server.ts');
		expect(names).toContain('routes/logout/+page.server.ts');
	});
});
