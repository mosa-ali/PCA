import { test, expect } from '@playwright/test';

// The parent console is a PWA: vite-plugin-pwa generates a Workbox service
// worker (vite.config.ts) that precaches the static app shell and NOTHING
// else (no API responses -- family data is E2EE). These specs exercise the
// production-shaped worker in a real browser, which no other spec does: the
// suite's fresh contexts usually navigate before the worker has taken
// control, so a worker that answers online navigations wrongly only shows up
// as an "intermittent" failure elsewhere.
//
// Added 2026-09-08 after exactly that: `navigateFallback: '/offline.html'`
// registered a NavigationRoute that answered EVERY worker-controlled
// navigation to a non-precached URL -- every reload or deep link other than
// "/" -- with the offline page while the network was fine
// (docs/public/reports/PUBLIC_0_DISCOVERY_REPORT.md had flagged this as
// plausible and untested). The first spec below fails on that configuration.

async function waitForServiceWorkerControl(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service workers are not available in this browser context');
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 200 && !navigator.serviceWorker.controller; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!navigator.serviceWorker.controller) throw new Error('the service worker never took control of the page');
  });
}

test.describe('PWA service worker -- navigations under worker control', () => {
  test('deep links and reloads render the real page while online once the worker controls the browser', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await waitForServiceWorkerControl(page);

    await page.goto('/family/devices?section=overview');
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: "You're offline" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: "You're offline" })).toHaveCount(0);
  });

  test('the precached offline page is served only while the network is unreachable, and the real page returns on reconnect', async ({
    page,
    context,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await waitForServiceWorkerControl(page);

    await context.setOffline(true);
    await page.goto('/family/devices?section=overview');
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await expect(page).toHaveTitle(/Offline/);

    await context.setOffline(false);
    await page.goto('/family/devices?section=overview');
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: "You're offline" })).toHaveCount(0);
  });

  test('the generated worker caches no runtime responses (E2EE: API data is never cached) and keeps the offline page as a network-failure fallback', async ({
    page,
  }) => {
    const response = await page.request.get('/sw.js');
    expect(response.ok()).toBe(true);
    const source = await response.text();
    expect(source).toMatch(/NetworkOnly/);
    expect(source).toMatch(/fallbackURL:"\/offline\.html"/);
    expect(source).not.toMatch(/CacheFirst|NetworkFirst|StaleWhileRevalidate/);
    expect(source).not.toMatch(/NavigationRoute\(\s*\w+\.createHandlerBoundToURL\("\/offline\.html"\)/);
  });
});
