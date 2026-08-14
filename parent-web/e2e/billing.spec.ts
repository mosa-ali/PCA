import { test, expect } from '@playwright/test';

// PCA-MYKIDS-BILL-1 (PCA_ADDENDUM_002 Section 18.1): the full parent
// self-service commercial flow against a real browser + real dev-fixture
// backend timing (the "server" confirmation is genuinely asynchronous, not
// mocked away here).
test.describe('Billing / subscription self-service (real browser)', () => {
  test('Owner can view the FREE_STARTER subscription overview', async ({ page }) => {
    await page.goto('/subscription?demoRole=OWNER');
    await expect(page.getByText('Free Starter', { exact: true })).toBeVisible();
    await expect(page.getByText('1 managed device included')).toBeVisible();
    await expect(page.getByText('Price: Free')).toBeVisible();
  });

  test('Administrator is blocked from the subscription route (Owner-only by default)', async ({ page }) => {
    await page.goto('/subscription?demoRole=ADMINISTRATOR');
    await expect(page.getByRole('heading', { name: 'Action not permitted' })).toBeVisible();
  });

  test('Viewer is blocked from requesting a device increase', async ({ page }) => {
    await page.goto('/subscription/increase-devices?demoRole=VIEWER');
    await expect(page.getByRole('heading', { name: 'Action not permitted' })).toBeVisible();
  });

  test('Owner requests a standard device increase, sees the exact price, pays, and the redirect page stays pending until the server confirms', async ({ page }) => {
    await page.goto('/subscription/increase-devices?demoRole=OWNER');
    await page.getByRole('button', { name: '2 devices' }).click();

    await expect(page.getByText('Quoted -- ready for payment')).toBeVisible();
    await expect(page.getByText('$4.99')).toBeVisible();

    await page.getByRole('button', { name: 'Proceed to payment' }).click();

    // Checkout handoff lands on the redirect page, which must show a
    // pending state -- never an immediate "approved" -- and only reflects
    // approval once the (simulated) server-side confirmation lands.
    await expect(page).toHaveURL(/\/subscription\/checkout-return\?requestId=/);
    await expect(page.getByText('Payment pending')).toBeVisible();
    await expect(page.getByText('Approved')).not.toBeVisible();

    await expect(page.getByText('Approved')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Payment confirmed. Your allowance has been updated.')).toBeVisible();

    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page.locator('dt:has-text("Active devices") + dd')).toHaveText('1');
    await expect(page.locator('dt:has-text("Device limit") + dd')).toHaveText('2');
  });

  test('a custom quantity with no standard price is sent for admin quote review, not a client-side price', async ({ page }) => {
    await page.goto('/subscription/increase-devices?demoRole=OWNER');
    await page.getByLabel('Or enter a custom total').fill('4');
    await page.getByRole('button', { name: 'Request this quantity' }).click();

    await expect(page.getByText('Pending quote review')).toBeVisible();
    await expect(page.getByText(/does not have a standard price/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Proceed to payment' })).toHaveCount(0);
  });

  test('a parent-member increase request never shows a price or a payment step', async ({ page }) => {
    await page.goto('/subscription/increase-parent-members?demoRole=OWNER');
    await expect(page.getByText(/never priced or charged/)).toBeVisible();

    await page.getByLabel('New total parent-member limit').fill('2');
    await page.getByRole('button', { name: 'Submit request' }).click();

    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Proceed to payment' })).toHaveCount(0);
  });

  test('a completed device increase produces a paid invoice visible from the Subscription overview', async ({ page }) => {
    // A single initial hard navigation, then only in-app (client-side) links
    // from here on -- the DEVELOPMENT_ONLY fixture state lives in an
    // in-memory JS module that a real full-page navigation would reset,
    // exactly like a real backend would NOT reset on client-side routing but
    // WOULD look different after an actual reload; staying in-app for the
    // rest of this flow is what proves the invoice this test creates is the
    // one it later finds, not a coincidence of fixture defaults.
    await page.goto('/subscription/increase-devices?demoRole=OWNER');
    await page.getByRole('button', { name: '2 devices' }).click();
    await page.getByRole('button', { name: 'Proceed to payment' }).click();
    await expect(page.getByText('Approved')).toBeVisible({ timeout: 5000 });

    await page.getByRole('link', { name: 'Back' }).click();
    await page.getByRole('link', { name: 'View invoices and receipts' }).click();

    await expect(page.getByText('Paid')).toBeVisible();
    await expect(page.getByText('$4.99')).toBeVisible();
  });
});
