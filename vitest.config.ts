import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'domain',
					environment: 'node',
					include: ['tests/lib/server/domain/**/*.test.ts', 'tests/lib/viz/**/*.test.ts']
				}
			},
			{
				extends: true,
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/lib/server/**/*.test.ts', 'tests/api/**/*.test.ts'],
					exclude: ['tests/lib/server/domain/**'],
					setupFiles: ['tests/setup/db.ts'],
					// Vitest 4 dropped `poolOptions.threads.singleThread`; this is the
					// top-level replacement (see the migration guide). The suites in this
					// project share one database and truncate between tests, so parallel
					// files would truncate each other's fixtures.
					fileParallelism: false
				}
			},
			{
				extends: true,
				test: {
					name: 'components',
					environment: 'jsdom',
					include: [
						'tests/modules/**/*.test.ts',
						'tests/lib/theme/**/*.test.ts',
						'tests/lib/ui/**/*.test.ts',
						'tests/lib/*.test.ts'
					],
					setupFiles: ['tests/setup/dom.ts']
				}
			}
		]
	}
});
