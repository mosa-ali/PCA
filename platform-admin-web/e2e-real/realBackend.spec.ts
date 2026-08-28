import { test, expect } from '@playwright/test';
import { computeTotp, msUntilNextTotpWindow } from './support/totp';

/**
 * REAL-BACKEND E2E suite (mission Section: "Real E2E required (not
 * mocked-only)"). Unlike e2e/*.spec.ts (which mocks the backend at the HTTP
 * boundary -- see that directory's header notes), every flow here runs
 * against an ACTUAL Fastify backend process backed by a real MySQL
 * database, exercising the full stack: Vite dev server -> real fetch ->
 * real /platform-admin/* routes -> real PlatformAdminAuthService/
 * EntitlementService/PlanService/PriceBookService/etc. -> real MySQL.
 *
 * WHY ONE LONG TEST INSTEAD OF SEVERAL SHORT ONES: the real server's TOTP
 * verification (backend/src/platformadmin/auth/totp.ts) only accepts a code
 * within ±1 of its OWN current 30-second step, and durably remembers the
 * last-accepted counter per account to block replay (TOTP-REPLAY-1). That
 * gives at most 3 distinct valid codes per 30-second wall-clock window --
 * nowhere near enough for N independent Playwright `test()` blocks each
 * opening a fresh, unauthenticated browser context and re-logging in (which
 * is what separate `test()`s do even inside `test.describe.serial`, since
 * each gets its own context). A single authenticated session performing
 * every flow in sequence needs exactly two real TOTP codes for the whole
 * suite (one for login, one for the admin-user-creation step-up) and is
 * also a more faithful model of how an operator actually uses this app.
 *
 * PREREQUISITES (this spec does not stand these up itself -- see this
 * lane's final report for the exact commands used to provision them):
 *   1. An isolated MySQL instance (docker compose, backend/compose.yaml)
 *      migrated via `npm run db:migrate`.
 *   2. A backend process (`node dist/main.js`) running against that
 *      database, with PCA_DATABASE_URL/PLATFORM_ADMIN_MFA_ENC_KEY set.
 *   3. Exactly one bootstrap APP_OWNER account created via
 *      backend/scripts/bootstrap-platform-owner.mjs.
 *   4. `npm run dev` started with VITE_E2E_REAL_PROXY_TARGET pointing at
 *      that backend (see vite.config.ts's header) -- this playwright.real.config.ts's
 *      own `webServer` does this itself. VITE_PCA_PLATFORM_ADMIN_API_BASE_URL
 *      must be left UNSET: src/config/env.ts's default is empty/same-origin,
 *      which is what makes the browser's fetches to /platform-admin/* land
 *      on THIS app's own origin (http://localhost:4102, per this config's
 *      `baseURL`) and get proxied server-side to VITE_E2E_REAL_PROXY_TARGET
 *      -- same-origin from the browser's perspective, so no CORS headers
 *      are needed (the backend intentionally has none -- see vite.config.ts).
 *      CONFIRMED BY DIRECT REPRODUCTION: setting
 *      VITE_PCA_PLATFORM_ADMIN_API_BASE_URL to an absolute backend origin
 *      (e.g. http://localhost:4001, this app's OLD default before this fix)
 *      makes the browser call the backend cross-origin instead of through
 *      this same-origin proxy; the backend has no CORS layer, so the
 *      browser blocks the request outright and login fails with a generic
 *      "Sign-in failed. Please try again." error that never leaves /login --
 *      indistinguishable, from the UI alone, from a genuine credential
 *      failure. See src/config/env.ts's and
 *      src/api/platformAdminApiClient.ts's own headers for the fix.
 *   5. The following environment variables set for THIS Playwright run
 *      (never hardcoded in this file -- these are live credentials for a
 *      throwaway, isolated test database, not secrets worth committing):
 *        E2E_REAL_ADMIN_EMAIL
 *        E2E_REAL_ADMIN_PASSWORD
 *        E2E_REAL_ADMIN_TOTP_SECRET (base32, from the bootstrap script's
 *          printed otpauth:// URI's `secret=` query parameter)
 *        E2E_REAL_TEST_FAMILY_ID (optional -- a real families.family_id
 *          row that already exists in the database, e.g. from
 *          backend/scripts/seed-local.mjs's output. Only gates the
 *          suspend/reactivate step below; every other step runs without it.)
 *
 * Run with: npm run test:e2e:real (see package.json).
 */

const EMAIL = process.env.E2E_REAL_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_REAL_ADMIN_PASSWORD;
const TOTP_SECRET = process.env.E2E_REAL_ADMIN_TOTP_SECRET;

test.skip(!EMAIL || !PASSWORD || !TOTP_SECRET, 'E2E_REAL_ADMIN_EMAIL/PASSWORD/TOTP_SECRET not set -- real-backend E2E requires a live backend + bootstrap admin (see file header).');

