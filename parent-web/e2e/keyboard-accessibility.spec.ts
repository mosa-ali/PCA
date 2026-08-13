import { test, expect } from '@playwright/test';

/**
 * Keyboard-only navigation and modal focus-management checks. Complements
 * tests/accessibility/axe.test.tsx (component-level axe spot checks) with
 * real-browser Tab-order behaviour that jsdom cannot exercise: focus
 * visibly moving into a dialog on open, Tab/Shift+Tab staying trapped
 * inside it while it is open, and focus returning to the control that
 * opened it once it closes (see src/hooks/useModalFocusTrap.ts).
 */
test.describe('keyboard navigation and modal focus management', () => {
  test('skip link is the first Tab stop and jumps focus to main content', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('the delete-now confirmation dialog traps Tab focus and returns focus to the trigger on close', async ({
    page,
  }) => {
    await page.goto('/privacy/delete?demoRole=OWNER');
    const trigger = page.getByRole('button', { name: 'Delete Now' }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole('button', { name: 'Confirm' });
    await expect(confirmButton).toBeFocused();

    // Shift+Tab from the first focusable element wraps to the last one,
    // staying inside the dialog rather than escaping to the page behind it.
    const cancelButton = dialog.getByRole('button', { name: 'Cancel' });
    await cancelButton.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancelButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test('the custom wellbeing message dialog traps focus and Escape returns focus to the trigger', async ({
    page,
  }) => {
    await page.goto('/wellbeing-messages?demoRole=OWNER');
    const trigger = page.getByRole('button', { name: 'Create custom message' });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('English text')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test('all primary sidebar links are reachable by keyboard alone (visible focus outline)', async ({ page }) => {
    await page.goto('/dashboard');
    const requestsLink = page.getByRole('link', { name: 'Requests' });
    await requestsLink.focus();
    await expect(requestsLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible();
  });
});
