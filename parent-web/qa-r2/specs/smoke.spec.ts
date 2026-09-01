import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH!, 'utf8'));
const PARENT = 'http://localhost:4012';
const ADMIN = 'http://localhost:4112';

function b32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); }
  const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret: string) {
  const ctr = Math.floor(Date.now() / 1000 / 30); const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); buf.writeUInt32BE(ctr >>> 0, 4);
  const h = createHmac('sha1', b32(secret)).update(buf).digest(); const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1000000;
  return String(code).padStart(6, '0');
}

test('REAL parent login through Chromium -> vite -> Fastify -> MySQL', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${PARENT}/login`);
  await page.getByLabel(/email/i).fill(M.parentAccounts['owner-cp-dashboard'].email);
  await page.getByLabel(/password/i).fill(M.seedPassword);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  expect(page.url()).toContain('/dashboard');
  console.log('PARENT_CONSOLE_ERRORS=' + JSON.stringify(errors));
});

test('REAL platform-admin login (password + TOTP) through Chromium', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const a = M.adminAccounts['app_owner'];
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel(/email/i).fill(a.email);
  await page.getByLabel(/password/i).fill(M.seedPassword);
  await page.getByLabel(/code|totp|authenticat/i).fill(totp(a.totpSecretBase32));
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  expect(page.url()).toContain('/dashboard');
  console.log('ADMIN_CONSOLE_ERRORS=' + JSON.stringify(errors));
});
