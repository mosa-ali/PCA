/**
 * Final closure re-check: only the routes the local commit range touches.
 *
 *   parent-web         /children/:childId/screen-time   (35597ee)
 *   parent-web         /privacy/permissions             (d2b3042)
 *   platform-admin-web /audit, /accounts, /accounts/:id, /settings  (b43a9f0)
 *
 * Asserts the four closure properties on each: no product-attributable failed
 * API call, no uncaught page error, no horizontal overflow, no raw
 * user-facing enum. Admin routes are reached by clicking real sidebar links,
 * never page.goto() -- a hard navigation drops the in-memory admin session and
 * would silently capture the login page instead of the route under test.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname } from 'node:path';

const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH!, 'utf8'));
const OUT = process.env.QA_CLOSURE_OUT!;
const PARENT = 'http://localhost:4012';
const ADMIN = 'http://localhost:4112';
const VP = process.env.QA_VIEWPORT === 'mobile-375x812'
  ? { width: 375, height: 812 }
  : { width: 1440, height: 900 };
const VP_NAME = process.env.QA_VIEWPORT ?? 'desktop-1440x900';

// A raw backend code leaking into user-facing copy.
const RAW_ENUM = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+){1,}\b/g;
const ENUM_ALLOW = new Set(['PCA', 'USD', 'SAR', 'YER', 'JSON', 'HTTP', 'HTTPS', 'UTC', 'API', 'URL', 'RTL', 'LTR', 'MFA', 'TOTP']);

const results: Record<string, unknown>[] = [];

function recorders(page: Page) {
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];
  const syncCalls: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 250)));
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/sync')) syncCalls.push(`${r.method()} ${p}`);
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400) return;
    const p = new URL(r.url()).pathname;
    // A 401 on the app's own session probe from a public/unauthenticated page
    // is the correct answer, not a failure.
    const probe = s === 401 && (p === '/api/parent/session' || p === '/platform-admin/auth/whoami');
    if (!probe) httpFailures.push(`${s} ${r.request().method()} ${p}`);
  });
  return { pageErrors, httpFailures, syncCalls };
}

/**
 * Raw enums that are DELIBERATE verbatim citations, scoped by DOM position:
 *   - /privacy/permissions renders AndroidManifest.xml identifiers inside
 *     code.permission-entry-id, each paired with a human-readable name.
 *   - /audit renders the logged metadata JSON verbatim inside
 *     pre.audit-metadata; reinterpreting it would corrupt the audit record.
 * Anything OUTSIDE those containers is a real leak.
 */
async function leakedEnums(page: Page) {
  return page.evaluate(({ pattern, allow }) => {
    const re = new RegExp(pattern, 'g');
    const allowed = new Set(allow);
    const leaks: Array<{ tokens: string[]; tag: string; text: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = n.textContent ?? '';
      const found = (text.match(re) ?? []).filter((t) => !allowed.has(t));
      if (found.length === 0) continue;
      const el = (n as Text).parentElement;
      if (el?.closest('pre.audit-metadata')) continue;        // verbatim audit record
      if (el?.closest('code.permission-entry-id')) continue;  // verbatim manifest citation
      leaks.push({
        tokens: Array.from(new Set(found)).slice(0, 5),
        tag: el?.tagName ?? '',
        text: text.trim().slice(0, 90),
      });
    }
    return leaks;
  }, { pattern: RAW_ENUM.source, allow: [...ENUM_ALLOW] });
}

async function assess(page: Page, app: string, route: string, rec: ReturnType<typeof recorders>) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const leaks = await leakedEnums(page);
  const body = await page.locator('body').innerText().catch(() => '');
  const row = {
    app, route, viewport: VP_NAME,
    renderedChars: body.trim().length,
    horizontalOverflow: overflow,
    pageErrors: rec.pageErrors,
    httpFailures: Array.from(new Set(rec.httpFailures)),
    syncCalls: rec.syncCalls,
    leakedEnums: leaks,
    pass: !overflow && rec.pageErrors.length === 0 && rec.httpFailures.length === 0 && leaks.length === 0,
  };
  results.push(row);
  expect(rec.pageErrors, `${route}: uncaught page errors`).toEqual([]);
  expect(row.httpFailures, `${route}: failed API calls`).toEqual([]);
  expect(overflow, `${route}: horizontal overflow at ${VP_NAME}`).toBe(false);
  expect(leaks, `${route}: raw user-facing enums`).toEqual([]);
  return row;
}

function b32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0');
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret: string) {
  const ctr = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); buf.writeUInt32BE(ctr >>> 0, 4);
  const h = createHmac('sha1', b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1000000).padStart(6, '0');
}

test.describe.configure({ mode: 'serial' });

test('parent-web routes changed by this range', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(M.parentAccounts['owner-cp-dashboard'].email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });

  {
    const rec = recorders(page);
    await page.goto(`${PARENT}/children/child-sweep-probe/screen-time`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const row = await assess(page, 'parent-web', '/children/:childId/screen-time', rec);
    // The specific regression 35597ee fixes.
    expect(row.syncCalls, 'no request may be issued to the nonexistent /api/sync surface').toEqual([]);
  }
  {
    const rec = recorders(page);
    await page.goto(`${PARENT}/privacy/permissions`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    await assess(page, 'parent-web', '/privacy/permissions', rec);
    // Each verbatim identifier must still be paired with a human-readable name.
    const paired = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.permission-entry-term')).every((t) => {
        const name = (t.querySelector('.permission-entry-name')?.textContent ?? '').trim();
        const code = t.querySelector('code.permission-entry-id');
        return name.length > 0 && !/^[A-Z0-9_]+$/.test(name) && code !== null;
      }));
    expect(paired, 'every manifest identifier is paired with a human-readable name').toBe(true);
  }
  await ctx.close();
});

test('platform-admin-web routes changed by this range', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const rec = recorders(page);

  const a = M.adminAccounts.app_owner_audit_route;
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(a.email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('#login-totp').fill(totp(a.totpSecretBase32));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });

  // Client-side navigation only: the admin session is in-memory, so a hard
  // navigation would drop it. The context starts at desktop width (where the
  // sidebar links are directly clickable) and, for the mobile run, the
  // viewport is narrowed AFTER arriving on each route. This SPA re-lays out on
  // resize without a reload, so the measurement is the real mobile layout of
  // the real authenticated page -- and it avoids depending on the drawer
  // animation, which is covered by its own responsive test.
  const MOBILE = VP_NAME === 'mobile-375x812';
  async function navByLink(route: string) {
    if (MOBILE) await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(`a.nav-link[href="${route}"]`).first().click();
    await page.waitForTimeout(1200);
    if (MOBILE) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(900);
    }
  }

  for (const route of ['/accounts', '/audit', '/settings']) {
    await navByLink(route);
    await assess(page, 'platform-admin-web', route, rec);
  }

  // Account detail via a real row click, not a hard navigation.
  await navByLink('/accounts');
  if (MOBILE) await page.setViewportSize({ width: 1440, height: 900 });
  const row = page.locator('table a[href^="/accounts/"]').first();
  if (await row.count() > 0) {
    await row.click();
    await page.waitForTimeout(1200);
    if (MOBILE) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(900);
    }
    await assess(page, 'platform-admin-web', '/accounts/:id', rec);
  }
  await ctx.close();
});

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.viewport}  ${r.app} ${r.route}`);
  }
});
