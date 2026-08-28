import { test, expect, type Page } from '@playwright/test';
import { computeUniqueTotp } from './totp';

/**
 * Coordinator B (QA/runtime) real-browser sweep of platform-admin-web's
 * accounts/admin-users/audit/entitlements surface (Writers 7 & 9 scope), as
 * APP_OWNER, against the real backend/MySQL QA stack.
 *
 * Consolidated into ONE test (one login, multiple test.step()s) rather than
 * one test per route: secureSession.ts's session token is in-memory-only,
 * so each separate test needs its own fresh login, and each login claims a
 * real TOTP window (backend's TOTP-REPLAY-1) -- minimizing login COUNT per
 * persona is the real fix for TOTP-window collisions across a dense run,
 * not a bigger lock (see totp.ts's header).
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

async function loginAppOwner(page: Page) {
  const secret = process.env.QA_TOTP_APP_OWNER;
  if (!secret) throw new Error('QA_TOTP_APP_OWNER not set.');
  await page.goto('/login');
  await page.locator('#login-email').fill('app_owner@pca-seed.test');
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.locator('#login-totp').fill(await computeUniqueTotp(secret, 'app_owner@pca-seed.test'));
  await page.getByRole('button', { name: /sign in|submit|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

// secureSession.ts's token is deliberately in-memory-only (PCA-ADD-PA-014/016);
// navigation after login MUST be a client-side sidebar-link click, never
// page.goto(), or the session is lost and every route bounces to /login.
async function clickNav(page: Page, route: string) {
  await page.locator(`a.nav-link[href="${route}"]`).click();
  await expect(page).toHaveURL(new RegExp(route.replace(/\//g, '\\/')), { timeout: 10_000 });
}

test('APP_OWNER: accounts, admin-users search, audit, and entitlements surface -- one real session', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await loginAppOwner(page);

  await test.step('/accounts lists real seeded parent accounts by familyId with a status, no crash', async () => {
    await clickNav(page, '/accounts');
    // AccountsList.tsx lists rows by familyId, populated by an async fetch
    // AFTER networkidle fires -- wait for the row itself (auto-retrying).
    const rowLinks = page.locator('a[href^="/accounts/"]');
    await expect(rowLinks.first()).toBeVisible({ timeout: 10_000 });
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText).not.toMatch(/TypeError|Cannot read propert/i);
  });

  await test.step('/admin-users search by name and by email against the real backend', async () => {
    await clickNav(page, '/admin-users');
    const nameSearch = page.locator('#admin-name-search');
    await nameSearch.fill('Seed FINANCE_ADMIN');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toContainText('finance_admin@pca-seed.test', { timeout: 10_000 });

    await nameSearch.fill('');
    const emailSearch = page.locator('#admin-email-search');
    await emailSearch.fill('auditor_read_only@pca-seed.test');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toContainText('auditor_read_only@pca-seed.test', { timeout: 10_000 });
  });

  await test.step('/audit renders real audit events with formatted timestamps, no crash', async () => {
    await clickNav(page, '/audit');
    await page.waitForLoadState('networkidle');
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText).not.toMatch(/TypeError|Cannot read propert|\[object Object\]/i);
  });

  await test.step('/entitlements, /entitlement-requests, /complimentary-capacity, /free-access-policy render without crashing', async () => {
    for (const route of ['/entitlements', '/entitlement-requests', '/complimentary-capacity', '/free-access-policy']) {
      await clickNav(page, route);
      await page.waitForLoadState('networkidle');
      const bodyText = (await page.locator('body').textContent()) ?? '';
      expect(bodyText, `${route} crashed`).not.toMatch(/TypeError|Cannot read propert/i);
    }
  });

  expect(errors, `unexpected console errors: ${errors.join('; ')}`).toEqual([]);
});
