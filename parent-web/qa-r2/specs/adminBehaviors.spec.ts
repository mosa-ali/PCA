/**
 * platform-admin-web P1/P2 behavior evidence -- client-side navigation only.
 *
 * WHY THIS IS SEPARATE. platform-admin-web's session token is deliberately
 * in-memory only (secureSession.ts, PCA-ADD-PA-014/016), so ANY hard
 * navigation drops it and lands back on /login. An earlier pass that used
 * page.goto() per route therefore captured the login page 16 times and no real
 * page evidence at all. Every route here is reached the way an operator
 * reaches it: by clicking the real sidebar NavLink, or (for the two routes not
 * in the sidebar) by a genuine client-side router transition. The mechanism
 * used is recorded per route so the evidence is auditable.
 */
import { test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname } from 'node:path';

const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH!, 'utf8'));
const ROUTES = JSON.parse(readFileSync(process.env.QA_ROUTES_PATH!, 'utf8')) as Array<{
  app: string; route: string; page: string; priority: string;
}>;
const OUT = process.env.QA_BEHAVIOR_OUT!;
const ADMIN = 'http://localhost:4112';
const LANG = (process.env.QA_LANG ?? 'EN') as 'EN' | 'AR';
const VP_NAME = process.env.QA_VIEWPORT ?? 'desktop-1440x900';
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  'mobile-375x812': { width: 375, height: 812 },
  'desktop-1440x900': { width: 1440, height: 900 },
};

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
  const code = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1000000;
  return String(code).padStart(6, '0');
}

const EXTERNAL_GATE_MARKERS = [
  'not trusted with your family', 'has not been security-reviewed',
  'no real (non-fixture) backend', 'not yet available', 'not connected to PCA',
  'BROWSER_NOT_TRUSTED', 'PENDING_TRUSTED_DECRYPTION',
  'غير موثوق', 'لم تتم مراجعته', 'غير متاح بعد', 'غير متوفرة',
];
const RAW_ENUM = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+){1,}\b/g;
const ENUM_ALLOW = new Set(['PCA', 'USD', 'SAR', 'YER', 'JSON', 'HTTP', 'HTTPS', 'UTC', 'API', 'URL', 'RTL', 'LTR', 'MFA', 'TOTP']);

const evidence: Record<string, unknown>[] = [];

function recorders(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 250)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 250)));
  page.on('response', (r) => {
    const s = r.status(); if (s < 400) return;
    const p = new URL(r.url()).pathname;
    if (!(s === 401 && p === '/platform-admin/auth/whoami')) httpFailures.push(`${s} ${r.request().method()} ${p}`);
  });
  return { consoleErrors, pageErrors, httpFailures };
}

async function probeControls(page: Page) {
  return page.evaluate(() => {
    const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const labelFor = (el: Element) => {
      const id = el.getAttribute('id');
      if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return txt(l); }
      const wrap = el.closest('label');
      if (wrap) return txt(wrap);
      return el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '';
    };
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map((b) => ({
      text: txt(b),
      disabled: (b as HTMLButtonElement).disabled === true || b.getAttribute('aria-disabled') === 'true',
    }));
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map((i) => ({
      type: i.getAttribute('type') ?? i.tagName.toLowerCase(),
      id: i.getAttribute('id') ?? '', label: labelFor(i),
    }));
    const selects = Array.from(document.querySelectorAll('select')).map((s) => ({
      id: s.getAttribute('id') ?? '', label: labelFor(s),
      options: Array.from(s.querySelectorAll('option')).map((o) => txt(o)).slice(0, 12),
    }));
    const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
      className: t.getAttribute('class') ?? '',
      headers: Array.from(t.querySelectorAll('th')).map((h) => txt(h)).slice(0, 14),
      rowCount: t.querySelectorAll('tbody tr').length,
      hasDataLabel: t.querySelector('td[data-label]') !== null,
    }));
    return {
      buttons, inputs, selects, tables,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => ({ level: h.tagName, text: txt(h) })).slice(0, 14),
      formCount: document.querySelectorAll('form').length,
      hasSearchAffordance: Array.from(document.querySelectorAll('input')).some((i) =>
        (i.getAttribute('type') ?? '') === 'search'
        || /search|بحث/i.test((i.getAttribute('placeholder') ?? '') + (i.getAttribute('aria-label') ?? '') + (i.getAttribute('id') ?? ''))),
      hasPaginationAffordance: Array.from(document.querySelectorAll('button, a')).some((b) =>
        /next|previous|prev\b|show more|load more|page \d|التالي|السابق|المزيد/i.test(b.textContent ?? '')),
      hasSortAffordance: document.querySelector('[aria-sort]') !== null
        || Array.from(document.querySelectorAll('button, th, select')).some((b) => /sort|ترتيب/i.test(b.textContent ?? '')),
      hasFilterAffordance: document.querySelectorAll('select').length > 0
        || Array.from(document.querySelectorAll('input')).some((i) => /filter|status/i.test((i.getAttribute('id') ?? '') + (i.getAttribute('aria-label') ?? ''))),
      emptyStateEl: document.querySelector('.empty-state, [data-testid*="empty"]') !== null,
      errorStateEl: document.querySelector('.error-state, [role="alert"]') !== null,
    };
  });
}

