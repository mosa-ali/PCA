import { test, expect } from '@playwright/test';

test.describe('offline / reconnect / policy status UX', () => {
  test('the child overview shows an honest offline notice for an offline child device -- never implies protection is disabled', async ({
    page,
  }) => {
    // 2026-09-08: DeviceOfflineNotice moved from the dashboard to the per-child
    // pages (ChildOverview / ScreenTimePage); this spec had never run in CI and
    // still looked for it on /dashboard. child-yousef (DEV fixture) is OFFLINE.
    await page.goto('/children/child-yousef');
    await expect(page.getByText("This child's device is offline")).toBeVisible();
    await expect(page.getByText(/local protection continues on the device/i)).toBeVisible();
    await expect(page.getByText(/Remote data may be stale/i)).toBeVisible();
  });

  test('app shell still renders once the browser goes offline (PWA app-shell offline capability)', async ({
    page,
    context,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await context.setOffline(true);
    // Trigger the browser 'offline' event handlers inside the already-loaded SPA.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText("You're offline. The app shell still works")).toBeVisible();
    await context.setOffline(false);
  });

  test('a policy edit page shows an offline-draft notice while offline, never an "applied" claim', async ({
    page,
    context,
  }) => {
    await page.goto('/children/child-amir/screen-time');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/saved locally as a draft and will sync once you reconnect/i)).toBeVisible();
    await expect(page.getByText(/requires a trusted browser/i)).toBeVisible();
    await context.setOffline(false);
  });

  test('retired trusted-browser deep links return to the Parent dashboard', async ({ page }) => {
    await page.goto('/security/trusted-browser');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request pairing' })).toHaveCount(0);
  });
});
