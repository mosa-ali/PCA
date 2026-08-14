import { test, expect } from '@playwright/test';

test.describe('Arabic / RTL shell', () => {
  test('switching language to Arabic flips document direction and translates the login form', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Language').selectOption('ar');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول إلى إدارة المنصة' })).toBeVisible();
  });

  test('the authenticated shell (sidebar/header) renders RTL-correctly in Arabic', async ({ page }) => {
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

    await page.goto('/login');
    await page.getByLabel('Language').selectOption('ar');
    await page.getByLabel('البريد الإلكتروني').fill('admin@pca.test');
    await page.getByLabel('كلمة المرور').fill('x');
    await page.getByLabel('رمز المصادقة').fill('123456');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'الحسابات' })).toBeVisible();
  });
});
