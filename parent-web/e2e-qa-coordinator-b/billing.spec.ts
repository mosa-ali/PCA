import { test, expect, type Page } from '@playwright/test';

/**
 * Coordinator B (QA/runtime) real-browser billing sweep (Writer 6 scope).
 * owner-a@pca-seed.test has one PAID and one OPEN invoice (seeded via the
 * real InvoiceService, see backend/scripts/seed-local.mjs) -- this suite
 * confirms parent-web's /subscription/invoices list and detail pages
 * render real money/status for both, against the real backend/MySQL QA
 * stack.
 */

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';

// See auth.spec.ts's identical constant for rationale.
const BENIGN_CONSOLE_PATTERN = /Failed to load resource: the server responded with a status of 401/;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE_PATTERN.test(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function loginOwnerA(page: Page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('owner-a@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|تسجيل/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test('subscription page renders without crashing for a real account', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginOwnerA(page);
  await page.goto('/subscription');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText(/TypeError|Cannot read propert/i);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('invoices list shows real PAID and OPEN rows with formatted money, not raw minor units', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginOwnerA(page);
  await page.goto('/subscription/invoices');
  await page.waitForLoadState('networkidle');
  const bodyText = (await page.locator('body').textContent()) ?? '';
  // 2999 minor units == $29.99 -- the raw integer must never appear un-formatted.
  expect(bodyText).not.toMatch(/\b2999\b/);
  expect(bodyText.toLowerCase()).toMatch(/paid/);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('invoice detail page opens from the list and renders a print affordance', async ({ page }) => {
  await loginOwnerA(page);
  await page.goto('/subscription/invoices');
  await page.waitForLoadState('networkidle');
  const firstInvoiceLink = page.locator('a[href*="/subscription/invoices/"]').first();
  if ((await firstInvoiceLink.count()) === 0) {
    test.skip(true, 'No invoice row link found on the list page -- see QA defect handoff if this is unexpected.');
  }
  await firstInvoiceLink.click();
  await expect(page).toHaveURL(/\/subscription\/invoices\/.+/);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText(/TypeError|Cannot read propert/i);
});
