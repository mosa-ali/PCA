import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // *.crossclient.test.ts files verify browser output against the COMPILED
    // backend (../backend/dist) and so run only where the backend is built:
    // the CI real-backend E2E job sets PCA_CROSS_CLIENT_VERIFY=1. Everywhere
    // else they are excluded rather than skipped, so no shard reports a skip.
    exclude:
      process.env.PCA_CROSS_CLIENT_VERIFY === '1'
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, 'tests/**/*.crossclient.test.ts'],
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
