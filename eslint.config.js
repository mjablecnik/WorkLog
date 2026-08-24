import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
	js.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		// `.svelte.ts`/`.svelte.js` are plain TypeScript modules using Svelte 5 runes
		// (`$state`, `$derived`, ...), so the `**/*.{js,ts}` glob already covers them —
		// no svelte-eslint-parser needed, just the TS parser espree can't handle.
		files: ['**/*.{js,ts}'],
		languageOptions: {
			parser: tsParser
		},
		plugins: { '@typescript-eslint': tseslint },
		rules: {
			...tseslint.configs.recommended.rules,
			// TypeScript already catches undefined references, and understands ambient
			// globals (`Bun`, rune macros) that plain `no-undef` cannot.
			'no-undef': 'off',
			// This codebase's existing convention for an intentionally-unused
			// parameter/variable is an underscore prefix (e.g. `_locale`, `_now`).
			'@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }]
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser
			}
		},
		plugins: { '@typescript-eslint': tseslint },
		rules: {
			...tseslint.configs.recommended.rules,
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }]
		}
	},
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'node_modules/',
			'src/lib/paraglide/',
			'playwright-report/',
			'coverage/'
		]
	}
];
