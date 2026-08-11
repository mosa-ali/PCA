import { test, expect } from '@playwright/test';

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow on dashboard at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test(`no horizontal overflow on family members table at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/family/members');
    await expect(page.getByRole('heading', { name: 'Users & Members' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('mobile drawer is usable at 320px width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/dashboard');
  const openButton = page.getByLabel('Open navigation menu');
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(page.locator('#app-sidebar')).toHaveClass(/drawer-open/);
  await expect(page.getByRole('link', { name: 'Requests' })).toBeVisible();
});
