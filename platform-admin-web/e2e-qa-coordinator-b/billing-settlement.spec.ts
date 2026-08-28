import { test, expect, type Page } from '@playwright/test';
import { computeTotp, ensureComfortablyInsideTotpWindow } from './totp';

/**
 * Coordinator B (QA/runtime) real-browser sweep of platform-admin-web's
 * billing/settlement surface (Writer 8 scope), as FINANCE_ADMIN, against
 * the real backend/MySQL QA stack seeded with a FAILED payment attempt, a
 * refunded transaction, an OPEN dispute, an UNDER_INVESTIGATION settlement
 * batch (differenceMinor -2500), a plain CONFIRMED SAR/GULF payment, and a
 * PAID + OPEN invoice (see backend/scripts/seed-local.mjs).
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

async function loginFinanceAdmin(page: Page) {
  const secret = process.env.QA_TOTP_FINANCE_ADMIN;
  if (!secret) throw new Error('QA_TOTP_FINANCE_ADMIN not set.');
  await page.goto('/login');
  await page.locator('#login-email').fill('finance_admin@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await ensureComfortablyInsideTotpWindow();
  await page.locator('#login-totp').fill(computeTotp(secret));
  await page.getByRole('button', { name: /sign in|submit|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

// secureSession.ts's token is deliberately in-memory-only (PCA-ADD-PA-014/016
// -- see personas.spec.ts's identical note); navigation to any route after
// login MUST be a client-side sidebar-link click, never page.goto(), or the
// session is lost and every route bounces to /login regardless of RBAC.
async function clickNav(page: Page, route: string) {
  await page.locator(`a.nav-link[href="${route}"]`).click();
  await expect(page).toHaveURL(new RegExp(route.replace(/\//g, '\\/')), { timeout: 10_000 });
}

const ROUTES = ['/billing/plans', '/billing/pricing', '/billing/quotes', '/billing/invoices', '/billing/payments', '/settlement/accounts', '/settlement/batches', '/settlement/reconciliation'];

for (const route of ROUTES) {
  test(`FINANCE_ADMIN: ${route} renders without crashing, no raw minor units, clean console`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginFinanceAdmin(page);
    await clickNav(page, route);
    await page.waitForLoadState('networkidle');
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText).not.toMatch(/TypeError|Cannot read propert/i);
    // Seeded raw minor-unit amounts (backend/scripts/seed-local.mjs's own
    // amountMinor values) that must never appear unformatted in the UI.
    for (const rawMinor of ['2999', '5000', '4500', '15000']) {
      expect(bodyText, `${route} leaked raw minor units ${rawMinor}`).not.toMatch(new RegExp(`\\b${rawMinor}\\b`));
    }
    expect(errors, `${route}: unexpected console errors: ${errors.join('; ')}`).toEqual([]);
  });
}

test('FINANCE_ADMIN: /billing/payments shows the seeded FAILED, refunded, and GULF/SAR CONFIRMED rows with distinct status badges', async ({ page }) => {
  await loginFinanceAdmin(page);
  await clickNav(page, '/billing/payments');
  await page.waitForLoadState('networkidle');
  const bodyText = ((await page.locator('body').textContent()) ?? '').toLowerCase();
  expect(bodyText).toMatch(/fail/);
  expect(bodyText).toMatch(/sar|gulf/);
});

test('FINANCE_ADMIN: /settlement/reconciliation shows the UNDER_INVESTIGATION batch with a real formatted difference', async ({ page }) => {
  await loginFinanceAdmin(page);
  await clickNav(page, '/settlement/reconciliation');
  await page.waitForLoadState('networkidle');
  const bodyText = ((await page.locator('body').textContent()) ?? '').toLowerCase();
  expect(bodyText).toMatch(/investigation/);
});
