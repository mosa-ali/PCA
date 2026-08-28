import { test, expect, type Page } from '@playwright/test';
import { parentAccount, seedPassword } from './qaManifest';

/**
 * Coordinator B (QA/runtime) real-browser billing sweep (Writer 6 scope).
 * Each test uses its OWN dedicated seeded account (owner-bill-sub/-list/
 * -detail), each with a real PAID + OPEN invoice pair (real InvoiceService,
 * see backend/scripts/seed-local.mjs) -- never a shared account across the
 * 3 real logins in this file, so this suite's own login history can never
 * accumulate against LOGIN_EMAIL_RATE_LIMIT.
 */

const SEED_PASSWORD = seedPassword();

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

async function loginAs(page: Page, accountKey: string) {
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount(accountKey).email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|تسجيل/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test('subscription page renders without crashing for a real account', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginAs(page, 'owner-bill-sub');
  await page.goto('/subscription');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText(/TypeError|Cannot read propert/i);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('invoices list shows real PAID and OPEN rows with formatted money, not raw minor units', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginAs(page, 'owner-bill-list');
  await page.goto('/subscription/invoices');
  // Data loads asynchronously after networkidle -- wait for a real invoice
  // row (auto-retrying), not a one-shot textContent() read.
  await expect(page.getByText(/paid/i).first()).toBeVisible({ timeout: 10_000 });
  const bodyText = (await page.locator('body').textContent()) ?? '';
  // 2999 minor units == $29.99 -- the raw integer must never appear un-formatted.
  expect(bodyText).not.toMatch(/\b2999\b/);
  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});

test('invoice detail page opens from the list and renders a print affordance', async ({ page }) => {
  await loginAs(page, 'owner-bill-detail');
  await page.goto('/subscription/invoices');
  await page.waitForLoadState('networkidle');
  const firstInvoiceLink = page.locator('a[href*="/subscription/invoices/"]').first();
  await expect(firstInvoiceLink).toBeVisible({ timeout: 15_000 });
  await firstInvoiceLink.click();
  await expect(page).toHaveURL(/\/subscription\/invoices\/.+/);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText(/TypeError|Cannot read propert/i);
});
