/**
 * P1/P2 behavior evidence pass.
 *
 * Visits every P1/P2 route in a real Chromium against the real stack and
 * captures the concrete facts each catalogued behavior is classified against:
 * which interactive controls actually exist, whether search/filter/sort/
 * pagination affordances are present, what error/empty/loading state renders,
 * what the console and network actually did, and (per language/viewport) the
 * direction, overflow and raw-enum situation.
 *
 * This gathers EVIDENCE ONLY -- it deliberately asserts almost nothing, so a
 * behavior is classified from observed fact rather than from a route loading.
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
const PARENT = 'http://localhost:4012';
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
  'BROWSER_NOT_TRUSTED', 'not been human-security-reviewed', 'cryptoGate',
  'TRUSTED browser endpoint', 'PENDING_TRUSTED_DECRYPTION',
  'ليس موثوقًا', 'لم تتم مراجعته', 'غير متاح بعد', 'غير متوفرة', 'غير متصلة',
];
const RAW_ENUM = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+){1,}\b/g;
const ENUM_ALLOW = new Set(['PCA', 'USD', 'SAR', 'YER', 'JSON', 'HTTP', 'HTTPS', 'UTC', 'API', 'URL', 'RTL', 'LTR']);

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
    const probe = s === 401 && (p === '/api/parent/session' || p === '/platform-admin/auth/whoami');
    if (!probe) httpFailures.push(`${s} ${r.request().method()} ${p}`);
  });
  return { consoleErrors, pageErrors, httpFailures };
}

async function loginParent(page: Page, key: string) {
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(M.parentAccounts[key].email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}
async function loginAdmin(page: Page, key: string) {
  const a = M.adminAccounts[key];
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(a.email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('#login-totp').fill(totp(a.totpSecretBase32));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}
async function setArabic(page: Page) {
  if (LANG !== 'AR') return;
  await page.evaluate(() => {
    try {
      localStorage.setItem('pca.parent-web.language', 'ar');
      localStorage.setItem('i18nextLng', 'ar');
    } catch { /* ?lng= fallback */ }
  });
}

const INVOICE_PERSONA = 'owner-bill-detail';
function resolveRoute(route: string): string | null {
  if (!route.includes(':')) return route;
  if (route.includes(':childId')) return route.replace(':childId', 'child-sweep-probe');
  if (route.includes(':invoiceId')) {
    const inv = (M.invoices ?? {})[INVOICE_PERSONA] as { paidInvoiceId?: string } | undefined;
    return inv?.paidInvoiceId ? route.replace(':invoiceId', inv.paidInvoiceId) : null;
  }
  if (route.includes(':id')) {
    const accounts = Object.values(M.parentAccounts ?? {}) as Array<{ familyId?: string }>;
    const first = accounts.find((p) => p.familyId);
    return first?.familyId ? route.replace(':id', first.familyId) : null;
  }
  return null;
}

/** Everything a behavior might need to be judged, read out of the live DOM. */
async function probeControls(page: Page) {
  return page.evaluate(() => {
    const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const labelFor = (el: Element) => {
      const id = el.getAttribute('id');
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l) return txt(l);
      }
      const wrap = el.closest('label');
      if (wrap) return txt(wrap);
      return el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '';
    };
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map((b) => ({
      text: txt(b),
      disabled: (b as HTMLButtonElement).disabled === true || b.getAttribute('aria-disabled') === 'true',
      type: b.getAttribute('type') ?? '',
    }));
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map((i) => ({
      type: i.getAttribute('type') ?? i.tagName.toLowerCase(),
      id: i.getAttribute('id') ?? '',
      label: labelFor(i),
      disabled: (i as HTMLInputElement).disabled === true,
    }));
    const selects = Array.from(document.querySelectorAll('select')).map((s) => ({
      id: s.getAttribute('id') ?? '',
      label: labelFor(s),
      options: Array.from(s.querySelectorAll('option')).map((o) => txt(o)).slice(0, 12),
    }));
    const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
      text: txt(a), href: a.getAttribute('href') ?? '',
    }));
    const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
      className: t.getAttribute('class') ?? '',
      headers: Array.from(t.querySelectorAll('th')).map((h) => txt(h)).slice(0, 14),
      rowCount: t.querySelectorAll('tbody tr').length,
      hasDataLabel: t.querySelector('td[data-label]') !== null,
    }));
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => ({
      level: h.tagName, text: txt(h),
    })).slice(0, 14);
    return {
      buttons, inputs, selects, tables, headings,
      linkCount: links.length,
      links: links.slice(0, 30),
      formCount: document.querySelectorAll('form').length,
      listItemCount: document.querySelectorAll('li').length,
      // affordance heuristics the audit's gap vocabulary refers to
      hasSearchAffordance: Array.from(document.querySelectorAll('input')).some((i) =>
        (i.getAttribute('type') ?? '') === 'search'
        || /search|بحث/i.test((i.getAttribute('placeholder') ?? '') + (i.getAttribute('aria-label') ?? '') + (i.getAttribute('id') ?? ''))),
      hasPaginationAffordance: Array.from(document.querySelectorAll('button, a')).some((b) =>
        /next|previous|prev\b|show more|load more|page \d|التالي|السابق|المزيد/i.test((b.textContent ?? ''))),
      hasSortAffordance: Array.from(document.querySelectorAll('button, th, select')).some((b) =>
        /sort|ترتيب/i.test((b.textContent ?? '') + (b.getAttribute('aria-sort') ?? '')))
        || document.querySelector('[aria-sort]') !== null,
      hasFilterAffordance: Array.from(document.querySelectorAll('select, input, button')).some((b) =>
        /filter|status|all\b|تصفية|الحالة/i.test((b.getAttribute('aria-label') ?? '') + (b.getAttribute('id') ?? '') + (b.textContent ?? ''))),
      emptyStateEl: document.querySelector('.empty-state, [data-testid*="empty"]') !== null,
      errorStateEl: document.querySelector('.error-state, [role="alert"]') !== null,
      loadingStateEl: document.querySelector('.loading-state, [aria-busy="true"]') !== null,
    };
  });
}

