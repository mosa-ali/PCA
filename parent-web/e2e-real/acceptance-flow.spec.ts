import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
/**
 * PPR-2 Step 5: the owner's exact acceptance flow, against the REAL local
 * backend (fresh MySQL, migrated from zero, seeded) -- not demo fixtures.
 * See playwright.real.config.ts for why this is a separate config/testDir
 * from the existing fixture-mode e2e suite.
 *
 * Consolidated into as few logins as the flow honestly allows: this
 * backend's LOGIN_EMAIL_RATE_LIMIT/LOGIN_IP_RATE_LIMIT
 * (backend/src/parentaccount/policy.ts) are real, intentional anti-abuse
 * controls, not a test-only annoyance to route around -- so this file signs
 * in ONCE per describe block and reuses that page across steps, exactly as
 * a real parent's continuous session would, rather than a fresh login per
 * assertion.
 *
 * PREREQUISITE (disposable fixture manifest). The fixture provisions a real family membership for both parent
 * identities (since PCA-DEC-037 the server provisions it at first sign-in;
 * the fixture does it up front so the journey starts from a normal account).
 */
test.use({ serviceWorkers: 'block' });

const PRIMARY_EMAIL = process.env.E2E_REAL_PARENT_EMAIL;
const PRIMARY_PASSWORD = process.env.E2E_REAL_PARENT_PASSWORD;
const PRIMARY_DAILY_LOGIN_GRANT = process.env.E2E_REAL_PARENT_DAILY_GRANT;
const SECOND_EMAIL = process.env.E2E_REAL_SECOND_PARENT_EMAIL;
const SECOND_PASSWORD = process.env.E2E_REAL_SECOND_PARENT_PASSWORD;
const SECOND_DAILY_LOGIN_GRANT = process.env.E2E_REAL_SECOND_PARENT_DAILY_GRANT;
const MFA_EMAIL = process.env.E2E_REAL_MFA_PARENT_EMAIL;
const MFA_PASSWORD = process.env.E2E_REAL_MFA_PARENT_PASSWORD;
const MFA_TOTP_SECRET = process.env.E2E_REAL_MFA_PARENT_TOTP_SECRET;
const MFA_ENROLLMENT_COUNTER_RAW = process.env.E2E_REAL_MFA_PARENT_TOTP_ENROLLMENT_COUNTER;
const MFA_ENROLLMENT_COUNTER = /^\d+$/.test(MFA_ENROLLMENT_COUNTER_RAW ?? '') ? Number(MFA_ENROLLMENT_COUNTER_RAW) : Number.NaN;
test.skip(
  !PRIMARY_EMAIL || !PRIMARY_PASSWORD || !PRIMARY_DAILY_LOGIN_GRANT
    || !SECOND_EMAIL || !SECOND_PASSWORD || !SECOND_DAILY_LOGIN_GRANT
    || !MFA_EMAIL || !MFA_PASSWORD || !MFA_TOTP_SECRET || !Number.isSafeInteger(MFA_ENROLLMENT_COUNTER),
  'real-backend acceptance flow requires the disposable primary, second, and enrolled-MFA Parent fixtures.',
);
// owner-a/owner-b are pre-seeded with an existing enrollment_invitations row
function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.replace(/=+$/g, '').toUpperCase()) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('The E2E authenticator secret is not valid base32.');
    bits += digit.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret: string, at = Date.now()): { code: string; counter: number } {
  const counter = Math.floor(at / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return { code: String(binary % 1_000_000).padStart(6, '0'), counter };
}

async function currentTotp(secret: string): Promise<{ code: string; counter: number }> {
  while (30_000 - (Date.now() % 30_000) <= 3_000) await new Promise((resolve) => setTimeout(resolve, 500));
  return totp(secret);
}

async function waitForNextTotpCounter(usedCounter: number): Promise<void> {
  while (Math.floor(Date.now() / 30_000) <= usedCounter) await new Promise((resolve) => setTimeout(resolve, 500));
}

function setLoginStepUpCode(email: string): string {
  const code = '481926';
  execFileSync(
    process.execPath,
    ['scripts/e2e-support/parentE2eSupport.mjs', 'set-login-step-up-code', email, code],
    { cwd: resolve(process.cwd(), '../backend'), env: process.env },
  );
  return code;
}

async function loginWithMfa(page: import('@playwright/test').Page, email: string, password: string, totpSecret: string): Promise<number> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('input[name="emailCode"]')).toBeVisible();
  await page.locator('input[name="emailCode"]').fill(setLoginStepUpCode(email));
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('input[name="totpCode"]')).toBeVisible();
  await waitForNextTotpCounter(MFA_ENROLLMENT_COUNTER);
  const loginCode = await currentTotp(totpSecret);
  await page.locator('input[name="totpCode"]').fill(loginCode.code);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
  return loginCode.counter;
}

/**
 * Establishes the same real cookie-backed session without booting the full
 * dashboard. The cross-family assertion is a server-boundary check; using the
 * API here keeps it from spending the shared per-IP authenticated-request
 * budget on dashboard capability reads before the boundary request runs.
 */
