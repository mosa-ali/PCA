import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Production build + preview, not `vite dev`: under this suite's
    // fullyParallel worker load, the dev server's on-demand/HMR module
    // compilation for each first-hit route caused intermittent timeouts on
    // otherwise-correct assertions (observed directly: the same specs that
    // failed here passed reliably in isolation) -- a real flakiness source
    // from cold-compile latency under concurrency, not a product or test
    // defect. The prebuilt preview server serves static assets with no
    // per-request compile step, removing that variable entirely.
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
