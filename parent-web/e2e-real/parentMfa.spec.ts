import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { base32Decode, computeTotp } from '../../backend/dist/platformadmin/auth/totp.js';

const EMAIL = process.env.E2E_REAL_MFA_PARENT_EMAIL;
const PASSWORD = process.env.E2E_REAL_MFA_PARENT_PASSWORD;
const SECRET = process.env.E2E_REAL_MFA_PARENT_TOTP_SECRET;
const LOCK_EMAIL = process.env.E2E_REAL_MFA_LOCK_PARENT_EMAIL;
const LOCK_PASSWORD = process.env.E2E_REAL_MFA_LOCK_PARENT_PASSWORD;
const LOCK_SECRET = process.env.E2E_REAL_MFA_LOCK_PARENT_TOTP_SECRET;

test.skip(!EMAIL || !PASSWORD || !SECRET, 'real Parent MFA E2E requires the disposable enrolled Parent fixture.');
test.use({ serviceWorkers: 'block' });

async function currentTotp(secret: string): Promise<{ code: string; counter: number }> {
  // Leave a small margin at a 30-second boundary so the request cannot arrive
  // after this code has rolled out of the accepted TOTP window.
  while (30_000 - (Date.now() % 30_000) <= 3_000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const nowMs = Date.now();
  return { code: computeTotp(base32Decode(secret), nowMs), counter: Math.floor(nowMs / 30_000) };
}

async function waitForNextTotpCounter(usedCounter: number): Promise<void> {
  while (Math.floor(Date.now() / 30_000) <= usedCounter) await new Promise((resolve) => setTimeout(resolve, 500));
}

function setLoginStepUpCode(email: string, code: string): string {
  execFileSync(
    process.execPath,
    ['scripts/e2e-support/parentE2eSupport.mjs', 'set-login-step-up-code', email, code],
    { cwd: resolve(process.cwd(), '../backend'), env: process.env },
  );
  return code;
}

function setMfaRecoveryCode(email: string, code: string): string {
  execFileSync(
    process.execPath,
    ['scripts/e2e-support/parentE2eSupport.mjs', 'set-mfa-recovery-code', email, code],
    { cwd: resolve(process.cwd(), '../backend'), env: process.env },
  );
  return code;
}

function setPasswordResetCode(email: string, code: string): string {
  execFileSync(
    process.execPath,
    ['scripts/e2e-support/parentE2eSupport.mjs', 'set-password-reset-code', email, code],
    { cwd: resolve(process.cwd(), '../backend'), env: process.env },
  );
  return code;
}

function latestAcceptedTotpCounter(email: string): number {
  const raw = execFileSync(
    process.execPath,
    ['scripts/e2e-support/parentE2eSupport.mjs', 'mfa-state', email],
    { cwd: resolve(process.cwd(), '../backend'), env: process.env, encoding: 'utf8' },
  );
  const state = JSON.parse(raw) as { status?: unknown; lastAcceptedTotpCounter?: unknown };
  if (state.status !== 'ACTIVE' || !Number.isSafeInteger(state.lastAcceptedTotpCounter)) {
    throw new Error('The disposable Parent MFA fixture has no durable accepted TOTP counter.');
  }
  return state.lastAcceptedTotpCounter as number;
}

test('real browser: unknown-browser login requires email OTP plus Parent MFA and makes no Microsoft identity request', async ({ page, context, browser }) => {
  const microsoftRequests: string[] = [];
  const popups: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/login\.microsoftonline\.com|login\.windows\.net|sts\.windows\.net|account\.activedirectory\.windowsazure\.com|\b(login|auth)\.live\.com|\/common\/oauth2?\//i.test(url)) microsoftRequests.push(url);
  });
  context.on('page', (popup) => popups.push(popup.url()));

  // This disposable MFA account has no daily-login/browser grant. Its first
  // password-only response must ask for email OTP and must not issue a session.
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('input[name="emailCode"]')).toBeVisible();
  const beforeMfa = await context.cookies('http://127.0.0.1:4002');
  expect(beforeMfa.some((cookie) => cookie.name === 'pca_family_session')).toBe(false);

  const firstEmailCode = setLoginStepUpCode(EMAIL!, '482731');
  await page.locator('input[name="emailCode"]').fill(firstEmailCode);
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('input[name="totpCode"]')).toBeVisible();
  expect((await context.cookies('http://127.0.0.1:4002')).some((cookie) => cookie.name === 'pca_family_session')).toBe(false);

  // The earlier certified owner-acceptance E2E uses this same enrolled Parent
  // fixture and may already have claimed newer TOTP counters. Read the durable
  // replay watermark after that run, then use only a strictly newer counter.
  await waitForNextTotpCounter(latestAcceptedTotpCounter(EMAIL!));
  const firstCode = await currentTotp(SECRET!);
  await page.locator('input[name="totpCode"]').fill(firstCode.code);
  const firstTotpLoginResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/parent/login/step-up' && response.request().method() === 'POST',
  );
  await page.locator('form button[type="submit"]').click();
  const firstTotpLogin = await firstTotpLoginResponse;
  const firstTotpResponseText = await firstTotpLogin.text().catch(() => '');
  let firstTotpResponseValue: unknown = {};
  let firstTotpJsonParsed = false;
  try {
    firstTotpResponseValue = JSON.parse(firstTotpResponseText) as unknown;
    firstTotpJsonParsed = true;
  } catch {
    // The diagnostic below records only parse status and metadata, never body text.
  }
  const firstTotpBodyType = firstTotpResponseValue === null ? 'null' : Array.isArray(firstTotpResponseValue) ? 'array' : typeof firstTotpResponseValue;
  const firstTotpOutcome = typeof firstTotpResponseValue === 'object' && firstTotpResponseValue !== null && !Array.isArray(firstTotpResponseValue)
    ? firstTotpResponseValue as { error?: unknown; sessionEstablished?: unknown; mfaRequired?: unknown; mfaSetupRequired?: unknown; stepUpRequired?: unknown }
    : {};
  await page.waitForURL(/\/dashboard$/, { timeout: 10_000 }).catch(() => undefined);
  const cookiesAfterTotp = await context.cookies('http://127.0.0.1:4002');
  const sessionCookiePresent = cookiesAfterTotp.some((cookie) => cookie.name === 'pca_family_session');
  const dailyLoginGrantCookiePresent = cookiesAfterTotp.some((cookie) => cookie.name === 'pca_parent_daily_login_grant');
  const sessionProbe = await page.request.get('/api/parent/session');
  const successfulSessionObserved = sessionCookiePresent && sessionProbe.status() === 200 && new URL(page.url()).pathname === '/dashboard';
  const responseContractFailed = firstTotpJsonParsed
    ? firstTotpOutcome.sessionEstablished !== true
    : firstTotpResponseText.length !== 0;
  if (firstTotpLogin.status() !== 200 || !successfulSessionObserved || responseContractFailed) {
    const firstTotpRequestBody = firstTotpLogin.request().postDataJSON() as { totpCode?: unknown } | null;
    const otpProbe = await page.request.post('/api/parent/login/step-up', { data: { email: EMAIL!, code: firstEmailCode } });
    const otpProbeOutcome = await otpProbe.json().catch(() => ({})) as { mfaRequired?: unknown };
    const responseCookieNames = (await firstTotpLogin.headersArray()).filter((header) => header.name === 'set-cookie').map((header) => header.value.split('=', 1)[0]).filter(Boolean);
    throw new Error(`email-plus-TOTP login status=${firstTotpLogin.status()} error=${String(firstTotpOutcome.error ?? 'none')} responseKeys=${Object.keys(firstTotpOutcome).sort().join(',') || 'none'} bodyType=${firstTotpBodyType} jsonParsed=${String(firstTotpJsonParsed)} bodyLength=${firstTotpResponseText.length} sessionEstablished=${String(firstTotpOutcome.sessionEstablished === true)} mfaRequired=${String(firstTotpOutcome.mfaRequired === true)} mfaSetupRequired=${String(firstTotpOutcome.mfaSetupRequired === true)} stepUpRequired=${String(firstTotpOutcome.stepUpRequired === true)} contentType=${firstTotpLogin.headers()['content-type'] ?? 'none'} totpFieldPresent=${String(typeof firstTotpRequestBody?.totpCode === 'string' && firstTotpRequestBody.totpCode.length === 6)} responseCookieNames=${responseCookieNames.join(',') || 'none'} sessionCookiePresent=${String(sessionCookiePresent)} dailyLoginGrantCookiePresent=${String(dailyLoginGrantCookiePresent)} sessionProbeStatus=${sessionProbe.status()} pagePath=${new URL(page.url()).pathname}; email-OTP-only probe status=${otpProbe.status()} mfaRequired=${String(otpProbeOutcome.mfaRequired === true)}`);
  }
  expect(firstTotpLogin.status(), `email-plus-TOTP login response code: ${String(firstTotpOutcome.error ?? 'none')}`).toBe(200);
  expect(successfulSessionObserved, 'valid email-plus-TOTP login establishes a cookie-backed session and dashboard navigation').toBe(true);
  if (firstTotpJsonParsed) expect(firstTotpOutcome.sessionEstablished, 'JSON login response confirms the established session').toBe(true);
  else expect(firstTotpResponseText, 'empty response-body fallback requires independent session proof').toBe('');
  await expect(page).toHaveURL(/\/dashboard$/);
  const firstLoginCookies = await context.cookies('http://127.0.0.1:4002');
  const sessionCookie = firstLoginCookies.find((cookie) => cookie.name === 'pca_family_session');
  expect(sessionCookie, 'successful TOTP login establishes the backend session cookie').toBeDefined();
  expect(sessionCookie?.httpOnly).toBe(true);
  const dailyLoginGrantCookie = firstLoginCookies.find((cookie) => cookie.name === 'pca_parent_daily_login_grant');
  expect(dailyLoginGrantCookie, 'successful unknown-browser login trusts this browser').toBeDefined();
  expect(dailyLoginGrantCookie?.httpOnly).toBe(true);

  // A second isolated context represents a genuinely unknown browser and
  // cannot inherit the first login's session or daily-grant cookies.
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4002', serviceWorkers: 'block' });
  const secondPage = await secondContext.newPage();
  secondPage.on('request', (request) => {
    const url = request.url();
    if (/login\.microsoftonline\.com|login\.windows\.net|sts\.windows\.net|account\.activedirectory\.windowsazure\.com|\b(login|auth)\.live\.com|\/common\/oauth2?\//i.test(url)) microsoftRequests.push(url);
  });
  secondContext.on('page', (popup) => popups.push(popup.url()));
  try {
    await waitForNextTotpCounter(firstCode.counter);
    await secondPage.goto('/login');
    await secondPage.getByLabel(/email/i).fill(EMAIL!);
    await secondPage.getByLabel(/password/i).fill(PASSWORD!);
    await secondPage.getByRole('button', { name: /sign in/i }).click();
    await expect(secondPage.locator('input[name="emailCode"]')).toBeVisible();
    const secondEmailCode = setLoginStepUpCode(EMAIL!, '482732');
    await secondPage.locator('input[name="emailCode"]').fill(secondEmailCode);
    await secondPage.locator('form button[type="submit"]').click();
    await expect(secondPage.locator('input[name="totpCode"]')).toBeVisible();
    const secondCode = await currentTotp(SECRET!);
    await secondPage.locator('input[name="totpCode"]').fill(secondCode.code);
    await secondPage.locator('form button[type="submit"]').click();
    await expect(secondPage).toHaveURL(/\/dashboard$/);
    const secondLoginCookies = await secondContext.cookies('http://127.0.0.1:4002');
    const secondSessionCookie = secondLoginCookies.find((cookie) => cookie.name === 'pca_family_session');
    expect(secondSessionCookie, 'successful TOTP login establishes the backend session cookie').toBeDefined();
    expect(secondSessionCookie?.httpOnly).toBe(true);
    const secondDailyLoginGrantCookie = secondLoginCookies.find((cookie) => cookie.name === 'pca_parent_daily_login_grant');
    expect(secondDailyLoginGrantCookie, 'successful unknown-browser login trusts this browser').toBeDefined();
    expect(secondDailyLoginGrantCookie?.httpOnly).toBe(true);
  } finally {
    await secondContext.close();
  }

  expect(microsoftRequests, 'Parent authentication must not contact Microsoft identity endpoints').toEqual([]);
  expect(popups, 'Parent authentication must not open an identity popup').toEqual([]);
});

