import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
    // Component/RBAC/RTL/a11y tests in this suite exercise the
    // DEVELOPMENT_ONLY fixture clients pervasively (dev screen-time
    // fixtures, DevTrustedBrowserProvider, DevRuntimeSyncClient, etc.) --
    // matching the documented dev-time default in .env.example. Tests that
    // specifically need to exercise the demo-mode-off / real-client path
    // (see tests/unit/apiClientFactory.test.ts) explicitly mock
    // src/config/env to override this per-test.
    env: {
      VITE_PCA_DEMO_MODE: 'true',
    },
  },
});
