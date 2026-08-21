import { test, expect } from '@playwright/test';

test.describe('RBAC route guards (real browser)', () => {
  test('Owner can reach the screen-time edit route directly', async ({ page }) => {
    await page.goto('/children/child-amir/screen-time');
    await expect(page.getByText('Continuous-use limit (minutes)')).toBeVisible();
  });

  test('switching to Viewer and deep-linking to an edit route redirects to Not Permitted', async ({ page }) => {
    // A fresh full-navigation deep link with the fixture role preset via
    // ?demoRole= -- this exercises the same code path a real page reload
    // (or a bookmarked link) would take, unlike a same-page role switch.
    await page.goto('/children/child-amir/screen-time?demoRole=VIEWER');
    await expect(page.getByRole('heading', { name: 'Action not permitted' })).toBeVisible();
    await expect(page.getByText('Continuous-use limit (minutes)')).not.toBeVisible();
  });

  test('Viewer sees a disabled/hidden save affordance rather than a working edit control on read-only pages', async ({ page }) => {
    await page.goto('/requests?demoRole=VIEWER');
    // Approve/deny buttons must not be present for a Viewer (gated by PermissionGate)
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('Administrator cannot reach role-transfer/recovery route (Owner-only + step-up)', async ({ page }) => {
    await page.goto('/security/recovery?demoRole=ADMINISTRATOR');
    await expect(page.getByRole('heading', { name: 'Action not permitted' })).toBeVisible();
  });

  test('Owner triggers a step-up dialog for a sensitive action (export)', async ({ page }) => {
    await page.goto('/privacy/export?demoRole=OWNER');
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Re-authenticate to continue')).toBeVisible();
    await page.getByRole('button', { name: 'Re-authenticate (dev stub)' }).click();
    // PCA-FR-093: the real backend intake response is always shown here
    // (pending crypto review, never a fabricated completed export) --
    // see Export.tsx's own header comment for why this changed from an
    // earlier "generated locally" placeholder message.
    await expect(page.getByText(/Export request accepted/)).toBeVisible();
  });
});