test('real browser: immediate lost-authenticator recovery, replacement enrollment, old-factor rejection, and new-factor login', async ({ page, browser }) => {
  // Exercise the owner-approved immediate recovery transition in a real
  // browser after the ordinary unknown-browser flow has been proven.
  await page.goto('/mfa/recover');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /email me a recovery code/i }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByText(/set up a replacement immediately/i)).toBeVisible();
  const recoveryCode = setMfaRecoveryCode(EMAIL!, '741852');
  await page.locator('input[name="code"]').fill(recoveryCode);
  await page.getByRole('button', { name: /confirm recovery code/i }).click();
  await expect(page).toHaveURL(/\/mfa\/setup$/);
  const revokedSession = await page.request.get('/api/parent/session');
  expect(revokedSession.status(), 'MFA recovery revokes the current browser session immediately').toBe(401);
  await expect(page.getByText(/24.hour|security hold|continue after the hold/i)).toHaveCount(0);
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.locator('[data-testid="mfa-manual-key"] summary').click();
  const replacementSecret = (await page.locator('[data-testid="mfa-manual-secret"]').textContent())!.replace(/\s+/g, '');
  await expect(page.locator('input[name="totp"]')).toBeVisible();
  const replacementCode = await currentTotp(replacementSecret);
  await page.locator('input[name="totp"]').fill(replacementCode.code);
  await page.getByRole('button', { name: /confirm and finish/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const replacementContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4002', serviceWorkers: 'block' });
  const replacementPage = await replacementContext.newPage();
  try {
    await replacementPage.goto('/login');
    await replacementPage.getByLabel(/email/i).fill(EMAIL!);
    await replacementPage.getByLabel(/password/i).fill(PASSWORD!);
    await replacementPage.getByRole('button', { name: /sign in/i }).click();
    await expect(replacementPage.locator('input[name="emailCode"]')).toBeVisible();
    const replacementLoginCode = setLoginStepUpCode(EMAIL!, '518274');
    await replacementPage.locator('input[name="emailCode"]').fill(replacementLoginCode);
    await replacementPage.locator('form button[type="submit"]').click();
    await expect(replacementPage.locator('input[name="totpCode"]')).toBeVisible();
    await waitForNextTotpCounter(replacementCode.counter);
    await replacementPage.locator('input[name="totpCode"]').fill((await currentTotp(SECRET!)).code);
    await replacementPage.locator('form button[type="submit"]').click();
    await expect(replacementPage.getByRole('alert')).toBeVisible();
    await expect(replacementPage).not.toHaveURL(/\/dashboard$/);

    await replacementPage.goto('/login');
    await replacementPage.getByLabel(/email/i).fill(EMAIL!);
    await replacementPage.getByLabel(/password/i).fill(PASSWORD!);
    await replacementPage.getByRole('button', { name: /sign in/i }).click();
    await expect(replacementPage.locator('input[name="emailCode"]')).toBeVisible();
    const nextLoginCode = setLoginStepUpCode(EMAIL!, '284715');
    await replacementPage.locator('input[name="emailCode"]').fill(nextLoginCode);
    await replacementPage.locator('form button[type="submit"]').click();
    await expect(replacementPage.locator('input[name="totpCode"]')).toBeVisible();
    await waitForNextTotpCounter(replacementCode.counter);
    await replacementPage.locator('input[name="totpCode"]').fill((await currentTotp(replacementSecret)).code);
    await replacementPage.locator('form button[type="submit"]').click();
    await expect(replacementPage).toHaveURL(/\/dashboard$/);
  } finally {
    await replacementContext.close();
  }
});

