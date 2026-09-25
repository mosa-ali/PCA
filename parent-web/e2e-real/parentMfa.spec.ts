import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_REAL_MFA_PARENT_EMAIL;
const PASSWORD = process.env.E2E_REAL_MFA_PARENT_PASSWORD;
const SECRET = process.env.E2E_REAL_MFA_PARENT_TOTP_SECRET;

test.skip(!EMAIL || !PASSWORD || !SECRET, 'real Parent MFA E2E requires the disposable enrolled Parent fixture.');
test.use({ serviceWorkers: 'block' });

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
  // Leave a small margin at a 30-second boundary so the request cannot arrive
  // after this code has rolled out of the accepted TOTP window.
  while (30_000 - (Date.now() % 30_000) <= 3_000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return totp(secret);
}

async function waitForNextTotpCounter(usedCounter: number): Promise<void> {
  while (Math.floor(Date.now() / 30_000) <= usedCounter) await new Promise((resolve) => setTimeout(resolve, 500));
}

test('real browser: Parent MFA is required on each explicit login and makes no Microsoft identity request', async ({ page, context }) => {
  const microsoftRequests: string[] = [];
  const popups: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/login\.microsoftonline\.com|login\.windows\.net|sts\.windows\.net|account\.activedirectory\.windowsazure\.com|\b(login|auth)\.live\.com|\/common\/oauth2?\//i.test(url)) microsoftRequests.push(url);
  });
  context.on('page', (popup) => popups.push(popup.url()));

  // This disposable MFA account has no daily-login/browser grant. Its first
  // password-only response must ask for TOTP and must not issue a session.
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /authenticator|two-step/i })).toBeVisible();
  const beforeMfa = await context.cookies('http://localhost:4002');
  expect(beforeMfa.some((cookie) => cookie.name === 'pca_family_session')).toBe(false);

  const firstCode = await currentTotp(SECRET!);
  await page.locator('input[name="totp"]').fill(firstCode.code);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const sessionCookie = (await context.cookies('http://localhost:4002')).find((cookie) => cookie.name === 'pca_family_session');
  expect(sessionCookie, 'successful TOTP login establishes the backend session cookie').toBeDefined();
  expect(sessionCookie?.httpOnly).toBe(true);

  // The ordinary session survives reload. Logout then starts a new explicit
  // login, which must request a later, non-replayed authenticator counter.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: /your account/i }).click();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
  await waitForNextTotpCounter(firstCode.counter);

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('input[name="totp"]')).toBeVisible();
  const secondCode = await currentTotp(SECRET!);
  await page.locator('input[name="totp"]').fill(secondCode.code);
  await page.getByRole('button', { name: /verify and sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  expect(microsoftRequests, 'Parent authentication must not contact Microsoft identity endpoints').toEqual([]);
  expect(popups, 'Parent authentication must not open an identity popup').toEqual([]);
});
