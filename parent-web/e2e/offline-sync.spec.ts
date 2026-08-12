import { test, expect } from '@playwright/test';

test.describe('offline / reconnect / policy status UX', () => {
  test('dashboard shows an honest offline notice for an offline child device -- never implies protection is disabled', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    // child-yousef (DEV fixture) is OFFLINE.
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

  test('trusted-browser page walks through all five non-initial states without illegal transitions', async ({
    page,
  }) => {
    await page.goto('/security/trusted-browser');
    await page.getByRole('button', { name: 'Reset (dev)' }).click();
    await expect(page.getByText('This browser is not yet trusted with family decryption authority.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign in (dev stub)' }).click();
    await expect(page.getByText(/Pairing this browser with the family is required/)).toBeVisible();

    await page.getByRole('button', { name: 'Request pairing' }).click();
    await expect(page.getByText(/Waiting for parent approval/)).toBeVisible();

    await page.getByRole('button', { name: 'Simulate parent approval (dev)' }).click();
    await expect(page.getByText('This browser is trusted and can decrypt family data.')).toBeVisible();

    await page.getByRole('button', { name: 'Simulate epoch gone stale (dev)' }).click();
    await expect(page.getByText(/out of date \(stale epoch\)/)).toBeVisible();

    await page.getByRole('button', { name: 'Resync (dev)' }).click();
    await expect(page.getByText('This browser is trusted and can decrypt family data.')).toBeVisible();

    await page.getByRole('button', { name: 'Simulate revoke (dev)' }).click();
    await expect(page.getByText(/trust has been revoked/)).toBeVisible();
  });
});