test('real browser: five wrong passwords lock sign-in, Forgot password stays available, reset clears lock and preserves the active TOTP', async ({ page }) => {
  if (!LOCK_EMAIL || !LOCK_PASSWORD || !LOCK_SECRET) throw new Error('The isolated password-lock Parent fixture is incomplete.');

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(LOCK_EMAIL);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByLabel(/password/i).fill('incorrect password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  }
  await page.getByLabel(/password/i).fill(LOCK_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toContainText(/too many unsuccessful sign-in attempts/i);
  await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  await page.getByRole('link', { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel(/email/i).fill(LOCK_EMAIL);
  await expect(page.getByLabel(/email/i)).toHaveValue(LOCK_EMAIL);
  const preSubmitEmailDiagnostic = await page.locator('#forgot-password-email').evaluate((node) => {
    const input = node as HTMLInputElement;
    const formDataEmail = input.form ? new FormData(input.form).get('email') : null;
    return {
      inputValueLength: input.value.length,
      inputName: input.name,
      formAssociated: Boolean(input.form),
      formContainsInput: input.form?.contains(input) ?? false,
      formDataEmailLength: typeof formDataEmail === 'string' ? formDataEmail.length : null,
    };
  });
  expect(preSubmitEmailDiagnostic.inputValueLength, 'the reset address remains in the input until submit').toBe(LOCK_EMAIL.length);
  expect(preSubmitEmailDiagnostic.formDataEmailLength, 'the submitted form includes the reset address').toBe(LOCK_EMAIL.length);
  const resetRequest = page.waitForResponse((response) => response.url().endsWith('/api/parent/request-password-reset'));
  await page.getByRole('button', { name: /send reset code/i }).click();
  const resetResponse = await resetRequest;
  const resetPayload = resetResponse.request().postDataJSON() as { email?: unknown } | null;
  const submittedEmail = resetPayload?.email;
  const resetAddressDiagnostic = {
    emailType: typeof submittedEmail,
    exactFixtureMatch: submittedEmail === LOCK_EMAIL,
    normalizedFixtureMatch: typeof submittedEmail === 'string'
      && submittedEmail.trim().toLowerCase() === LOCK_EMAIL.trim().toLowerCase(),
    submittedEmailLength: typeof submittedEmail === 'string' ? submittedEmail.length : null,
  };
  const resetResponseBody = await resetResponse.json() as { error?: unknown };
  expect(resetResponse.status(), `password reset remains available during the lock (safe API error: ${String(resetResponseBody.error ?? 'none')}; request diagnostic: ${JSON.stringify({ preSubmitEmailDiagnostic, resetAddressDiagnostic })})`).toBe(202);
  expect(submittedEmail === LOCK_EMAIL, 'forgot-password submits the isolated locked Parent address').toBe(true);
  await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
  const resetCode = setPasswordResetCode(LOCK_EMAIL, '693184');
  await page.getByRole('link', { name: /enter it here/i }).click();
  await page.locator('input[name="code"]').fill(resetCode);
  const newPassword = 'A fresh browser test password 7!';
  await page.locator('input[name="newPassword"]').fill(newPassword);
  await page.locator('input[name="newPasswordConfirmation"]').fill(newPassword);
  await page.getByRole('button', { name: /reset password/i }).click();
  await expect(page.getByRole('heading', { name: /password reset/i })).toBeVisible();
  const oldSession = await page.request.get('/api/parent/session');
  expect(oldSession.status(), 'password reset revokes the existing browser session').toBe(401);
  await page.getByRole('link', { name: /back to sign in/i }).click();
  await page.getByLabel(/email/i).fill(LOCK_EMAIL);
  await page.getByLabel(/password/i).fill(newPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('input[name="emailCode"]')).toBeVisible();
  const postResetLoginCode = setLoginStepUpCode(LOCK_EMAIL, '703159');
  await page.locator('input[name="emailCode"]').fill(postResetLoginCode);
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('input[name="totpCode"]')).toBeVisible();
  await waitForNextTotpCounter(latestAcceptedTotpCounter(LOCK_EMAIL));
  await page.locator('input[name="totpCode"]').fill((await currentTotp(LOCK_SECRET)).code);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
