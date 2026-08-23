import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Development is the only environment that relaxes this policy, and it is compared
// against exactly this one literal — never `!== 'production'`, which would ship
// `unsafe-eval` on a typo or an unset variable. svelte.config.js cannot call
// loadConfig() (it runs outside the server runtime), so the default is written here,
// and task 11.1 additionally pins APP_ENV=production in the Docker builder stage so a
// shipped image can never depend on this default.
const isDev = process.env.APP_ENV === 'development';

/** @type {import('@sveltejs/kit').CspDirectives} */
const baseDirectives = {
	'default-src': ['self'],
	'style-src': ['self'],
	// Inter Tight is self-hosted from static/fonts/ — an explicit font-src so a later
	// narrowing of default-src never silently drops the typeface. No directive in any
	// environment names a Google Fonts host.
	'font-src': ['self'],
	'img-src': ['self', 'data:'],
	'connect-src': ['self'],
	'frame-ancestors': ['none'],
	'base-uri': ['none'],
	'form-action': ['self']
};

/** @type {import('@sveltejs/kit').CspDirectives} */
const directives = isDev
	? {
			...baseDirectives,
			'script-src': ['self', 'unsafe-inline', 'unsafe-eval'],
			'style-src': ['self', 'unsafe-inline']
		}
	: {
			...baseDirectives,
			'script-src': ['self']
		};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: true
	},
	kit: {
		adapter: adapter(),
		alias: {
			$db: 'src/db',
			$modules: 'src/modules'
		},
		csp: {
			mode: 'nonce',
			directives
		}
	}
};

export default config;
