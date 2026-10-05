import { defineConfig, devices } from '@playwright/test';

const e2ePort = 4002;
const e2eOutDir = 'dist-e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build a dedicated fixture artifact and serve it away from the Parent
    // localhost preview. Reusing :4000 can silently test a real-mode or stale
    // build, and rebuilding the normal dist directory can change the app
    // already being viewed there. All regular E2E specs use explicit demo
    // fixtures; real-backend browser tests have their own config.
    command: `npm run build -- --outDir ${e2eOutDir} && npx vite preview --host localhost --port ${e2ePort} --outDir ${e2eOutDir}`,
    url: `http://localhost:${e2ePort}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_PCA_DEMO_MODE: 'true',
      VITE_PCA_API_BASE_URL: 'http://localhost:4001',
      VITE_PCA_CHILD_APP_DISTRIBUTION_URL: '',
    },
  },
});
