import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_REAL_MFA_SETUP_PARENT_EMAIL;
const PASSWORD = process.env.E2E_REAL_MFA_SETUP_PARENT_PASSWORD;
const DAILY_LOGIN_GRANT = process.env.E2E_REAL_MFA_SETUP_PARENT_DAILY_GRANT;

test.skip(!EMAIL || !PASSWORD || !DAILY_LOGIN_GRANT, 'real Parent setup E2E requires a fresh, unenrolled Parent fixture and its browser grant.');
test.use({ serviceWorkers: 'block' });

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()) {
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

function setLoginStepUpCode(email: string, code: string): string {
  execFileSync(
    process.execPath,
    ['scripts/e2e-support/parentE2eSupport.mjs', 'set-login-step-up-code', email, code],
    { cwd: resolve(process.cwd(), '../backend'), env: process.env },
  );
  return code;
}

test('real browser: password-only login, authenticated CSRF bootstrap, local QR enrollment, then unknown-browser email OTP and TOTP relogin', async ({ page, context, browser }) => {
  // Attach the one-time grant returned by the real fixture-provisioning login
  // so this fresh browser is recognized during MFA grace instead of being
  // diverted into email verification.
  await context.addCookies([{
    name: 'pca_parent_daily_login_grant',
    value: DAILY_LOGIN_GRANT!,
    url: 'http://localhost:4002',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const loginCookie = (await context.cookies('http://localhost:4002')).find((cookie) => cookie.name === 'pca_family_session');
  expect(loginCookie?.httpOnly).toBe(true);
  // Parent Web cannot read an API host-only CSRF cookie in production. Model
  // that absence while retaining the authenticated session cookie.
  await context.clearCookies({ name: 'pca_family_csrf' });
  await expect(page.getByTestId('mfa-grace-setup-now')).toBeVisible();
  await page.getByTestId('mfa-grace-setup-now').click();
  await expect(page).toHaveURL(/\/mfa\/setup$/);
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);

  const csrfBootstrap = page.waitForResponse((response) => response.url().includes('/api/parent/csrf'));
  await page.getByRole('button', { name: /continue/i }).click();
  expect((await csrfBootstrap).status()).toBe(200);
  await expect(page.getByTestId('mfa-qr-code')).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code/i })).toBeVisible();
  await page.getByTestId('mfa-manual-key').locator('summary').click();
  const secret = (await page.getByTestId('mfa-manual-secret').innerText()).replace(/\s+/g, '');
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  expect(page.url()).not.toContain('otpauth://');
  expect(JSON.stringify(await page.evaluate(() => [localStorage, sessionStorage].map((store) => Object.keys(store).map((key) => store.getItem(key)))))).not.toContain(secret);

  const enrollmentCode = await currentTotp(secret);
  await page.getByLabel(/authenticator code/i).fill(enrollmentCode.code);
  await page.getByRole('button', { name: /confirm|enable/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // A separate context cannot inherit the setup session or grant and
  // therefore exercises the unknown-browser MFA path.
  const secondContext = await browser.newContext({ baseURL: 'http://localhost:4002', serviceWorkers: 'block' });
  const secondPage = await secondContext.newPage();
  try {
    await waitForNextTotpCounter(enrollmentCode.counter);
    await secondPage.goto('/login');
    await secondPage.getByLabel(/email/i).fill(EMAIL!);
    await secondPage.getByLabel(/password/i).fill(PASSWORD!);
    await secondPage.getByRole('button', { name: /sign in/i }).click();
    await expect(secondPage.locator('input[name="emailCode"]')).toBeVisible();
    expect((await secondContext.cookies('http://localhost:4002')).some((cookie) => cookie.name === 'pca_family_session')).toBe(false);

    const emailCode = setLoginStepUpCode(EMAIL!, '517284');
    await secondPage.locator('input[name="emailCode"]').fill(emailCode);
    await secondPage.locator('form button[type="submit"]').click();
    await expect(secondPage.locator('input[name="totpCode"]')).toBeVisible();
    expect((await secondContext.cookies('http://localhost:4002')).some((cookie) => cookie.name === 'pca_family_session')).toBe(false);

    const secondCode = await currentTotp(secret);
    await secondPage.locator('input[name="totpCode"]').fill(secondCode.code);
    await secondPage.locator('form button[type="submit"]').click();
    await expect(secondPage).toHaveURL(/\/dashboard$/);
    const sessionCookie = (await secondContext.cookies('http://localhost:4002')).find((cookie) => cookie.name === 'pca_family_session');
    expect(sessionCookie, 'successful TOTP relogin establishes the backend session cookie').toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    const dailyLoginGrantCookie = (await secondContext.cookies('http://localhost:4002')).find((cookie) => cookie.name === 'pca_parent_daily_login_grant');
    expect(dailyLoginGrantCookie, 'successful unknown-browser relogin trusts this browser').toBeDefined();
    expect(dailyLoginGrantCookie?.httpOnly).toBe(true);
  } finally {
    await secondContext.close();
  }
});