test('real backend: an operator session exercises login/MFA, dashboard, entitlements, admin-user step-up, audit, settings, and billing against a real Fastify + MySQL backend', async ({ page }) => {
  // The Platform Administration session token is held in memory only
  // (src/security/secureSession.ts, PCA-ADD-PA-001) and never persisted --
  // a full page.goto()/page.reload() after login drops it and bounces back
  // to /login. Every navigation after the initial login therefore goes
  // through the real in-app sidebar links (client-side React Router
  // navigation), exactly as a real operator's browser session would.
  const navigateTo = async (linkName: RegExp) => {
    await page.getByRole('link', { name: linkName }).click();
  };

  await test.step('an invalid TOTP code against the real server is rejected generically, revealing nothing about which factor failed', async () => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByLabel(/authenticator code/i).fill('000000');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect email, password, or authenticator code/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('login with real credentials + a real TOTP code reaches the dashboard with live whoami-derived data', async () => {
    // Wait out to a fresh, never-before-claimed 30s TOTP window -- see
    // msUntilNextTotpWindow's doc comment for why this is necessary even
    // though this is the first REAL login attempt in this test run.
    await page.waitForTimeout(msUntilNextTotpWindow());
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByLabel(/authenticator code/i).fill(computeTotp(TOTP_SECRET!));
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    // whoami's real role grant (translated "App Owner") renders on the
    // identity card -- only true against a real server round trip.
    await expect(page.getByText(/app owner/i).first()).toBeVisible();
    // Live DashboardReadModel snapshot rendered from the real read-model route.
    await expect(page.getByText(/total accounts/i)).toBeVisible();
  });

  await test.step('entitlements lookup for a family ID the real database has never explicitly provisioned auto-creates a real FREE_STARTER row (EntitlementService.getEntitlement -> getOrCreateForFamily) -- verified against real MySQL, not a client-side guess', async () => {
    await navigateTo(/^entitlements$/i);
    await page.getByLabel(/family id/i).fill('11111111-1111-1111-1111-111111111111');
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByRole('heading', { name: /entitlement overview/i })).toBeVisible();
    await expect(page.getByText('FREE_STARTER')).toBeVisible();
  });

  let createdAdminName = '';
  await test.step('admin users: the real bootstrap APP_OWNER row is listed, and creating a new admin requires a real, freshly re-verified step-up code', async () => {
    await navigateTo(/^admin users$/i);
    // Real admin-users list -- displayName only (email is never returned by
    // the real API, per the frozen contract), from the bootstrap script.
    await expect(page.getByRole('cell', { name: /platform owner \(bootstrap\)/i })).toBeVisible();

    await page.getByRole('button', { name: /create admin/i }).click();
    createdAdminName = `E2E Real Support Admin ${Date.now()}`;
    await page.getByLabel(/display name/i).fill(createdAdminName);
    await page.getByLabel(/^email/i).fill(`e2e-real-support-${Date.now()}@pca.test`);
    await page.getByLabel(/^password/i).fill('E2eRealSupportAdminPassword123!');
    await page.getByRole('button', { name: /create admin/i }).click();

    // A real step-up dialog appears -- it must be answered with a SECOND,
    // distinct TOTP code (never the login code) before the real server will
    // issue a stepUpId and the create-admin request can proceed.
    //
    // WAIT FOR A GENUINELY FRESH WINDOW HERE TOO (not merely `offset: 1`
    // relative to whenever this line happens to execute): an earlier version
    // of this step used `computeTotp(TOTP_SECRET!, 1)` on the theory that
    // "+1 step from now" can never collide with the login code claimed a few
    // seconds ago in the same run. That's true WITHIN one run, but it does
    // NOT bound which absolute counter gets claimed -- if this line runs
    // close enough to a 30s boundary, "+1" can land in the SAME absolute
    // window a DIFFERENT, immediately-following invocation of this suite
    // independently computes for ITS OWN login step (each run waits for a
    // fresh window from ITS OWN start time, not from any other run's
    // progress). Confirmed by direct reproduction: two `npx playwright test
    // --config=playwright.real.config.ts` invocations run back-to-back
    // intermittently produced a genuine server-side FAILED_MFA on the SECOND
    // run's real login -- not a CORS/UI bug, but PlatformAdminAuthService's
    // TOTP-REPLAY-1 guard correctly refusing to accept a counter
    // `platform_admin_mfa_state.last_accepted_totp_counter` had already
    // reached (the first run's step-up claim, landing in the same window the
    // second run's login independently computed). Waiting out to a fresh
    // window here, exactly like the login step above, makes the counter this
    // step claims deterministic (whatever is current the moment the wait
    // ends) instead of relative to uncontrolled prior state, eliminating
    // that cross-run collision class entirely.
    await page.waitForTimeout(msUntilNextTotpWindow());
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/authenticator code/i).fill(computeTotp(TOTP_SECRET!));
    await page.getByRole('button', { name: /confirm/i }).click();

    await expect(page.getByRole('cell', { name: createdAdminName })).toBeVisible();
  });

  await test.step('accounts: suspending and reactivating a real family account round-trips through real MySQL, each requiring its own fresh step-up code', async () => {
    const familyId = process.env.E2E_REAL_TEST_FAMILY_ID;
    test.skip(!familyId, 'E2E_REAL_TEST_FAMILY_ID not set -- skipping the real suspend/reactivate check.');

    await navigateTo(/^accounts$/i);
    await page.getByRole('link', { name: familyId! }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    await page.getByLabel(/reason for suspension/i).fill('E2E real-backend suspend/reactivate check');
    await page.getByRole('button', { name: /^suspend account$/i }).click();
    await page.waitForTimeout(msUntilNextTotpWindow());
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/authenticator code/i).fill(computeTotp(TOTP_SECRET!));
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText('Suspended', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E real-backend suspend/reactivate check')).toBeVisible();

    await page.getByRole('button', { name: /^reactivate account$/i }).click();
    await page.waitForTimeout(msUntilNextTotpWindow());
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/authenticator code/i).fill(computeTotp(TOTP_SECRET!));
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // Navigate away and back to force a fresh GET, proving both mutations
    // actually persisted to MySQL rather than only local React state.
    await navigateTo(/^dashboard$/i);
    await navigateTo(/^accounts$/i);
    await page.getByRole('link', { name: familyId! }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
  });

  await test.step('audit log renders the real ADMIN_LOGIN + ADMIN_CREATED events this session itself just generated', async () => {
    await navigateTo(/^audit log$/i);
    await expect(page.getByRole('cell', { name: /ADMIN_LOGIN/i }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /ADMIN_CREATED/i }).first()).toBeVisible();
  });

  await test.step('settings: real currency metadata (USD/SAR/YER) renders from the live route, and saving free-starter defaults round-trips through real MySQL', async () => {
    await navigateTo(/^settings$/i);
    await expect(page.getByRole('cell', { name: 'USD' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'SAR' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'YER' })).toBeVisible();

    await page.getByLabel(/parent member limit/i).first().fill('3');
    await page.getByLabel(/managed device limit/i).first().fill('7');
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await expect(page.getByText(/saved/i)).toBeVisible();

    // Navigate away and back (client-side, session-preserving) to force a
    // fresh GET from the real server -- proving the PUT actually persisted
    // to MySQL rather than only updating local React state.
    await navigateTo(/^dashboard$/i);
    await navigateTo(/^settings$/i);
    await expect(page.getByText('3', { exact: true })).toBeVisible();
    await expect(page.getByText('7', { exact: true })).toBeVisible();
  });

  await test.step('billing plan create + list round-trips through the real PlanService, and price-book publish round-trips exact money through real MySQL (no float drift)', async () => {
    const planCode = `e2e-real-plan-${Date.now()}`;
    await navigateTo(/^plans$/i);
    // The search form and the create-plan form both label a field "Plan
    // code" (same i18n key, by design -- BillingPlans.tsx) -- disambiguate
    // by id rather than relying on DOM order via .first()/.last().
    await page.locator('#new-plan-code').fill(planCode);
    await page.getByLabel(/parent member limit/i).fill('2');
    await page.getByLabel(/managed device limit/i).fill('5');
    // Plan creation is gated by the shared two-click ConfirmButton (see
    // ConfirmButton.tsx's doc comment) -- the first click only arms the
    // action and swaps the button to Confirm/Cancel; a second, explicit
    // click on Confirm is what actually fires PlanService.createPlanVersion.
    await page.getByRole('button', { name: /create plan/i }).click();
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(page.getByText(/created/i)).toBeVisible();

    await page.locator('#plan-code-search').fill(planCode);
    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('cell', { name: planCode })).toBeVisible();

    // Exact-money round trip: "19.99" must publish and redisplay as exactly
    // 19.99 -- not 19.989999999999998 (the classic parseFloat*100 failure
    // mode this app's money.ts is built to prevent).
    await navigateTo(/^price book$/i);
    await page.getByLabel(/target device limit/i).fill('5');
    await page.getByLabel(/amount/i).fill('19.99');
    await page.getByRole('button', { name: /^publish$/i }).click();
    await expect(page.getByText(/published/i)).toBeVisible();
    await expect(page.getByText(/19\.99/)).toBeVisible();
    await expect(page.getByText(/19\.98999|19\.990000/)).toHaveCount(0);
  });
});
