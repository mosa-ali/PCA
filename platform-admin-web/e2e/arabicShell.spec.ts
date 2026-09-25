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

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const enrollmentLink = page.getByRole('link', { name: 'إدارة التسجيل والاستحقاقات' });
    await expect(enrollmentLink).toBeVisible();
    await expect(page.getByRole('link', { name: 'الحسابات' })).toHaveCount(0);
    await enrollmentLink.click();
    await expect(page.getByRole('heading', { name: 'إدارة التسجيل والاستحقاقات' })).toBeVisible();
    for (const name of ['الحسابات', 'الاستحقاقات', 'طلبات الاستحقاق', 'السعة المجانية']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }

    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('tab', { name: 'الحسابات' })).toBeVisible();
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth, `Arabic shell should not overflow horizontally at ${width}px`).toBeLessThanOrEqual(width);
    }
  });
});
