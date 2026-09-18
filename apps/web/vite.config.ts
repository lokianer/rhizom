import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

// One file for Vite and Vitest: the root vitest.config.ts picks it up as the `web` project.
// `defineProject` (a runtime identity) keeps root-only options such as coverage out at the type
// level; Vite reads the result as a normal config.
export default defineProject({
  plugins: [react()],

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 127.0.0.1 rather than localhost: Node may resolve localhost to ::1 first while the
      // API server listens on IPv4 only.
      '/api': {
        target: 'http://127.0.0.1:3737',
        changeOrigin: true,
      },
    },
  },

  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
