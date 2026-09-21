import { expect, test } from '@playwright/test';

const VIEWPORTS = [320, 375, 390, 430, 768, 1366, 1920];

for (const width of VIEWPORTS) {
  test(`Parent Guide has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 760 : 900 });
    await page.goto('/guide');
    await expect(page.getByRole('heading', { name: 'Parent Guide', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('Parent Guide is reached from the profile disclosure and is not a sidebar row', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await expect(page.locator('#header-profile-panel').getByRole('link', { name: 'Parent Guide', exact: true })).toBeVisible();
  await expect(page.locator('#app-sidebar').getByRole('link', { name: 'Parent Guide', exact: true })).toHaveCount(0);
});

test('Guide search links to a topic anchor and Arabic remains RTL', async ({ page }) => {
  await page.goto('/guide');
  const search = page.getByRole('searchbox', { name: 'Search the Parent Guide' });
  await search.fill('recovery');
  await expect(page.locator('#guide-search-results').getByRole('link', { name: /Recovery/ })).toHaveAttribute('href', '#guide-topic-recovery');

  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'دليل الوالدين', exact: true })).toBeVisible();
  const breadcrumb = page.getByRole('navigation', { name: 'مسار التنقل' });
  await expect(breadcrumb).toContainText('دليل الوالدين');
  await expect(breadcrumb).not.toContainText('guide');
  const arabicSearch = page.getByRole('searchbox', { name: 'البحث في دليل الوالدين' });
  await arabicSearch.fill('الاسترداد');
  await expect(page.locator('#guide-search-results').getByRole('link', { name: /الاسترداد/ })).toHaveAttribute('href', '#guide-topic-recovery');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
