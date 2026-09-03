import { test, expect } from '@playwright/test';

/**
 * PPR-2 owner decision: the header's "Download App" action is GLOBAL AND
 * VISIBLE, and it stays honest by opening an internal page instead of a store
 * link that does not exist.
 *
 * This suite runs against the build with NO `VITE_PCA_ANDROID_APP_DOWNLOAD_URL`
 * set (parent-web/.env sets only the API base URL and demo mode), which is
 * exactly the condition under which the action used to vanish entirely. So
 * every assertion here is about the unconfigured case -- the normal one.
 */

const HEADER_ACTION = 'Download App';

test('the header Download action is present with no download URL configured', async ({ page }) => {
  await page.goto('/dashboard');

  const action = page.locator('.app-header').getByRole('link', { name: HEADER_ACTION });
  await expect(action).toBeVisible();
  // In-app destination. Never an external, empty, or javascript: href.
  await expect(action).toHaveAttribute('href', '/download');
});

test('clicking it reaches a page that states the Android and iOS positions', async ({ page }) => {
  await page.goto('/dashboard');
  await page.locator('.app-header').getByRole('link', { name: HEADER_ACTION }).click();

  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Download PCA Child App' })).toBeVisible();
  await expect(
    page.getByText('Android app download is not configured yet for this environment.'),
  ).toBeVisible();
  await expect(page.getByText('iOS app is planned for a later release.')).toBeVisible();
});

test('the page has no dead, fabricated, or external link anywhere', async ({ page }) => {
  await page.goto('/download');
  await expect(page.getByRole('heading', { level: 1, name: 'Download PCA Child App' })).toBeVisible();

  const main = page.locator('#main-content');
  // Nothing configured -> nothing to link to. Not a disabled button, not a
  // "coming soon" affordance: no anchor at all.
  await expect(main.locator('a')).toHaveCount(0);

  const html = await main.innerHTML();
  expect(html).not.toMatch(/play\.google\.com|apps\.apple\.com|itunes\.apple|market:\/\//i);
  expect(html).not.toMatch(/javascript:|href="#"|href=""/i);

  // Both positions are informational status, never an error.
  await expect(main.locator('[role="status"]')).toHaveCount(2);
  await expect(main.locator('[role="alert"]')).toHaveCount(0);
});

test('the iOS section offers no installation action', async ({ page }) => {
  await page.goto('/download');
  const iosBlock = page.locator('.state-block', {
    hasText: 'iOS app is planned for a later release.',
  });
  await expect(iosBlock).toBeVisible();
  await expect(iosBlock.locator('a, button, input, select')).toHaveCount(0);
});

test('no horizontal overflow at 320px in ltr, header action included', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/download');
  await expect(page.getByRole('heading', { level: 1, name: 'Download PCA Child App' })).toBeVisible();

  // Icon-only at this width, but still there and still named.
  await expect(page.locator('.app-header').getByRole('link', { name: HEADER_ACTION })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('no horizontal overflow at 320px in rtl, and the page is Arabic', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/download');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await expect(page.getByRole('heading', { level: 1, name: 'تنزيل تطبيق PCA للطفل' })).toBeVisible();
  await expect(page.getByText('لم يُضبط تنزيل تطبيق أندرويد بعد في هذه البيئة.')).toBeVisible();
  await expect(page.getByText('تطبيق iOS مخطط له في إصدار لاحق.')).toBeVisible();
  // Not left in English for an Arabic parent.
  await expect(page.getByText('Android app download is not configured yet')).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const header = await page.locator('.app-header').boundingBox();
  expect(header?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((header?.x ?? 0) + (header?.width ?? 0)).toBeLessThanOrEqual(321);
});
