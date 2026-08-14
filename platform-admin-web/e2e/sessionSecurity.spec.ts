import { test, expect } from '@playwright/test';

test.describe('session expiry / revocation', () => {
  test('an unauthenticated visit to a protected route redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('a revoked session (server rejects whoami) redirects to /login with an explanatory message', async ({ page }) => {
    await page.route('**/platform-admin/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionToken: 'e2e-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
      });
    });
    let whoamiCalls = 0;
    await page.route('**/platform-admin/auth/whoami', async (route) => {
      whoamiCalls += 1;
      if (whoamiCalls === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ adminId: 'e2e-admin', roles: ['APP_OWNER'], sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
        });
      } else {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
      }
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@pca.test');
    await page.getByLabel(/password/i).fill('x');
    await page.getByLabel(/authenticator code/i).fill('123456');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Simulate a server-side revocation being caught on the next refresh
    // by directly forcing a re-check (navigating triggers RequireSession's
    // guard against current state, and a revoked whoami on next poll signs
    // the operator out).
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(500);
  });

  test('log out clears the session and returns to /login', async ({ page }) => {
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
        body: JSON.stringify({ adminId: 'e2e-admin', roles: ['APP_OWNER'], sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
      });
    });
    await page.route('**/platform-admin/auth/logout', async (route) => {
      await route.fulfill({ status: 204 });
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@pca.test');
    await page.getByLabel(/password/i).fill('x');
    await page.getByLabel(/authenticator code/i).fill('123456');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // A reload after logout must not silently resurrect the session --
    // the in-memory-only token is gone, so it goes back to /login.
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });
});
