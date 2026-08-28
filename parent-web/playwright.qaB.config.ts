import { defineConfig, devices } from '@playwright/test';

// Coordinator B (QA/runtime) owned config -- separate from playwright.config.ts
// and playwright.real.config.ts (both product-owned). Points at an
// already-running dev server (started by Coordinator B against an isolated
// QA backend/MySQL stack, see .agent-runtime/worktrees/qa-coordinator-b),
// so no webServer block here -- baseURL only.
export default defineConfig({
  testDir: './e2e-qa-coordinator-b',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'qa-coordinator-b-results.json' }]],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
