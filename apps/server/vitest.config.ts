import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
