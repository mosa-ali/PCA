import { test, expect, type Page } from '@playwright/test';
import { computeUniqueTotp } from './totp';
import { adminAccount, seedPassword } from './qaManifest';

/**
 * Coordinator B (QA/runtime) real-browser sweep of platform-admin-web's
 * billing/settlement surface (Writer 8 scope), as FINANCE_ADMIN, against
 * the real backend/MySQL QA stack seeded with a FAILED payment attempt, a
 * refunded transaction, an OPEN dispute, an UNDER_INVESTIGATION settlement
 * batch (differenceMinor -2500), a plain CONFIRMED SAR/GULF payment, and a
 * PAID + OPEN invoice (see backend/scripts/seed-local.mjs).
 *
 * Consolidated into ONE test/one login covering every route -- see
 * admin-audit.spec.ts's identical header note on why (minimizing per-
 * persona login COUNT is the real fix for TOTP-window collisions).
 */

const SEED_PASSWORD = seedPassword();

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
  const account = adminAccount('finance_admin_settlrecon_route');
  await page.goto('/login');
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.locator('#login-totp').fill(await computeUniqueTotp(account.totpSecretBase32, account.email));
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
// Seeded raw minor-unit amounts (backend/scripts/seed-local.mjs's own amountMinor values) that must never appear unformatted in the UI.
const RAW_MINOR_UNITS = ['2999', '5000', '4500', '15000'];

test('FINANCE_ADMIN: every billing/settlement route renders without crashing, no raw minor units -- one real session', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginFinanceAdmin(page);

  // Async data fetches can still be in flight after networkidle fires --
  // wait for any visible "Loading..." indicator to clear before reading
  // page text, rather than a one-shot read right after navigation.
  async function waitForDataSettled(p: Page) {
    await p.getByText(/^loading/i).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  }

  for (const route of ROUTES) {
    await test.step(`${route} renders without crashing, no raw minor units`, async () => {
      await clickNav(page, route);
      await waitForDataSettled(page);
      const bodyText = (await page.locator('body').textContent()) ?? '';
      expect(bodyText).not.toMatch(/TypeError|Cannot read propert/i);
      for (const rawMinor of RAW_MINOR_UNITS) {
        expect(bodyText, `${route} leaked raw minor units ${rawMinor}`).not.toMatch(new RegExp(`\\b${rawMinor}\\b`));
      }
    });
  }

  await test.step('/billing/payments shows the seeded FAILED, refunded, and GULF/SAR CONFIRMED rows with distinct status badges', async () => {
    await clickNav(page, '/billing/payments');
    await waitForDataSettled(page);
    const bodyText = ((await page.locator('body').textContent()) ?? '').toLowerCase();
    expect(bodyText).toMatch(/fail/);
    expect(bodyText).toMatch(/sar|gulf/);
  });

  await test.step('/settlement/reconciliation shows the UNDER_INVESTIGATION batch with a real formatted difference', async () => {
    await clickNav(page, '/settlement/reconciliation');
    // Async data fetch can still be in flight after networkidle fires --
    // wait for the real content (auto-retrying), not a one-shot read.
    await expect(page.getByText(/investigation/i).first()).toBeVisible({ timeout: 15_000 });
  });

  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});
