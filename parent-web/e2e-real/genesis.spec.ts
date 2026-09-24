import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * REAL-BROWSER FAMILY GENESIS (PCA-DEC-020-R1), end to end against the live
 * Fastify backend + disposable MySQL, with the backend composed with the P-256
 * genesis verifier (CI sets PCA_GENESIS_DEVICE_SIGNATURE_VERIFIER=P256 for this
 * job ONLY; production stays fail-closed until the owner activates it).
 *
 * Journey: verified pre-family parent signs in -> GENESIS_REQUIRED -> /genesis
 * -> password step-up -> emailed code -> the browser generates a non-extractable
 * P-256 key, obtains a server challenge, signs proof + anchor + attestation ->
 * backend verifies possession and commits family + trusted device + ADMINISTRATOR
 * membership + authority chain atomically -> key enters durable per-account
 * IndexedDB custody -> FAMILY_READY -> Parent Console -> reload -> sign out /
 * sign in -> a different parent in the same browser gets nothing -> a real
 * browser restart keeps the same key.
 *
 * The ONE substitution: the step-up code is delivered by the backend's
 * in-process sandbox mailer, which a browser cannot read, so the spec replaces
 * the pending authorization's stored code hash with the hash of a code it
 * chose (backend/scripts/e2e-support/genesisE2eSupport.mjs; disposable DB only).
 */

const EMAIL = process.env.E2E_REAL_GENESIS_PARENT_EMAIL;
const PASSWORD = process.env.E2E_REAL_GENESIS_PARENT_PASSWORD;
const GRANT = process.env.E2E_REAL_GENESIS_PARENT_DAILY_GRANT;
const OTHER_EMAIL = process.env.E2E_REAL_SECOND_PARENT_EMAIL;
const OTHER_PASSWORD = process.env.E2E_REAL_SECOND_PARENT_PASSWORD;
const OTHER_GRANT = process.env.E2E_REAL_SECOND_PARENT_DAILY_GRANT;
const GRANT_COOKIE = 'pca_parent_daily_login_grant';
const BASE_URL = 'http://localhost:4002';
const STEP_UP_CODE = '246813';
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');

test.skip(
  !EMAIL || !PASSWORD || !GRANT || !OTHER_EMAIL || !OTHER_PASSWORD || !OTHER_GRANT,
  'genesis E2E requires the provisioned genesis + second parent fixtures (see backend/scripts/provision-e2e-accounts.mjs).',
);

function support(...args: string[]): Record<string, unknown> {
  const out = execFileSync('node', ['scripts/e2e-support/genesisE2eSupport.mjs', ...args], { cwd: BACKEND_DIR, env: process.env, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!);
}

async function signIn(page: Page, email: string, password: string, grant: string) {
  await page.context().addCookies([{ name: GRANT_COOKIE, value: grant, url: BASE_URL }]);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

async function session(page: Page): Promise<{ accountId: string; familyId: string | null; role: string | null; genesisAvailable?: boolean }> {
  return page.evaluate(async () => (await fetch('/api/parent/session', { credentials: 'include' })).json());
}

async function signOut(page: Page) {
  await page.evaluate(async () => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('pca_family_csrf='))?.split('=')[1];
    await fetch('/api/parent/logout', { method: 'POST', credentials: 'include', headers: csrf ? { 'X-PCA-CSRF-Token': decodeURIComponent(csrf) } : {} });
  });
}

/** Reads the custody slot WITHOUT creating the database if it does not exist. */
async function custodySlot(page: Page, accountId: string) {
  return page.evaluate(async (slot) => {
    const known = await indexedDB.databases();
    if (!known.some((d) => d.name === 'pca-owner-device-key')) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pca-owner-device-key');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      if (!db.objectStoreNames.contains('custody')) return null;
      const record = await new Promise<{ binding: Record<string, string>; privateKey: CryptoKey; publicKey: CryptoKey } | undefined>((resolve, reject) => {
        const q = db.transaction('custody', 'readonly').objectStore('custody').get(slot);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      if (!record) return null;
      const data = new TextEncoder().encode('genesis-custody-probe');
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, data);
      const signs = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, record.publicKey, signature, data);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', record.publicKey));
      let binary = '';
      raw.forEach((b) => (binary += String.fromCharCode(b)));
      let exportRefused = false;
      try {
        await crypto.subtle.exportKey('pkcs8', record.privateKey);
      } catch {
        exportRefused = true;
      }
      return {
        binding: record.binding,
        extractable: record.privateKey.extractable,
        signs,
        exportRefused,
        publicKey: btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      };
    } finally {
      db.close();
    }
  }, `owner-device-key:${accountId}`);
}

