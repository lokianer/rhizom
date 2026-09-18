import { defineConfig, devices } from '@playwright/test';

// CI has already run `pnpm run build`, so the production bundle is tested through
// `vite preview`. Locally the dev server is used and reused if it is already running.
const isCI = Boolean(process.env.CI);
const port = isCI ? 4173 : 5173;
// 127.0.0.1 on both sides avoids the localhost IPv4/IPv6 mismatch; --strictPort keeps Vite
// from moving to another port, which would make `url` never become ready.
const baseURL = `http://127.0.0.1:${String(port)}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['html']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: isCI
      ? `pnpm exec vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`
      : `pnpm exec vite --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
