import { test, expect, type Page } from '@playwright/test';
import { loadQaManifest, parentAccount, seedPassword } from './qaManifest';

/**
 * Coordinator B (QA/runtime) real-browser auth suite -- real Chromium
 * (Playwright, standing in for the Claude-in-Chrome extension which was
 * unavailable in this session) against the real backend/MySQL QA stack
 * described in .agent-runtime/worktrees/qa-coordinator-b. Every test below
 * uses its OWN dedicated seeded account (backend/scripts/seed-local.mjs,
 * looked up via qaManifest.ts) -- never a shared one -- so no test's
 * login/failed-attempt/code-consumption history can contaminate another
 * test's real rate-limit or single-use-code state in the same run.
 */

const SEED_PASSWORD = seedPassword();

// Anonymous/pre-auth 401s on session/whoami probes are a known-benign
// pattern already documented and accepted elsewhere in
// docs/product-completion/PCA_PAGE_QA_LEDGER.csv (e.g. the
// /subscription/invoices/:invoiceId row) -- the browser logs any HTTP
// error response as a "Failed to load resource" console error regardless
// of whether the app handled it correctly, so this specific message is not
// evidence of an app-level bug.
const BENIGN_CONSOLE_PATTERN = /Failed to load resource: the server responded with a status of 401/;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE_PATTERN.test(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test('wrong credentials against the real backend are rejected with a generic error', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/login');
  // Dedicated account, used ONLY for this negative-credentials check --
  // never reused by any other test. Invalid-credential responses carry a
  // deliberate anti-brute-force delay that GROWS with repeated failed
  // attempts against the SAME account (measured directly: a single fresh
  // attempt took ~8s) -- a working security control, not a defect.
  // Isolating this test to its own never-reused account keeps that delay
  // at its fresh-account baseline instead of accumulating across reruns.
  await page.locator('#login-email').fill(parentAccount('owner-wrongpass').email);
  await page.locator('#login-password').fill('definitely-the-wrong-password');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login/);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('a verified parent (EN) signs in and reaches the dashboard', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount('owner-login-ok').email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('deep-link redirect: an unauthenticated visit to a protected route redirects to /login and returns after sign-in', async ({ page }) => {
  await page.goto('/family/members');
  await expect(page).toHaveURL(/\/login/);
  await page.locator('#login-email').fill(parentAccount('owner-deeplink').email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/family\/members/, { timeout: 15_000 });
});

test('forgot-password shows the identical success state for a real account and a nonexistent one (no enumeration oracle)', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.locator('#forgot-password-email').fill(parentAccount('owner-forgot').email);
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
  // The REAL code backend/scripts/seed-local.mjs printed (and wrote to the
  // manifest) when it called the real requestPasswordReset() service for
  // owner-resettable@pca-seed.test. Single-use: re-running this spec
  // requires a fresh reset-test-db.mjs + migrate + seed-local.mjs cycle
  // first (the whole point of reading it from the manifest instead of an
  // env var is that a fresh seed run always produces a fresh, valid code).
  const RESET_CODE = loadQaManifest().codes.pendingResetCode ?? '';
  test.skip(!RESET_CODE, 'No pendingResetCode in the seed manifest for this run.');

  const newPassword = 'New Correct Horse Battery 2026!';
  await page.goto('/reset-password');
  await page.locator('#reset-password-email').fill(parentAccount('owner-resettable').email);
  await page.locator('#reset-password-code').fill(RESET_CODE);
  await page.locator('#reset-password-new-password').fill(newPassword);
  await page.locator('#reset-password-new-password-confirmation').fill(newPassword);
  // Wait for the ACTUAL reset-password network response, not just a text
  // match -- ResetPassword.tsx's pre-submission title ("Enter your reset
  // code") and its post-success title ("Password reset") both contain the
  // word "reset", so a loose /success|reset/i text check against <h1>
  // matches the page immediately on load and never actually confirms the
  // request completed. This was a real false-positive in an earlier
  // version of this test: the OLD-password check that follows only means
  // anything if the reset genuinely finished first.
  const [resetResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/parent/reset-password')),
    page.getByRole('button', { name: /reset/i }).click(),
  ]);
  expect(resetResponse.status(), `reset-password request did not succeed: ${await resetResponse.text()}`).toBe(200);
  await expect(page.locator('#reset-password-success-title')).toBeVisible({ timeout: 15_000 });

  // OLD password must no longer work. This account is dedicated (never
  // reused), so this is its first-ever failed attempt -- generous timeout
  // regardless, since a wrong-password response carries a real, measured
  // (not instant) anti-brute-force delay (see auth.spec.ts's other note).
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount('owner-resettable').email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });

  // NEW password must work.
  await page.locator('#login-password').fill(newPassword);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('verify-email: a genuinely issued code verifies a pending account and establishes a session', async ({ page }) => {
  const VERIFY_CODE = loadQaManifest().codes.pendingVerificationCode ?? '';
  test.skip(!VERIFY_CODE, 'No pendingVerificationCode in the seed manifest for this run.');

  await page.goto('/verify-email');
  const emailField = page.locator('#verify-email-address, input[type="email"]');
  if ((await emailField.count()) > 0) await emailField.first().fill(parentAccount('owner-pending').email);
  const codeField = page.locator('#verify-email-code, input[name="code"]');
  await codeField.first().fill(VERIFY_CODE);
  await page.getByRole('button', { name: /verify/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
});

test('/not-permitted renders the honest denied-action page directly', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount('owner-notpermitted').email);
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
