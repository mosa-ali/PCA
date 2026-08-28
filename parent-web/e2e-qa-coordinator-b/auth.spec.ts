import { test, expect, type Page } from '@playwright/test';

/**
 * Coordinator B (QA/runtime) real-browser auth suite -- real Chromium
 * (Playwright, standing in for the Claude-in-Chrome extension which was
 * unavailable in this session) against the real backend/MySQL QA stack
 * described in .agent-runtime/worktrees/qa-coordinator-b. Seeded fixtures
 * come from backend/scripts/seed-local.mjs (SEED_PASSWORD constant below
 * must match the script's own).
 */

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test('wrong credentials against the real backend are rejected with a generic error', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-b@pca-seed.test');
  await page.locator('#login-password').fill('definitely-the-wrong-password');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('a verified parent (EN) signs in and reaches the dashboard', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-b@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('deep-link redirect: an unauthenticated visit to a protected route redirects to /login and returns after sign-in', async ({ page }) => {
  await page.goto('/family/members');
  await expect(page).toHaveURL(/\/login/);
  await page.locator('#login-email').fill('owner-b@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/family\/members/, { timeout: 15_000 });
});

test('forgot-password shows the identical success state for a real account and a nonexistent one (no enumeration oracle)', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.locator('#forgot-password-email').fill('owner-b@pca-seed.test');
  await page.getByRole('button', { name: /reset|send/i }).click();
  const realAccountHeading = await page.locator('h1').textContent();

  await page.goto('/forgot-password');
  await page.locator('#forgot-password-email').fill('definitely-not-a-seeded-account@pca-seed.test');
  await page.getByRole('button', { name: /reset|send/i }).click();
  const nonexistentHeading = await page.locator('h1').textContent();

  expect(nonexistentHeading).toEqual(realAccountHeading);
});

test('reset-password: a genuinely issued code sets a new password, and the OLD password stops working', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  // Code below is the REAL code backend/scripts/seed-local.mjs printed when it
  // called the real requestPasswordReset() service for owner-resettable@pca-seed.test
  // -- see docs/product-completion/PCA_QA_DEFECT_HANDOFF.md / this session's
  // seed run log for provenance. Single-use: re-running this spec requires a
  // fresh `node scripts/reset-test-db.mjs && npm run db:migrate && node
  // scripts/seed-local.mjs` cycle first.
  const RESET_CODE = process.env.QA_RESET_CODE ?? '';
  test.skip(!RESET_CODE, 'QA_RESET_CODE not supplied for this run.');

  const newPassword = 'New Correct Horse Battery 2026!';
  await page.goto('/reset-password');
  await page.locator('#reset-password-email').fill('owner-resettable@pca-seed.test');
  await page.locator('#reset-password-code').fill(RESET_CODE);
  await page.locator('#reset-password-new-password').fill(newPassword);
  await page.locator('#reset-password-new-password-confirmation').fill(newPassword);
  await page.getByRole('button', { name: /reset/i }).click();
  await expect(page.locator('h1')).toContainText(/success|reset/i, { timeout: 15_000 });

  // OLD password must no longer work.
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-resettable@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  // NEW password must work.
  await page.locator('#login-password').fill(newPassword);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('verify-email: a genuinely issued code verifies a pending account and establishes a session', async ({ page }) => {
  const VERIFY_CODE = process.env.QA_VERIFY_CODE ?? '';
  test.skip(!VERIFY_CODE, 'QA_VERIFY_CODE not supplied for this run.');

  await page.goto('/verify-email');
  const emailField = page.locator('input[type="email"], #verify-email-email, #email');
  if (await emailField.count() > 0) await emailField.first().fill('owner-pending@pca-seed.test');
  const codeField = page.locator('#verify-email-code, input[name="code"]');
  await codeField.first().fill(VERIFY_CODE);
  await page.getByRole('button', { name: /verify/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
});

test('/not-permitted renders the honest denied-action page directly', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-b@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.goto('/not-permitted');
  await expect(page.locator('body')).not.toContainText(/Cannot GET|stack trace|TypeError/i);
});

test('an unknown route renders a real 404 page, not a crash', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/this-route-does-not-exist-qa-b');
  await expect(page.locator('body')).not.toContainText(/Cannot GET|TypeError|ReferenceError/i);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});