async function loginViaApi(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  dailyLoginGrant: string,
  headers: Record<string, string> = {},
) {
  await addDailyLoginGrant(page.context(), dailyLoginGrant);
  const response = await page.request.post('/api/parent/login', { data: { email, password }, headers });
  expect(response.status(), 'real API login must establish the disposable fixture session').toBe(200);
  expect(await response.json()).toMatchObject({ sessionEstablished: true });
}

async function addDailyLoginGrant(context: import('@playwright/test').BrowserContext, grant: string) {
  await context.clearCookies();
  await context.addCookies([{
    name: 'pca_parent_daily_login_grant',
    value: grant,
    url: 'http://localhost:4002',
    httpOnly: true,
    sameSite: 'Strict',
  }]);
}

test.describe('PPR-2 owner acceptance flow -- real backend, one continuous session', () => {
  test('login -> provisioned empty family/zero children -> add first child -> child selectable -> Download App -> invitation attempt -> Arabic/RTL -> reload', async ({ page }) => {
    // The first-login and invitation-step-up TOTP codes must use counters
    // newer than their previous accepted counters. Each may legitimately wait
    // for the next 30-second authenticator window on a slower CI runner.
    test.setTimeout(120_000);
    // 1. login
    const unexpectedAuthResponses: string[] = [];
    let monitorAuthenticatedRequests = false;
    page.on('response', (response) => {
      if (!monitorAuthenticatedRequests || ![401, 403, 429].includes(response.status())) return;
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/parent/') || pathname.startsWith('/v1/families/')) {
        unexpectedAuthResponses.push(`${response.status()} ${pathname}`);
      }
    });
    let usedTotpCounter = await loginWithMfa(page, MFA_EMAIL!, MFA_PASSWORD!, MFA_TOTP_SECRET!);
    monitorAuthenticatedRequests = true;
    // Keep this long, real-browser acceptance journey inside its own
    // per-IP auth-attempt budget. The disposable runner trusts only its
    // loopback Vite proxy, so this TEST-NET forwarded address is accepted
    // only by that isolated test backend and cannot alter production trust.
    const ownerJourneyClientIp = '198.51.100.41';
    await page.route('**/api/parent/**', (route) => route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': ownerJourneyClientIp },
    }));
    await page.route('**/v1/families/**', (route) => route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': ownerJourneyClientIp },
    }));

    // 8. Download App action visible -- on every page's header.
    await expect(page.getByRole('link', { name: 'Download App' })).toBeVisible();

    await page.goto('/family/devices?section=add');

    // 2. new family / zero children
    await expect(page.getByRole('heading', { name: 'Add your first child' })).toBeVisible();
    await expect(page.getByText('No child profiles available')).toHaveCount(0);

    // 3. Add first child
    await page.getByRole('button', { name: 'Someone new' }).click();
    const nameInput = page.getByLabel("Child's name");
    await expect(nameInput).toBeVisible();
    await expect(page.getByText('This name stays on your device. PCA never sends it to our servers.')).toBeVisible();
    await nameInput.fill('Ahmed');

    // 4. create opaque child profile (real backend call on advancing)
    const createChildResponse = page.waitForResponse(
      (res) => res.url().includes('/children') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'What kind of device?' }).click();
    const createRes = await createChildResponse;
    expect(createRes.status()).toBe(201);
    const createdBody = await createRes.json();
    expect(Object.keys(createdBody).sort()).toEqual(['childProfileId', 'createdAt']);
    const childProfileId: string = createdBody.childProfileId;

    // 5. readable child label shown locally (session-local, not server-sourced)
    await expect(page.getByRole('heading', { level: 3, name: 'What kind of device?' })).toBeVisible();

    // 6. Add Device -- continue through platform/protection/review
    await page.getByRole('button', { name: 'How much protection?' }).click();
    await page.getByRole('button', { name: 'Review and confirm' }).click();
    await expect(page.getByText('Ahmed', { exact: true })).toBeVisible();
    // 15. no raw UUID as primary UI -- never rendered as page text.
    await expect(page.getByText(childProfileId)).toHaveCount(0);

    // 9. create invitation -- record the REAL outcome, whichever it is.
    // Owner decision (docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part
    // M): basic/free V1 device enrollment must not require an active paid
    // license row. CREATE_INVITATION's requiresLicense is now false, so a
    // real 201 is the required outcome here, not merely an accepted one --
    // a regression back to 403 would be a real defect this test must catch.
    const invitationResponse = page.waitForResponse(
      (res) => res.url().includes('/invitations') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'I understand, create invitation' }).click();
    await waitForNextTotpCounter(usedTotpCounter);
    const invitationStepUpCode = await currentTotp(MFA_TOTP_SECRET!);
    await page.getByRole('dialog').getByLabel(/authenticator code/i).fill(invitationStepUpCode.code);
    await page.getByRole('dialog').getByRole('button', { name: /confirm/i }).click();
    usedTotpCounter = invitationStepUpCode.counter;
    const invRes = await invitationResponse;
    const invBody = await invRes.json().catch(() => null);
    expect(invRes.status(), `expected 201 (basic/free V1, no license required), got ${invRes.status()}: ${JSON.stringify(invBody)}`).toBe(201);
    await expect(page.getByTestId('raw-invitation-token')).toBeVisible();

    // 7. child selectable -- step 0 still shows Ahmed as a real, selectable,
    // checked radio (not the "add new" flow still active). Navigates via
    // in-app state (Back), NOT page.goto/reload: a hard navigation would
    // wipe the session-local label store by design (H2) -- that is Section
    // 14's own, separate check, not this one's. The wizard is on the
    // setup-code step (invitation created above); step back through
    // code -> review -> protection -> platform -> child.
    // exact: true -- the setup-code step's own "Copy fallback code" button
    // is otherwise also matched by a non-exact/case-insensitive name lookup
    // for "Back" (it contains "fallback"), a real ambiguity only reachable
    // now that item 9 above genuinely reaches this step (a real 201, not the
    // pre-Part-M 403 this spec never got past before).
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('Ahmed')).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Add your first child' })).toHaveCount(0);

    // 10/11. Arabic switch + RTL -- same session, label still resolved.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'لمن هذا الجهاز؟' })).toBeVisible();
    await expect(page.getByText('Ahmed', { exact: true })).toBeVisible();
    // back to English for the remaining steps' English selectors.
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // 12. responsive/mobile widths -- same session, no extra login.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('heading', { name: 'Who is this device for?' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, 'page must not scroll horizontally at 375px width').toBeLessThanOrEqual(clientWidth + 1);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 14. after reload, protected family information remains fail-closed on
    // this browser. The current UI uses its "Not available yet" notice; it
    // must not present the retired Genesis/trusted-browser onboarding card.
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Not available yet' })).toBeVisible();
    await expect(page.getByText(/Your children's protected data cannot be opened on this browser yet\./)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set up this browser' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Not available yet' })).toBeVisible();
    await expect(page.getByText(/Your children's protected data cannot be opened on this browser yet\./)).toBeVisible();
    monitorAuthenticatedRequests = false;
    expect(unexpectedAuthResponses, 'authenticated Parent journey must not hit unexpected 401/403 responses or throttling 429').toEqual([]);

    // Revoke the disposable account's browser sessions through the real
    // Settings UI. This proves the user-facing confirmation, CSRF-protected
    // backend request, and sign-in redirect together on the real session.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out all sessions' }).click();
    await expect(page.getByText(
      'This will sign you out here and on every other browser. You will need to sign in again.',
      { exact: true },
    )).toBeVisible();
    // Isolate the final auth request from the journey's per-IP test budget.
    // The backend trusts this forwarded address only from the loopback Vite
    // proxy in the disposable E2E server configuration.
    await page.route('**/api/parent/sessions/revoke-all', (route) => route.continue({
      headers: { ...route.request().headers(), 'x-forwarded-for': '198.51.100.43' },
    }));
    const revokeResponse = page.waitForResponse(
      (response) => response.url().includes('/api/parent/sessions/revoke-all') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    expect((await revokeResponse).status()).toBe(204);
    await expect(page).toHaveURL(/\/login$/);
  });
});

// 13. unauthorized/cross-family negative check -- a second, independent
// account must never read or write against the first account's family. The
// real, server-enforced boundary (PPR-2 Step 4's security report); the
// client-side role heuristic is documented as non-authoritative and is not
// re-tested here. Its own describe block/login is unavoidable -- this is
// genuinely a second identity, not reusable session state.
test.describe('PPR-2 cross-family isolation -- real backend', () => {
  test("a second family's session cannot read or create against the first family's id", async ({ page }) => {
    // This suite runs after the long owner-flow browser journey against one
    // disposable backend. The certified E2E backend explicitly trusts only
    // its loopback Vite proxy, so give this independent client a separate
    // forwarded address and a fresh per-IP authenticated-request budget.
    const isolationClientHeaders = { 'x-forwarded-for': '198.51.100.42' };
    // This is intentionally an API/session-boundary test rather than a second
    // full dashboard navigation. The owner flow and realBackend.spec.ts cover
    // the UI login; this test must reserve the backend's shared authenticated
    // request budget for the two cross-family authorization decisions.
    await loginViaApi(page, PRIMARY_EMAIL!, PRIMARY_PASSWORD!, PRIMARY_DAILY_LOGIN_GRANT!, isolationClientHeaders);
    const meRes = await page.request.get('/api/parent/session', { headers: isolationClientHeaders });
    expect(meRes.status()).toBe(200);
    const ownFamilyId = (await meRes.json()).familyId as string;

    await loginViaApi(page, SECOND_EMAIL!, SECOND_PASSWORD!, SECOND_DAILY_LOGIN_GRANT!, isolationClientHeaders);
    const crossList = await page.request.get(`/v1/families/${ownFamilyId}/children`, { headers: isolationClientHeaders });
    expect(crossList.status(), "cross-family LIST must be 403, not 200 with someone else's rows").toBe(403);

    const crossCreate = await page.request.post(`/v1/families/${ownFamilyId}/children`, { data: {}, headers: isolationClientHeaders });
    expect(crossCreate.status(), 'cross-family CREATE must be 403').toBe(403);
  });
});
