import { configDefaults, defineProject } from 'vitest/config';

// `defineProject` rejects root-only options (coverage, reporters) at the type level.
export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
