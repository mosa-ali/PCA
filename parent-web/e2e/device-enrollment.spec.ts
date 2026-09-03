import { test, expect } from '@playwright/test';

/**
 * The app registers a PWA service worker, and once it is installed the SECOND
 * in-test navigation is served the cached "You're offline" shell instead of the
 * route. That is correct product behaviour but it makes any spec that visits
 * more than one URL flaky, so this file talks to the server directly. Nothing
 * about the assertions below is relaxed by it.
 */
test.use({ serviceWorkers: 'block' });

/** The Administration PIN input. Its `<label>`, the fieldset `<legend>` and the
 *  section heading all read "Administration PIN", so the id disambiguates. */
const PIN_INPUT = 'input#administration-pin';

/** Walks the guided Add-device wizard to the setup code. */
async function runAddDeviceWizard(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'What kind of device?' }).click();
  await page.getByRole('button', { name: 'How much protection?' }).click();
  await page.getByRole('button', { name: 'Review and confirm' }).click();
  await page.getByRole('button', { name: 'I understand, create invitation' }).click();
}

test.describe('Device enrollment (invitations / pairing) -- real browser', () => {
  test('the page is sectioned: one workflow at a time, the PIN only under Advanced', async ({ page }) => {
    await page.goto('/family/devices');
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText([
      'Overview',
      'Add device',
      'Pending setup',
      'Devices',
      'Protection & removal',
      'Advanced & security',
    ]);

    await page.getByRole('tab', { name: 'Add device' }).click();
    await expect(page.getByRole('heading', { name: 'Who is this device for?' })).toBeVisible();
    // A security PIN is not in a new parent's first device setup.
    await expect(page.locator(PIN_INPUT)).toHaveCount(0);
    await expect(page.getByLabel('Device ID')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Advanced & security' }).click();
    await expect(page.locator(PIN_INPUT)).toBeVisible();
    // The section is linkable.
    await expect(page).toHaveURL(/section=advanced/);
  });

  test('creating an invitation reveals the raw token once, and it never touches localStorage/sessionStorage', async ({
    page,
  }) => {
    await page.goto('/family/devices?section=add');
    await expect(page.getByRole('heading', { name: 'Who is this device for?' })).toBeVisible();
    await runAddDeviceWizard(page);

    const tokenEl = page.getByTestId('raw-invitation-token');
    await expect(tokenEl).toBeVisible();
    const rawToken = (await tokenEl.textContent())?.trim() ?? '';
    expect(rawToken.length).toBeGreaterThan(5);

    // The result a parent actually needs is all on screen at once.
    await expect(page.getByTestId('invitation-fallback-code')).toBeVisible();
    await expect(page.getByTestId('enrollment-link')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy fallback code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByRole('heading', { name: "On your child's device" })).toBeVisible();

    const storageDump = await page.evaluate(() => ({
      local: Object.keys(localStorage).map((k) => localStorage.getItem(k)),
      session: Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)),
    }));
    expect(storageDump.local.join('\n')).not.toContain(rawToken);
    expect(storageDump.session.join('\n')).not.toContain(rawToken);
    // The section lives in the URL; the one-time token must not.
    expect(page.url()).not.toContain(rawToken);

    // Reload the page -- the token must not be reconstructable/refetched.
    await page.reload();
    await expect(page.getByTestId('raw-invitation-token')).toHaveCount(0);
  });

  // Measured against the app shell's own baseline rather than against zero.
  //
  // The shell header overflows the document by 7px at 375 and 62px at 320 on
  // EVERY route, /dashboard included -- it is a header-layout defect owned by
  // the shell, not by this page, and asserting `<= 1` here would either fail
  // for someone else's reason or tempt a device-page hack that hides it. What
  // this page owes is: add nothing on top of that, and never scroll its own
  // content column sideways.
  for (const width of [375, 320]) {
    test(`the device sections add no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      const docOverflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const columnOverflow = () =>
        page.evaluate(() => {
          const main = document.querySelector('.main-content');
          if (!main) return null;
          return main.scrollWidth - main.clientWidth;
        });

      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
      const shellBaseline = await docOverflow();

      for (const section of ['overview', 'add', 'pending', 'devices', 'protection', 'advanced']) {
        await page.goto(`/family/devices?section=${section}`);
        await expect(page.getByRole('tablist')).toBeVisible();
        expect(await docOverflow(), `section=${section} adds overflow at ${width}px`).toBeLessThanOrEqual(
          shellBaseline,
        );
        expect(await columnOverflow(), `section=${section} content column scrolls at ${width}px`).toBeLessThanOrEqual(1);
      }

      // And the widest thing this page can produce -- a one-time token, its
      // link and a QR code -- must not change that.
      await page.goto('/family/devices?section=add');
      await runAddDeviceWizard(page);
      await expect(page.getByTestId('raw-invitation-token')).toBeVisible();
      expect(await docOverflow()).toBeLessThanOrEqual(shellBaseline);
      expect(await columnOverflow()).toBeLessThanOrEqual(1);
    });
  }

  test('confirm pairing button is disabled until fingerprints resolve, and the panel never renders ACTIVE', async ({
    page,
  }) => {
    await page.goto('/family/devices?section=advanced');

    // The manual lookup is a support/recovery tool on the advanced section --
    // it is deliberately no longer a primary affordance in the new-device flow.
    await page.getByLabel('Device ID').fill('nonexistent-device');
    await page.getByRole('button', { name: 'Look up pairing request' }).click();
    await expect(page.getByText('Not found.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm pairing' })).toHaveCount(0);

    // Scoped to the pairing surface itself -- unrelated existing devices on
    // this page legitimately show an ACTIVE protection StatusBadge, which
    // must not be confused with a pairing-confirmation result.
    const pairingHeading = page.getByRole('heading', { name: 'Confirm device pairing' });
    const pairingPanel = pairingHeading.locator('xpath=ancestor::div[contains(@class,"section-panel")][1]');
    expect(await pairingPanel.getByText('ACTIVE', { exact: true }).count()).toBe(0);
  });

  test('section tabs are keyboard operable and each section is directly linkable', async ({ page }) => {
    await page.goto('/family/devices');
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Add device' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/section=add/);

    await page.goto('/family/devices?section=protection');
    await expect(page.getByRole('tab', { name: 'Protection & removal' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Removing or revoking a child device changes family trust/)).toBeVisible();
  });
});
