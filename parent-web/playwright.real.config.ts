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
  // A committed machine-readable artifact, not just console output. PPR-1's adversarial pass
  // ruled that PARENT_REAL_E2E / PLATFORM_ADMIN_REAL_E2E were unsupported precisely because a
  // list reporter leaves nothing a release-gate script can read -- the same evidentiary class
  // as the Android test count that was deleted for having no backing artifact.
  reporter: [['list'], ['json', { outputFile: 'test-results/real-e2e-results.json' }]],
  timeout: 60_000,
  // 15s, not Playwright's 5s default: mirrors
  // platform-admin-web/playwright.real.config.ts's identical, already-
  // documented reasoning -- individual assertions here (e.g. the
  // post-login toHaveURL(/\/dashboard$/) in each spec's signIn() helper)
  // wait on a REAL round trip through a real Fastify backend and real
  // MySQL, not a mock. Confirmed in direct reproduction: a signIn() that
  // timed out at the 5s default passed immediately on an isolated re-run
  // of the exact same test against the exact same account/backend, with
  // no code change -- pure real-network/dev-server latency under host
  // load, not a product defect.
  expect: { timeout: 15_000 },
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
