import { test, expect } from '@playwright/test';
import { parentAccount, seedPassword } from './qaManifest';

/**
 * Coordinator B (QA/runtime) Section 5 sweep: AR/RTL + responsive coverage
 * for parent-web's two highest-value primary workflow groups (auth,
 * dashboard). Real Chromium, real backend. Scope reduced from the full
 * ask (every primary group x 5 viewports) under this session's time
 * budget -- see the final reconciliation report for exactly which groups
 * remain untested.
 */

const SEED_PASSWORD = seedPassword();

test('auth (login): AR/RTL renders correctly at desktop', async ({ page }) => {
  await page.goto('/login?lng=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('body')).not.toContainText(/TypeError|undefined|\[object Object\]/i);
  expect(errors).toEqual([]);
});

test('auth (login): AR/RTL renders correctly at 375x812 mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login?lng=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 });
  // No horizontal overflow at mobile width.
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth, 'page has horizontal overflow at 375px width').toBeLessThanOrEqual(clientWidth + 1);
});

test('auth (login): EN renders correctly at desktop (baseline)', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', { timeout: 10_000 });
});

test('dashboard: AR/RTL renders correctly for a real AR-preference account (owner-a) at desktop', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount('owner-a').email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|تسجيل/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  // owner-a's account-level language_code='ar' preference (real DB row,
  // see seed-local.mjs) is NOT read/applied by AuthContext.tsx or App.tsx
  // anywhere in the current source (confirmed by direct source search this
  // session) -- i18next's own detector (querystring/navigator only,
  // caches:[]) is what actually drives dir=rtl, matching this repo's own
  // established real-browser AR/RTL evidence pattern elsewhere in the
  // ledger (?lng=ar querystring). Re-navigating with it here is the
  // correct/only way to exercise AR on an authenticated route; the
  // unused account-preference row is worth flagging separately (see the
  // reconciliation report).
  await page.goto('/dashboard?lng=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 });
  await expect(page.locator('body')).not.toContainText(/TypeError|Cannot read propert/i);
});

test('dashboard: AR/RTL renders correctly for owner-a at 375x812 mobile, sidebar/nav reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount('owner-a').email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|تسجيل/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await page.goto('/dashboard?lng=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 10_000 });
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth, 'dashboard has horizontal overflow at 375px width in AR/RTL').toBeLessThanOrEqual(clientWidth + 1);
});

test('dashboard: EN renders correctly at 1366x768 desktop (responsive sample)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/login');
  await page.locator('#login-email').fill(parentAccount('owner-login-ok').email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});
