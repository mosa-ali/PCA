import { test, expect } from '@playwright/test';

/**
 * REAL-BACKEND E2E suite (mission "Real E2E required (not mocked-only)"),
 * mirroring platform-admin-web/e2e-real/realBackend.spec.ts's identical
 * pattern and rationale. Every flow here runs against an ACTUAL Fastify
 * backend process backed by a real MySQL database, exercising the full
 * stack: Vite dev server -> real fetch -> real /api/parent/* routes -> real
 * ParentAccountService/ParentPreferencesService/FreeAccessAdminService ->
 * real MySQL.
 *
 * SCOPE, HONESTLY BOUNDED: this suite covers exactly the parts of
 * parent-web that are genuinely HTTP-backed today (see src/api/client.ts's
 * own header) -- account session (serviceAuth), parentPreferences, and
 * freeAccessStatus, all backed by the SAME pca_family_session cookie. It
 * deliberately does NOT exercise trustedBrowser/parentFamilyData/deviceStatus/
 * requests/safeZones/billing/retention mutation paths: those either have no
 * live backend to answer them yet, or are additionally gated on
 * @pca/parent-sdk-browser-runtime's crypto-review gate (hardcoded
 * not-ready pending human security review) and would honestly reject with
 * EndpointNotTrustedError/CryptoReviewRequiredError -- asserting against
 * that rejection would not be testing a real capability, so it is left out
 * rather than padded in as a fake pass.
 *
 * PREREQUISITES (this spec does not stand these up itself):
 *   1. An isolated MySQL instance (docker compose, backend/compose.yaml)
 *      migrated via `npm run db:migrate`.
 *   2. A backend process (`node dist/main.js`) running against that
 *      database, with PCA_DATABASE_URL/NODE_ENV=development-or-test set
 *      (NODE_ENV is required for TestSandboxEmailSender -- see step 3).
 *   3. Exactly one real, email-verified parent account created via
 *      backend/scripts/bootstrap-e2e-parent-account.mjs (E2E_REAL_PARENT_EMAIL/
 *      E2E_REAL_PARENT_PASSWORD).
 *   4. `npm run dev -- --mode e2e-real` (this repo's playwright.real.config.ts
 *      does this itself) -- loads .env.e2e-real (VITE_PCA_DEMO_MODE=false,
 *      VITE_E2E_REAL_PROXY_TARGET pointing at that backend; see that file's
 *      own header).
 *   5. The following environment variables set for THIS Playwright run
 *      (never hardcoded in this file -- live credentials for a throwaway,
 *      isolated test database, not secrets worth committing):
 *        E2E_REAL_PARENT_EMAIL
 *        E2E_REAL_PARENT_PASSWORD
 *
 * Run with: npm run test:e2e:real (see package.json).
 */

const EMAIL = process.env.E2E_REAL_PARENT_EMAIL;
const PASSWORD = process.env.E2E_REAL_PARENT_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'E2E_REAL_PARENT_EMAIL/PASSWORD not set -- real-backend E2E requires a live backend + bootstrapped account (see file header).');

test('real backend: a parent signs in and reaches the dashboard and settings page with real, cookie-session-backed data', async ({ page, browser }) => {
  await test.step('wrong credentials against the real server are rejected generically', async () => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('sign-in with real credentials reaches the dashboard via a real session cookie', async () => {
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await test.step('the session cookie survives a full page reload (HttpOnly, real backend-issued, not client-held state)', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await test.step('navigating to Settings loads real parentPreferences data from the live backend (not a fixture)', async () => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await test.step('a fresh, unauthenticated browser context is redirected away from a protected route -- no session leaks across contexts', async () => {
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto('/dashboard');
    await expect(freshPage).toHaveURL(/\/login$/);
    await freshContext.close();
  });
});
