import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		include: ['test/**/*.test.ts'],
		exclude: ['**/cli.test.ts', '**/node_modules/**'],
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
