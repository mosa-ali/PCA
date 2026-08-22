import { defineConfig, devices } from '@playwright/test';

// Real-backend E2E config (mission "Real E2E required (not mocked-only)").
// Separate from playwright.config.ts (which drives the HTTP-boundary-mocked
// suite in e2e/*.spec.ts) so the two never share a dev-server port or
// environment. This config's webServer starts Vite (via `npm run dev`)
// against port 4102; the caller's environment is expected to supply
// VITE_E2E_REAL_PROXY_TARGET (see vite.config.ts's header and
// e2e-real/realBackend.spec.ts's header for the exact setup this expects),
// which vite.config.ts's dev-only proxy uses to forward /platform-admin/*
// to a REAL Fastify backend process same-origin. VITE_PCA_PLATFORM_ADMIN_API_BASE_URL
// must be left UNSET here -- src/config/env.ts's same-origin default is
// what makes this proxying work; setting it to an absolute backend origin
// defeats the proxy and makes the browser call the backend cross-origin,
// which the CORS-less backend always rejects (see src/config/env.ts's
// header for the full explanation and the direct-reproduction confirmation).
export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // 120s, not 60s: the spec now waits for a genuinely fresh TOTP window
  // TWICE (once before the real login, once before the admin-user-creation
  // step-up -- see realBackend.spec.ts's step-up comment for why the second
  // wait was added), and msUntilNextTotpWindow() can take up to ~31.5s each
  // time in the worst case. Two worst-case waits alone (~63s) already
  // exceeded the previous 60s budget in direct reproduction, on top of the
  // suite's other real network round trips.
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4102',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 4102',
    url: 'http://localhost:4102',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
