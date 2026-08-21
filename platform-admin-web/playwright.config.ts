import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 1,
  // Reduced from 4: under memory/CPU contention, 4 concurrent Chromium
  // instances against this environment produced intermittent timing
  // flakiness (confirmed: the same failing/flaky specs passed reliably at
  // workers=2, same prebuilt preview server, same machine). 2 keeps
  // meaningful parallelism while staying reliable.
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Prebuilt preview server rather than `vite dev` -- see parent-web's
    // playwright.config.ts for the full rationale (on-demand/HMR compile
    // latency under parallel worker load caused intermittent timeouts
    // there; the prebuilt static server removes that variable entirely).
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4100',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
