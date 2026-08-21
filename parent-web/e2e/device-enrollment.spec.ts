import { test, expect } from '@playwright/test';

test.describe('Device enrollment (invitations / pairing) -- real browser', () => {
  test('creating an invitation reveals the raw token once, and it never touches localStorage/sessionStorage', async ({
    page,
  }) => {
    await page.goto('/family/devices');
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create invitation' })).toBeEnabled();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await page.getByRole('button', { name: 'I understand, create invitation' }).click();

    const tokenEl = page.getByTestId('raw-invitation-token');
    await expect(tokenEl).toBeVisible();
    const rawToken = (await tokenEl.textContent())?.trim() ?? '';
    expect(rawToken.length).toBeGreaterThan(5);

    const storageDump = await page.evaluate(() => ({
      local: Object.keys(localStorage).map((k) => localStorage.getItem(k)),
      session: Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)),
    }));
    expect(storageDump.local.join('\n')).not.toContain(rawToken);
    expect(storageDump.session.join('\n')).not.toContain(rawToken);

    // Reload the page -- the token must not be reconstructable/refetched.
    await page.reload();
    await expect(page.getByTestId('raw-invitation-token')).toHaveCount(0);
  });

  test('no horizontal overflow on the device enrollment panel at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/family/devices');
    await expect(page.getByRole('heading', { name: 'Add a child device' })).toBeVisible();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await page.getByRole('button', { name: 'I understand, create invitation' }).click();
    await expect(page.getByTestId('raw-invitation-token')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('confirm pairing button is disabled until fingerprints resolve, and the panel never renders ACTIVE', async ({
    page,
  }) => {
    await page.goto('/family/devices');
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await page.getByRole('button', { name: 'I understand, create invitation' }).click();
    await expect(page.getByTestId('raw-invitation-token')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // The dev fixture seeds a pairing request device id we cannot read from
    // the UI directly, so this spec exercises the honest not-found path
    // (a real device id would come from the child app in production) and
    // confirms the confirm button never appears/enables without a lookup.
    await page.getByLabel('Device ID').fill('nonexistent-device');
    await page.getByRole('button', { name: 'Look up pairing request' }).click();
    await expect(page.getByText('Not found.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm pairing' })).toHaveCount(0);
    // Scoped to the enrollment panel itself -- unrelated existing devices on
    // this page legitimately show an ACTIVE protection StatusBadge, which
    // must not be confused with a pairing-confirmation result.
    const enrollmentHeading = page.getByRole('heading', { name: 'Add a child device' });
    const enrollmentPanel = enrollmentHeading.locator('xpath=ancestor::section[1]');
    expect(await enrollmentPanel.getByText('ACTIVE', { exact: true }).count()).toBe(0);
  });
});
