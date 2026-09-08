// PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A035 / PCA-PA-6): a REAL-BROWSER
// colour-contrast gate for the Platform Administration console. The jsdom axe
// suite cannot compute contrast (the rule reports "incomplete" under jsdom),
// so until this spec existed nothing enforced the ratios in global.css.
// Covers the unauthenticated login form and the authenticated shell
// (dashboard) in both languages; the login/whoami calls are route-mocked the
// same way e2e/arabicShell.spec.ts does, so no backend is needed.
import { test, expect, type Page } from '@playwright/test';
import { runAxeContrast, runArabicTextContrast, type AxeContrastSummary } from './lib/contrastAudit';


// The app ships a strict script-src 'self' CSP (a real control this audit must not weaken
// in the product). Injecting axe-core into the page is the audit harness, not the app,
// so CSP enforcement is bypassed for this test context only; e2e/rbac.spec.ts and the
// securityHeaders tests continue to assert the CSP itself.
test.use({ bypassCSP: true });

async function expectNoContrastViolations(page: Page, label: string) {
  const summary: AxeContrastSummary = await runAxeContrast(page);
  const arabic = await runArabicTextContrast(page);
  test.info().annotations.push({ type: 'arabic-text-nodes evaluated/skipped', description: `${label}: ${arabic.evaluated}/${arabic.skipped}` });
  // English pages must be evaluated by axe; Arabic pages by the script-independent audit
  // (axe-core 4.10 skips Arabic-only text -- see ./lib/contrastAudit.ts).
  expect(summary.passesCount + arabic.evaluated, `no text node could be evaluated on ${label}; the audit is vacuous`).toBeGreaterThan(0);
  expect(arabic.failures).toEqual([]);
  test.info().annotations.push({ type: 'axe-incomplete-nodes', description: `${label}: ${summary.incompleteCount}` });
  expect(summary.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
}

async function mockAuthenticatedSession(page: Page) {
  await page.route('**/platform-admin/auth/login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionToken: 'e2e-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }) });
  });
  await page.route('**/platform-admin/auth/whoami', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adminId: 'e2e-admin', roles: ['APP_OWNER'], sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }) });
  });
}

test('login form: real-browser WCAG AA contrast holds in English and Arabic', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expectNoContrastViolations(page, '/login (en)');
  await page.getByLabel('Language').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expectNoContrastViolations(page, '/login (ar)');
});

test('authenticated shell (dashboard): real-browser WCAG AA contrast holds in English and Arabic', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('admin@pca.test');
  await page.getByLabel(/password/i).fill('x');
  await page.getByLabel(/authenticator code/i).fill('123456');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expectNoContrastViolations(page, '/ (en, authenticated)');
  await page.getByLabel('Language').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();
  await expectNoContrastViolations(page, '/ (ar, authenticated)');
});