async function visit(page: Page, app: string, route: string, priority: string, persona: string) {
  const rec = recorders(page);
  const base = app === 'parent-web' ? PARENT : ADMIN;
  const path = resolveRoute(route);
  if (path === null) {
    evidence.push({ app, route, priority, lang: LANG, viewport: VP_NAME, persona, status: 'UNRESOLVABLE' });
    return;
  }
  const url = `${base}${path}${LANG === 'AR' && app === 'parent-web' ? (path.includes('?') ? '&' : '?') + 'lng=ar' : ''}`;
  const ev: Record<string, unknown> = { app, route, priority, url, lang: LANG, viewport: VP_NAME, persona };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1400);
    const body = await page.locator('body').innerText().catch(() => '');
    const controls = await probeControls(page);
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir') ?? '');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    const enums = Array.from(new Set((body.match(RAW_ENUM) ?? []).filter((e) => !ENUM_ALLOW.has(e))));
    const blocked = EXTERNAL_GATE_MARKERS.some((m) => body.includes(m));

    Object.assign(ev, {
      status: rec.pageErrors.length ? 'PAGE_ERROR' : blocked ? 'BLOCKED_EXTERNAL' : 'RENDERED',
      renderedChars: body.trim().length,
      dir, horizontalOverflow: overflow,
      rawEnums: enums.slice(0, 10),
      bodyText: body.replace(/\s+/g, ' ').slice(0, 2200),
      controls,
      consoleErrors: rec.consoleErrors.slice(0, 5),
      pageErrors: rec.pageErrors.slice(0, 3),
      httpFailures: Array.from(new Set(rec.httpFailures)).slice(0, 8),
    });
  } catch (e) {
    Object.assign(ev, { status: 'ERROR', notes: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
  }
  evidence.push(ev);
}

test.describe.configure({ mode: 'serial' });

const PARENT_PUBLIC = new Set(['/register', '/verify-email', '/login', '/forgot-password', '/reset-password']);

test('parent-web P1/P2 behavior evidence', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[VP_NAME], locale: LANG === 'AR' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await setArabic(page);

  const routes = ROUTES.filter((r) => r.app === 'parent-web');
  for (const r of routes.filter((x) => PARENT_PUBLIC.has(x.route))) {
    await visit(page, r.app, r.route, r.priority, 'unauthenticated');
  }
  await loginParent(page, 'owner-cp-dashboard');
  const INVOICE_ROUTE = '/subscription/invoices/:invoiceId';
  for (const r of routes.filter((x) => !PARENT_PUBLIC.has(x.route) && x.route !== INVOICE_ROUTE)) {
    await visit(page, r.app, r.route, r.priority, 'OWNER');
  }
  await ctx.close();

  const inv = routes.find((x) => x.route === INVOICE_ROUTE);
  if (inv) {
    const ctx2 = await browser.newContext({ viewport: VIEWPORTS[VP_NAME], locale: LANG === 'AR' ? 'ar' : 'en-US' });
    const page2 = await ctx2.newPage();
    await page2.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
    await setArabic(page2);
    await loginParent(page2, INVOICE_PERSONA);
    await visit(page2, inv.app, inv.route, inv.priority, 'OWNER(invoice-owner)');
    await ctx2.close();
  }
});

test('platform-admin-web P1/P2 behavior evidence', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[VP_NAME], locale: LANG === 'AR' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  const routes = ROUTES.filter((r) => r.app === 'platform-admin-web');
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  if (LANG === 'AR') {
    await page.evaluate(() => { try { localStorage.setItem('i18nextLng', 'ar'); } catch { /* ignore */ } });
  }
  await loginAdmin(page, 'app_owner');
  for (const r of routes) {
    await visit(page, r.app, r.route, r.priority, 'APP_OWNER');
  }
  await ctx.close();
});

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 1), 'utf8');
  const by: Record<string, number> = {};
  evidence.forEach((e) => { const s = String(e.status); by[s] = (by[s] ?? 0) + 1; });
  console.log(`BEHAVIOR EVIDENCE ${LANG}/${VP_NAME}: ${evidence.length} routes ${JSON.stringify(by)}`);
});
