import { fileURLToPath } from 'node:url';

import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    // Test against the core sources, not a possibly stale dist/ build.
    alias: {
      '@rhizom/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
