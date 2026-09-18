import { defineConfig, devices } from '@playwright/test';

// The tests run against a real Rhizom server on a throwaway copy of the example vault
// (e2e/serve.mjs). In CI that server also serves the built web app, so the production bundle
// and the SPA fallback are what gets tested; locally the Vite dev server proxies /api to it.
const isCI = Boolean(process.env.CI);
// Overridable so the suite can run next to a development server that already holds 3737.
const apiPort = Number(process.env.RHIZOM_E2E_API_PORT ?? 3737);
const devPort = Number(process.env.RHIZOM_E2E_WEB_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${String(isCI ? apiPort : devPort)}`;

const server = {
  command: `node e2e/serve.mjs`,
  url: `http://127.0.0.1:${String(apiPort)}/api/health`,
  env: { PORT: String(apiPort) },
  reuseExistingServer: !isCI,
  timeout: 120_000,
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // The tests share one vault, so they run one after another.
  workers: 1,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['html']],
  use: {
    baseURL,
    // The interface follows the browser language; the tests read English, and the German
    // case switches the language explicitly.
    locale: 'en-US',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isCI
    ? [server]
    : [
        server,
        {
          command: `pnpm exec vite --host 127.0.0.1 --port ${String(devPort)} --strictPort`,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: 'ignore' as const,
          stderr: 'pipe' as const,
        },
      ],
});
