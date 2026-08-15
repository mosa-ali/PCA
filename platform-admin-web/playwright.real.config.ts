import { defineConfig, devices } from '@playwright/test';

// Real-backend E2E config (mission "Real E2E required (not mocked-only)").
// Separate from playwright.config.ts (which drives the HTTP-boundary-mocked
// suite in e2e/*.spec.ts) so the two never share a dev-server port or
// environment. This config's webServer starts Vite pointed at a REAL
// Fastify backend process (see e2e/realBackend.spec.ts's header for the
// exact setup this expects) via VITE_PCA_PLATFORM_ADMIN_API_BASE_URL,
// supplied by the caller's environment -- never hardcoded here.
export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
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
