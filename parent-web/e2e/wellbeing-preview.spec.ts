import { test, expect } from '@playwright/test';

test('wellbeing message preview simulator renders non-full-screen surfaces', async ({ page }) => {
  await page.goto('/wellbeing-messages');
  await expect(page.getByRole('heading', { name: 'Wellbeing Messages' })).toBeVisible();

  const firstPreviewButton = page.getByRole('button', { name: 'Preview' }).first();
  await firstPreviewButton.click();

  await expect(page.getByRole('heading', { name: 'Delivery preview simulator' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock-screen (redacted)' })).toBeVisible();

  await page.getByRole('button', { name: 'Lock-screen (redacted)' }).click();
  // Two previews render side by side (English + Arabic), both redacted.
  await expect(page.getByText('New message available').first()).toBeVisible();
  await expect(page.getByText('New message available')).toHaveCount(2);

  // The preview area must stay a small, bounded card -- never a full-viewport takeover.
  const previewBox = await page.locator('.preview-frame').first().boundingBox();
  const viewport = page.viewportSize();
  expect(previewBox).not.toBeNull();
  if (previewBox && viewport) {
    expect(previewBox.height).toBeLessThan(viewport.height * 0.9);
  }
});
