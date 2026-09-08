import { test, expect } from '@playwright/test';

// PCA-16 / PCA-NFR-041 (2026-09-08): forced colours, increased contrast and reduced motion for
// the operator console, proven in a real layout engine under emulated media. The login page
// needs no session; the authenticated shell is reached through the same route mocks the
// contrast spec uses.

async function mockAuthenticatedSession(page: import('@playwright/test').Page) {
  await page.route('**/platform-admin/auth/login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionToken: 'e2e-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }) });
  });
  await page.route('**/platform-admin/auth/whoami', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adminId: 'e2e-admin', roles: ['APP_OWNER'], sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }) });
  });
}

test('the sign-in button and focus ring stay visible under forced colours', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/login');
  const button = page.getByRole('button', { name: /sign in/i });
  await expect(button).toBeVisible();
  const border = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: parseFloat(cs.borderTopWidth), style: cs.borderTopStyle };
  });
  expect(border.width).toBeGreaterThanOrEqual(1);
  expect(border.style).toBe('solid');

  const email = page.getByLabel(/email/i);
  await email.focus();
  const outline = await email.evaluate((el) => ({ width: parseFloat(getComputedStyle(el).outlineWidth), style: getComputedStyle(el).outlineStyle }));
  expect(outline.width).toBeGreaterThanOrEqual(3);
  expect(outline.style).toBe('solid');
});

test('reduced motion collapses every transition and animation in the authenticated shell', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedSession(page);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('admin@pca.test');
  await page.getByLabel(/password/i).fill('x');
  await page.getByLabel(/authenticator code/i).fill('123456');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  const durations = await page.evaluate(() =>
    [document.body, ...Array.from(document.querySelectorAll('a, button')).slice(0, 12)].map((el) => {
      const cs = getComputedStyle(el);
      return { t: cs.transitionDuration, a: cs.animationDuration };
    }),
  );
  for (const d of durations) {
    for (const v of [...d.t.split(','), ...d.a.split(',')]) expect(parseFloat(v)).toBeLessThanOrEqual(0.001);
  }
});

test('prefers-contrast: more collapses muted text onto the primary text colour', async ({ page }) => {
  await page.goto('/login');
  const read = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { muted: cs.getPropertyValue('--text-muted').trim(), text: cs.getPropertyValue('--text').trim() };
    });
  const normal = await read();
  expect(normal.muted).not.toBe(normal.text);
  await page.emulateMedia({ contrast: 'more' });
  const more = await read();
  expect(more.muted).toBe(more.text);
});
