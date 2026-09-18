import { defineConfig } from 'vitest/config';

// Root config: declares the projects and holds the root-only options (coverage, reporters).
// A config with `projects` never runs tests itself.
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],

    coverage: {
      provider: 'v8',
      // Without `include`, only files imported by tests are reported; listing the sources
      // makes untested files count against the threshold.
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
      exclude: [
        '**/*.{test,spec}.?(c|m)[jt]s?(x)',
        '**/*.test-d.ts',
        '**/*.d.ts',
        '**/dist/**',
        'apps/web/src/main.tsx',
        'apps/server/src/server.ts',
        'scripts/commit-msg/cli.mjs',
        'scripts/build-site.mjs',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Thresholds are keyed by repo-root-relative globs, so only packages/core is gated;
      // the other projects are reported but never fail the run.
      thresholds: {
        'packages/core/src/**/*.ts': {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  },
});
