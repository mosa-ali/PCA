import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The header language control is a two-option segmented control, not a
 * `<select>`. Each option's accessible name is the language's own endonym
 * ("English" / "العربية"), which is stable whatever the viewport does to the
 * visible label. It replaced a bare `<select>` that had no CSS rule anywhere
 * in global.css and rendered at near-invisible contrast.
 */
async function switchToArabic(page: Page) {
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

test('switching to Arabic flips document direction and renders Arabic UI text', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await switchToArabic(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();
});

test('the header language control is a keyboard-operable, correctly-pressed segmented pair', async ({ page }) => {
  await page.goto('/dashboard');
  const group = page.getByRole('group', { name: 'Language' });
  const english = group.getByRole('button', { name: 'English' });
  const arabic = group.getByRole('button', { name: 'العربية' });

  await expect(english).toHaveAttribute('aria-pressed', 'true');
  await expect(arabic).toHaveAttribute('aria-pressed', 'false');

  // Keyboard alone: focus the Arabic option and activate it with Enter.
  await arabic.focus();
  await expect(arabic).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
});

test('switching language preserves the current route rather than navigating home', async ({ page }) => {
  await page.goto('/family/devices');
  await switchToArabic(page);
  await expect(page).toHaveURL(/\/family\/devices$/);
});

test('Arabic sidebar renders on the logical "end" side (RTL layout, no horizontal overflow)', async ({ page }) => {
  await page.goto('/dashboard');
  await switchToArabic(page);

  // "Logical end" under dir=rtl means the sidebar sits to the RIGHT of the
  // main column. Asserted geometrically, not by CSS text, so a physical
  // left/right property sneaking back into the stylesheet fails here.
  const sidebar = await page.locator('#app-sidebar').boundingBox();
  const main = await page.locator('#main-content').boundingBox();
  expect(sidebar).not.toBeNull();
  expect(main).not.toBeNull();
  expect((sidebar?.x ?? 0)).toBeGreaterThan(main?.x ?? 0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the RTL header itself does not overflow at the narrowest supported width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/dashboard');
  await switchToArabic(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const header = await page.locator('.app-header').boundingBox();
  expect((header?.x ?? -1)).toBeGreaterThanOrEqual(0);
  expect((header?.x ?? 0) + (header?.width ?? 0)).toBeLessThanOrEqual(321);
});

// Same guarantee, new carrier: the dashboard's offline/unverified state must be
// Arabic, never left in English. See the note in responsive.spec.ts for why the
// DeviceOfflineNotice prose no longer appears on this page.
test('dashboard offline and unverified state is translated in Arabic, not left in English', async ({ page }) => {
  await page.goto('/dashboard');
  await switchToArabic(page);
  await expect(page.getByText('غير متصل', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('غير متحقَّق منه', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Not verified', { exact: true })).toHaveCount(0);
});

test('saving a policy shows the PolicyStatusBadge translated in Arabic, never the English label', async ({ page }) => {
  await page.goto('/children/child-amir/screen-time');
  await switchToArabic(page);
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('في الطابور -- بانتظار التسليم')).toBeVisible();
  await expect(page.getByText('Queued -- pending delivery')).not.toBeVisible();
  await expect(page.getByText('مُطبَّق على الجهاز')).not.toBeVisible();
});
