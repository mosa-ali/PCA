import { defineConfig, devices } from '@playwright/test';

// Real-backend E2E config (mission "Real E2E required (not mocked-only)"),
// mirroring platform-admin-web/playwright.real.config.ts's identical
// pattern. Separate from playwright.config.ts (which drives the
// dev-fixture-backed suite in e2e/*.spec.ts under VITE_PCA_DEMO_MODE=true)
// so the two never share a dev-server port or environment. This config's
// webServer starts Vite pointed at a REAL Fastify backend process (see
// e2e-real/realBackend.spec.ts's header for the exact setup this expects)
// via VITE_PCA_DEMO_MODE=false + VITE_E2E_REAL_PROXY_TARGET, both supplied
// by the caller's environment -- never hardcoded here. `vite dev`, not
// build+preview: unlike playwright.config.ts's fullyParallel suite (where
// dev-server cold-compile latency caused real flakiness under concurrency),
// this config runs `workers: 1`/`fullyParallel: false`, so that source of
// flakiness does not apply, and `vite dev` picks up the caller's env vars
// at server start without requiring a separate build step per env change.
export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4002',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // VITE_PCA_DEMO_MODE=false/VITE_PCA_API_BASE_URL/VITE_E2E_REAL_PROXY_TARGET
    // are supplied by the caller's environment (never hardcoded here or in
    // an .env file -- see vite.config.ts's own header), overriding the
    // base .env's VITE_PCA_DEMO_MODE=true for this run only.
    command: 'npm run dev -- --port 4002',
    url: 'http://localhost:4002',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
