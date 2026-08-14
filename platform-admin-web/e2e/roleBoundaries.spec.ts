import { test, expect, type Page } from '@playwright/test';

/**
 * Client-side navigation (no full page reload). The Platform Administration
 * session token is deliberately held in memory only (src/security/secureSession.ts)
 * and never persisted -- a full page.goto() after login would drop it and
 * redirect to /login, which is a different (and separately tested, see
 * e2e/sessionSecurity.spec.ts) scenario than "this role is denied this
 * route while still signed in." Dispatching a real popstate lets React
 * Router's BrowserRouter pick up the URL change the same way a user
 * clicking an in-app link would.
 */
async function goClientSide(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function signInAs(page: Page, roles: string[]) {
  await page.route('**/platform-admin/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionToken: 'e2e-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    });
  });
  await page.route('**/platform-admin/auth/whoami', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ adminId: 'e2e-admin', roles, sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    });
  });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('admin@pca.test');
  await page.getByLabel(/password/i).fill('x');
  await page.getByLabel(/authenticator code/i).fill('123456');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

test.describe('role boundaries (mission Section 24)', () => {
  test('AUDITOR_READ_ONLY: billing (a mutation-capable area) is hidden and blocked; admin-users (view-only per Section 3.7) stays reachable read-only', async ({ page }) => {
    await signInAs(page, ['AUDITOR_READ_ONLY']);

    // Billing has no separate "view" operation in the backend's closed
    // vocabulary (ADMINISTER_BILLING is FINANCE_ADMIN/APP_OWNER only) --
    // AUDITOR_READ_ONLY is correctly denied here, not just hidden from nav.
    await expect(page.getByRole('link', { name: /billing/i })).toHaveCount(0);
    await goClientSide(page, '/billing/payments');
    await expect(page.getByRole('heading', { name: /not permitted/i })).toBeVisible();

    // VIEW_ADMIN_ACCOUNTS is explicitly ALLOW for AUDITOR_READ_ONLY
    // (Section 3.7) -- the nav link IS shown, and the route is reachable
    // (as a read-only COMING_SOON shell today, since no admin-account HTTP
    // endpoint exists yet -- see README BACKEND_GAP_REQUIRED).
    await expect(page.getByRole('link', { name: /admin users/i })).toBeVisible();
    await goClientSide(page, '/admin-users');
    await expect(page.getByRole('heading', { name: /not permitted/i })).toHaveCount(0);
  });

  test('SUPPORT_ADMIN cannot reach finance/billing screens via direct link', async ({ page }) => {
    await signInAs(page, ['SUPPORT_ADMIN']);
    await goClientSide(page, '/billing/invoices');
    await expect(page.getByRole('heading', { name: /not permitted/i })).toBeVisible();
  });

  test('FINANCE_ADMIN cannot reach admin-user role management', async ({ page }) => {
    await signInAs(page, ['FINANCE_ADMIN']);
    await goClientSide(page, '/admin-users');
    await expect(page.getByRole('heading', { name: /not permitted/i })).toBeVisible();
    // But billing IS reachable (as a COMING_SOON shell, since the backend endpoint doesn't exist yet).
    await goClientSide(page, '/billing/invoices');
    await expect(page.getByRole('heading', { name: /not permitted/i })).toHaveCount(0);
  });

  test('PLATFORM_ADMIN cannot reach settlement/refund-adjacent billing screens', async ({ page }) => {
    await signInAs(page, ['PLATFORM_ADMIN']);
    await goClientSide(page, '/billing/payments');
    await expect(page.getByRole('heading', { name: /not permitted/i })).toBeVisible();
  });

  test('APP_OWNER reaches every route without a not-permitted redirect', async ({ page }) => {
    await signInAs(page, ['APP_OWNER']);
    for (const path of ['/accounts', '/entitlements', '/billing/plans', '/admin-users', '/audit', '/settings']) {
      await goClientSide(page, path);
      await expect(page.getByRole('heading', { name: /not permitted/i })).toHaveCount(0);
    }
  });
});
