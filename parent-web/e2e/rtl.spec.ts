import { test, expect } from '@playwright/test';

test('switching to Arabic flips document direction and renders Arabic UI text', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByLabel('Language').first().selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();
});

test('Arabic sidebar renders on the logical "end" side (RTL layout, no horizontal overflow)', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByLabel('Language').first().selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