/** True when what is on screen is the sign-in page rather than a real page. */
async function looksLikeLogin(page: Page) {
  const t = await page.locator('body').innerText().catch(() => '');
  return /Operator access only|وصول المشغّلين فقط/.test(t);
}

/** Client-side navigation: real sidebar click when possible, router transition otherwise. */
async function navigate(page: Page, path: string): Promise<string> {
  const link = page.locator(`a.nav-link[href="${path}"]`);
  if (await link.count() > 0) {
    await link.first().click();
    await page.waitForTimeout(1300);
    return 'sidebar-click';
  }
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(1300);
  return 'router-transition';
}

async function capture(page: Page, route: string, priority: string, mechanism: string, rec: ReturnType<typeof recorders>) {
  const body = await page.locator('body').innerText().catch(() => '');
  const controls = await probeControls(page);
  const dir = await page.evaluate(() => document.documentElement.getAttribute('dir') ?? '');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const onLogin = /Operator access only|وصول المشغّلين فقط/.test(body);
  const enums = Array.from(new Set((body.match(RAW_ENUM) ?? []).filter((e) => !ENUM_ALLOW.has(e))));
  const blocked = EXTERNAL_GATE_MARKERS.some((m) => body.includes(m));
  const actualPath = await page.evaluate(() => window.location.pathname);

  evidence.push({
    app: 'platform-admin-web', route, priority, lang: LANG, viewport: VP_NAME,
    persona: 'APP_OWNER', mechanism, actualPath,
    sessionHeld: !onLogin,
    status: onLogin ? 'SESSION_LOST' : rec.pageErrors.length ? 'PAGE_ERROR' : blocked ? 'BLOCKED_EXTERNAL' : 'RENDERED',
    renderedChars: body.trim().length,
    dir, horizontalOverflow: overflow,
    rawEnums: enums.slice(0, 10),
    bodyText: body.replace(/\s+/g, ' ').slice(0, 2200),
    controls,
    consoleErrors: rec.consoleErrors.slice(0, 5),
    pageErrors: rec.pageErrors.slice(0, 3),
    httpFailures: Array.from(new Set(rec.httpFailures)).slice(0, 8),
  });
}

test.describe.configure({ mode: 'serial' });

test('platform-admin-web P1/P2 behavior evidence (client-side nav)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[VP_NAME], locale: LANG === 'AR' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  const rec = recorders(page);

  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  if (LANG === 'AR') {
    // Set the language BEFORE signing in: after login no reload may happen.
    const arBtn = page.locator('button', { hasText: /^AR$/ });
    if (await arBtn.count() > 0) { await arBtn.first().click(); await page.waitForTimeout(400); }
  }

  const a = M.adminAccounts.app_owner;
  await page.locator('#login-email').fill(a.email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('#login-totp').fill(totp(a.totpSecretBase32));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
  if (await looksLikeLogin(page)) throw new Error('admin login did not establish a session');

  const routes = ROUTES.filter((r) => r.app === 'platform-admin-web');

  // Sidebar-reachable routes first, then the account-detail drill-down, then
  // the remaining unlinked route -- all without a single hard navigation.
  for (const r of routes.filter((x) => !x.route.includes(':') && x.route !== '/not-permitted')) {
    const mech = await navigate(page, r.route);
    await capture(page, r.route, r.priority, mech, rec);
  }

  const detail = routes.find((x) => x.route === '/accounts/:id');
  if (detail) {
    await navigate(page, '/accounts');
    const row = page.locator('table a[href^="/accounts/"]').first();
    let mech = 'row-click';
    if (await row.count() > 0) {
      await row.click();
      await page.waitForTimeout(1400);
    } else {
      const accounts = Object.values(M.parentAccounts) as Array<{ familyId?: string }>;
      const familyId = accounts.find((p) => p.familyId)?.familyId;
      mech = await navigate(page, `/accounts/${familyId}`);
    }
    await capture(page, '/accounts/:id', detail.priority, mech, rec);
  }

  const np = routes.find((x) => x.route === '/not-permitted');
  if (np) {
    const mech = await navigate(page, '/not-permitted');
    await capture(page, '/not-permitted', np.priority, mech, rec);
  }

  await ctx.close();
});

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 1), 'utf8');
  const by: Record<string, number> = {};
  evidence.forEach((e) => { const s = String(e.status); by[s] = (by[s] ?? 0) + 1; });
  const lost = evidence.filter((e) => e.sessionHeld === false).length;
  console.log(`ADMIN EVIDENCE ${LANG}/${VP_NAME}: ${evidence.length} routes ${JSON.stringify(by)} sessionLost=${lost}`);
});
