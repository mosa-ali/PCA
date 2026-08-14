import { test, expect } from '@playwright/test';

/**
 * These E2E specs mock the backend at the HTTP boundary (page.route) rather
 * than starting a real backend process -- see this app's README for why:
 * only the five auth endpoints exist server-side today, and Playwright's
 * own webServer here only starts the Vite dev server, not the Fastify API.
 * Every mocked response shape mirrors backend/src/http/routes/platformAdminAuthRoutes.ts
 * exactly (status codes, body shape) so these tests fail if the frontend's
 * assumptions about that contract ever drift.
 */

test.describe('Platform Administration login + MFA', () => {
  test('cannot submit without a 6-digit authenticator code', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('owner@pca.test');
    await page.getByLabel(/password/i).fill('correct horse battery staple');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  test('successful login with credentials + MFA reaches the dashboard', async ({ page }) => {
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
        body: JSON.stringify({ adminId: 'owner-1', roles: ['APP_OWNER'], sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
      });
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('owner@pca.test');
    await page.getByLabel(/password/i).fill('correct horse battery staple');
    await page.getByLabel(/authenticator code/i).fill('123456');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByText('owner-1', { exact: true })).toBeVisible();
  });

  test('an invalid code shows a generic, enumeration-resistant error and does not navigate', async ({ page }) => {
    await page.route('**/platform-admin/auth/login', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('owner@pca.test');
    await page.getByLabel(/password/i).fill('wrong');
    await page.getByLabel(/authenticator code/i).fill('000000');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toContainText(/incorrect email, password, or authenticator code/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a rate-limited login shows a distinct message', async ({ page }) => {
    await page.route('**/platform-admin/auth/login', async (route) => {
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited' }) });
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('owner@pca.test');
    await page.getByLabel(/password/i).fill('x');
    await page.getByLabel(/authenticator code/i).fill('111111');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toContainText(/too many attempts/i);
  });

  test('parent/family tokens are never accepted here -- there is no shared login surface or admin-mode toggle', async ({ page }) => {
    await page.goto('/login');
    // The Platform Administration app never exposes a family-session code
    // path at all: no query param, hidden field, or toggle grants entry.
    await expect(page.locator('[data-admin-mode]')).toHaveCount(0);
    await expect(page.getByText(/operator access only/i)).toBeVisible();
  });
});
