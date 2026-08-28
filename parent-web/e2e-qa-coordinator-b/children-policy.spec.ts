import { test, expect, type Page } from '@playwright/test';

/**
 * Coordinator B (QA/runtime) real-browser sweep of child/policy routes
 * (Writer 4 scope). @pca/parent-sdk-browser-runtime's crypto gate is
 * hardcoded NOT_READY_CRYPTO_REVIEW pending human security review (see
 * that package's own header), so real device/child data is an EXTERNAL
 * GATE here, not a defect -- this suite asserts the honest-blocked-state
 * contract (no crash, no raw stack trace, clean console) rather than
 * asserting real child data renders.
 *
 * ONE login for the whole route sweep (parent-web uses a real, cookie-
 * backed session -- unlike platform-admin-web's in-memory-only token, a
 * hard page.goto() keeps the session, so nothing is lost by not
 * re-logging in per route). This also keeps owner-b@pca-seed.test's real
 * LOGIN_EMAIL_RATE_LIMIT budget (10/15min, backend/src/parentaccount/
 * policy.ts) from being burned by this one spec file alone.
 */

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';

// See parent-web/e2e-qa-coordinator-b/auth.spec.ts's identical constant for rationale.
const BENIGN_CONSOLE_PATTERN = /Failed to load resource: the server responded with a status of 401/;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE_PATTERN.test(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

const ROUTES = ['/dashboard', '/children', '/requests', '/family/members', '/family/roles', '/family/devices', '/security/status', '/security/trusted-browser', '/notifications'];

test('owner-b: every child/policy route renders an honest state with no crash and a clean console -- one real session', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-b@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  for (const route of ROUTES) {
    await test.step(route, async () => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Cannot read propert|unhandled/i);
    });
  }

  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});
