import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { base32Decode, computeTotp } from '../../backend/dist/platformadmin/auth/totp.js';

const EMAIL = process.env.E2E_REAL_MFA_PARENT_EMAIL;
const PASSWORD = process.env.E2E_REAL_MFA_PARENT_PASSWORD;
const SECRET = process.env.E2E_REAL_MFA_PARENT_TOTP_SECRET;

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
  const firstTotpOutcome = await firstTotpLogin.json().catch(() => ({})) as { error?: unknown; sessionEstablished?: unknown; mfaRequired?: unknown; mfaSetupRequired?: unknown; recoveryPending?: unknown; stepUpRequired?: unknown };
  if (firstTotpLogin.status() !== 200 || firstTotpOutcome.sessionEstablished !== true) {
    const firstTotpRequestBody = firstTotpLogin.request().postDataJSON() as { totpCode?: unknown } | null;
    const otpProbe = await page.request.post('/api/parent/login/step-up', { data: { email: EMAIL!, code: firstEmailCode } });
    const otpProbeOutcome = await otpProbe.json().catch(() => ({})) as { mfaRequired?: unknown };
    const responseCookieNames = firstTotpLogin.headersArray().filter((header) => header.name === 'set-cookie').map((header) => header.value.split('=', 1)[0]).filter(Boolean);
    throw new Error(`email-plus-TOTP login status=${firstTotpLogin.status()} error=${String(firstTotpOutcome.error ?? 'none')} responseKeys=${Object.keys(firstTotpOutcome).sort().join(',') || 'none'} sessionEstablished=${String(firstTotpOutcome.sessionEstablished === true)} mfaRequired=${String(firstTotpOutcome.mfaRequired === true)} mfaSetupRequired=${String(firstTotpOutcome.mfaSetupRequired === true)} recoveryPending=${String(firstTotpOutcome.recoveryPending === true)} stepUpRequired=${String(firstTotpOutcome.stepUpRequired === true)} contentType=${firstTotpLogin.headers()['content-type'] ?? 'none'} totpFieldPresent=${String(typeof firstTotpRequestBody?.totpCode === 'string' && firstTotpRequestBody.totpCode.length === 6)} responseCookieNames=${responseCookieNames.join(',') || 'none'}; email-OTP-only probe status=${otpProbe.status()} mfaRequired=${String(otpProbeOutcome.mfaRequired === true)}`);
  }
  expect(firstTotpLogin.status(), `email-plus-TOTP login response code: ${String(firstTotpOutcome.error ?? 'none')}`).toBe(200);
  expect(firstTotpOutcome.sessionEstablished, 'valid email-plus-TOTP login establishes the browser session').toBe(true);
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