test('real browser: a verified parent completes Genesis, becomes FAMILY_READY, and the device key is durable, account-bound and non-exportable', async () => {
  test.setTimeout(180_000);
  const profile = mkdtempSync(path.join(tmpdir(), 'pca-genesis-profile-'));
  let context: BrowserContext = await chromium.launchPersistentContext(profile, { baseURL: BASE_URL });
  try {
    let page = context.pages()[0] ?? (await context.newPage());

    await test.step('sign-in lands a pre-family parent on /genesis with genesis AVAILABLE', async () => {
      await signIn(page, EMAIL!, PASSWORD!, GRANT!);
      await expect(page).toHaveURL(/\/genesis$/);
      const before = await session(page);
      expect(before.familyId).toBeNull();
      expect(before.role).toBeNull();
      expect(before.genesisAvailable).toBe(true);
      expect(await custodySlot(page, before.accountId)).toBeNull();
    });

    await test.step('password step-up, emailed code, and the signed ceremony complete; the console opens', async () => {
      await page.getByLabel('Email address').fill(EMAIL!);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByLabel('Verification code')).toBeVisible();
      expect(support('set-step-up-code', EMAIL!, STEP_UP_CODE)).toEqual({ updated: 1 });
      await page.getByLabel('Verification code').fill(STEP_UP_CODE);
      await page.getByRole('button', { name: 'Verify and finish setup' }).click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    let accountId = '';
    let familyId = '';
    await test.step('the live session is FAMILY_READY with the real family and the ADMINISTRATOR role', async () => {
      const after = await session(page);
      expect(after.familyId).not.toBeNull();
      expect(after.role).toBe('ADMINISTRATOR');
      accountId = after.accountId;
      familyId = after.familyId!;
    });

    await test.step('the trusted device recorded by the server is the key held in IndexedDB custody', async () => {
      const device = support('genesis-device', EMAIL!) as { familyId: string; deviceId: string; keyId: string; publicKey: string; status: string };
      expect(device.familyId).toBe(familyId);
      expect(device.status).toBe('ACTIVE');
      const custody = await custodySlot(page, accountId);
      expect(custody).not.toBeNull();
      expect(custody!.binding).toMatchObject({ accountId, familyId, deviceId: device.deviceId, keyId: device.keyId });
      expect(custody!.publicKey).toBe(device.publicKey);
      expect(custody!.extractable).toBe(false);
      expect(custody!.exportRefused).toBe(true);
      expect(custody!.signs).toBe(true);
    });

    await test.step('no private key material reaches localStorage, sessionStorage or cookies', async () => {
      const dump = await page.evaluate(() => {
        const values: string[] = [document.cookie];
        for (const store of [localStorage, sessionStorage]) {
          for (let i = 0; i < store.length; i += 1) values.push(`${store.key(i)}=${store.getItem(store.key(i)!)}`);
        }
        return values.join('\n');
      });
      expect(dump).not.toMatch(/"d"\s*:/);
      expect(dump).not.toMatch(/PRIVATE KEY|pkcs8/i);
    });

    await test.step('a reload keeps FAMILY_READY and the same custodied key', async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/dashboard$/);
      expect((await session(page)).familyId).toBe(familyId);
      expect((await custodySlot(page, accountId))!.signs).toBe(true);
    });

    await test.step('a DIFFERENT parent signing into the same browser inherits nothing', async () => {
      await signOut(page);
      await signIn(page, OTHER_EMAIL!, OTHER_PASSWORD!, OTHER_GRANT!);
      await expect(page).toHaveURL(/\/dashboard$/);
      const other = await session(page);
      expect(other.accountId).not.toBe(accountId);
      expect(other.familyId).not.toBe(familyId);
      // The second parent's custody slot is empty: the first parent's key lives in
      // a slot only the first parent's account id opens.
      expect(await custodySlot(page, other.accountId)).toBeNull();
      await signOut(page);
    });

    await test.step('the genesis parent signs back in: FAMILY_READY again, and the device key is still theirs', async () => {
      await signIn(page, EMAIL!, PASSWORD!, GRANT!);
      await expect(page).toHaveURL(/\/dashboard$/);
      expect((await session(page)).familyId).toBe(familyId);
      expect((await custodySlot(page, accountId))!.binding.familyId).toBe(familyId);
    });

    await test.step('a real browser RESTART (same profile) keeps the same non-extractable key', async () => {
      const before = (await custodySlot(page, accountId))!.publicKey;
      await context.close();
      context = await chromium.launchPersistentContext(profile, { baseURL: BASE_URL });
      page = context.pages()[0] ?? (await context.newPage());
      await page.goto('/login');
      const after = await custodySlot(page, accountId);
      expect(after).not.toBeNull();
      expect(after!.publicKey).toBe(before);
      expect(after!.extractable).toBe(false);
      expect(after!.signs).toBe(true);
    });

    await test.step('Genesis cannot be repeated for a parent who already owns a family', async () => {
      await signIn(page, EMAIL!, PASSWORD!, GRANT!);
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto('/genesis');
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  } finally {
    await context.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});

test('real browser: a DIFFERENT browser signed in as the same parent holds no device key (key possession is per browser)', async ({ page }) => {
  await signIn(page, EMAIL!, PASSWORD!, GRANT!);
  await expect(page).toHaveURL(/\/dashboard$/);
  const current = await session(page);
  expect(await custodySlot(page, current.accountId)).toBeNull();
});
