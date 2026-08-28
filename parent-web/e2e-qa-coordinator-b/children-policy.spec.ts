import { test, expect, type Page } from '@playwright/test';

/**
 * Coordinator B (QA/runtime) real-browser sweep of child/policy routes
 * (Writer 4 scope). @pca/parent-sdk-browser-runtime's crypto gate is
 * hardcoded NOT_READY_CRYPTO_REVIEW pending human security review (see
 * that package's own header), so real device/child data is an EXTERNAL
 * GATE here, not a defect -- this suite asserts the honest-blocked-state
 * contract (no crash, no raw stack trace, clean console) rather than
 * asserting real child data renders.
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

async function loginOwnerB(page: Page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-b@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

const ROUTES = ['/dashboard', '/children', '/requests', '/family/members', '/family/roles', '/family/devices', '/security/status', '/security/trusted-browser', '/notifications'];

for (const route of ROUTES) {
  test(`${route}: renders an honest state with no crash and a clean console`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginOwnerB(page);
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/TypeError|ReferenceError|Cannot read propert|unhandled/i);
    expect(errors, `${route}: unexpected console errors: ${errors.join('; ')}`).toEqual([]);
  });
}
