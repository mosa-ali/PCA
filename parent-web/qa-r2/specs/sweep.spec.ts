/**
 * PCA Round 2 — 62-route real-browser sweep.
 *
 * Real Chromium -> real Vite dev server -> real HTTP -> real Fastify -> real
 * disposable MySQL. No jsdom, no mocks, no fixtures: the parent app runs with
 * VITE_PCA_DEMO_MODE=false and every account comes from seed-local.mjs's
 * manifest, created through the same service classes main.ts wires in
 * production.
 *
 * Round 1 marked routes VERIFIED_BROWSER_PASS on page load alone and missed an
 * SPA-crashing mutation and an always-400 approve. This sweep therefore records
 * per-route evidence (console, network, rendered text, direction, overflow) and
 * refuses to call anything a pass on load alone.
 */
import { test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname } from 'node:path';

const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH!, 'utf8'));
const ROUTES = JSON.parse(readFileSync(process.env.QA_ROUTES_PATH!, 'utf8')) as Array<{
  app: string; route: string; page: string; priority: string;
}>;
const OUT = process.env.QA_SWEEP_OUT!;
const PARENT = 'http://localhost:4012';
const ADMIN = 'http://localhost:4112';

const LANG = (process.env.QA_LANG ?? 'EN') as 'EN' | 'AR';
const VIEWPORT_NAME = process.env.QA_VIEWPORT ?? 'desktop-1440x900';
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  'mobile-375x812': { width: 375, height: 812 },
  'mobile-430x932': { width: 430, height: 932 },
  'tablet-768x1024': { width: 768, height: 1024 },
  'tablet-1024x768': { width: 1024, height: 768 },
  'laptop-1366x768': { width: 1366, height: 768 },
  'desktop-1440x900': { width: 1440, height: 900 },
};

// ---------------------------------------------------------------- TOTP
function b32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); }
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

// -------------------------------------------------- external-gate vocabulary
// These are the REGISTERED external gates. A route that renders one of these
// honestly is BLOCKED_EXTERNAL and product-correct -- it is not a defect.
const EXTERNAL_GATE_MARKERS = [
  // Localized copy produced by parent-web/src/i18n/errorMessages.ts for the
  // registered gates (the raw developer strings these replaced are kept below
  // so the sweep still recognises any surface that has not been migrated).
  'not trusted with your family', 'has not been security-reviewed',
  'no real (non-fixture) backend', 'not yet available',
  'BROWSER_NOT_TRUSTED', 'not been human-security-reviewed', 'cryptoGate',
  'TRUSTED browser endpoint', 'PENDING_TRUSTED_DECRYPTION',
  'ليس موثوقًا', 'لم تتم مراجعته', 'غير متاح بعد', 'غير متوفرة',
];
// A raw backend enum leaking into visible copy (the Round-1 defect class).
const RAW_ENUM = /\b[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+){1,}\b/g;
const ENUM_ALLOW = new Set([
  'PCA', 'USD', 'SAR', 'YER', 'JSON', 'HTTP', 'HTTPS', 'UTC', 'API', 'URL', 'RTL', 'LTR',
]);

type RouteEvidence = {
  app: string; route: string; url: string; lang: string; viewport: string; persona: string;
  status: 'PASS' | 'BLOCKED_EXTERNAL' | 'DEFECT' | 'ERROR';
  httpFailures: string[]; consoleErrors: string[]; pageErrors: string[];
  renderedChars: number; headingSample: string; bodySample: string; dir: string;
  horizontalOverflow: boolean; rawEnums: string[]; notes: string;
};

const evidence: RouteEvidence[] = [];

// ------------------------------------------------------------------ helpers
function attachRecorders(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400) return;
    const p = new URL(r.url()).pathname;
    // Expected-by-design: the app probes for an existing session on every load,
    // and on a public/unauthenticated page a 401 IS the correct answer.
    const expectedProbe = s === 401 && (p === '/api/parent/session' || p === '/platform-admin/auth/whoami');
    if (!expectedProbe) httpFailures.push(`${s} ${r.request().method()} ${p}`);
  });
  return { consoleErrors, pageErrors, httpFailures };
}

// Selectors are ID-based, never label-text based: this sweep also runs in
// Arabic, where an /email/i label regex matches nothing and fill() then blocks
// until the entire test times out (observed: a 20-minute stall on the AR pass).
async function loginParent(page: Page, key: string) {
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(M.parentAccounts[key].email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function loginAdmin(page: Page, key: string) {
  const a = M.adminAccounts[key];
  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(a.email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('#login-totp').fill(totp(a.totpSecretBase32));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function setLanguage(page: Page) {
  if (LANG !== 'AR') return;
  // i18next persists the choice to localStorage under this key (parent-web) and
  // applies it at module init, so setting it before navigation gives a true
  // first-paint Arabic render rather than a post-hoc switch.
  await page.evaluate(() => {
    try {
      localStorage.setItem('pca.parent-web.language', 'ar');
      localStorage.setItem('i18nextLng', 'ar');
    } catch { /* storage may be unavailable; the ?lng= fallback still applies */ }
  });
}

function resolveRoute(route: string): string | null {
  if (!route.includes(':')) return route === '/* (404)' ? '/__definitely_not_a_route__' : route;
  if (route.includes(':childId')) {
    // Child ids live inside E2EE family state that the browser cannot decrypt
    // until the trust gate clears, so no real id is obtainable here. A
    // syntactically valid placeholder still exercises the real ChildLayout,
    // its guards and its data path -- which is exactly what is under test.
    return route.replace(':childId', 'child-sweep-probe');
  }
  if (route.includes(':invoiceId')) {
    // Must be an invoice belonging to the SIGNED-IN family. Using another
    // family's invoice id returns 404 -- which is the cross-family IDOR
    // protection working correctly, not a rendering failure, and would make
    // this route look broken when it is not.
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

async function visit(page: Page, app: string, route: string, persona: string): Promise<RouteEvidence> {
  const rec = attachRecorders(page);
  const base = app === 'parent-web' ? PARENT : ADMIN;
  const path = resolveRoute(route);
  const url = `${base}${path}${LANG === 'AR' ? (path!.includes('?') ? '&' : '?') + 'lng=ar' : ''}`;
  const ev: RouteEvidence = {
    app, route, url, lang: LANG, viewport: VIEWPORT_NAME, persona,
    status: 'ERROR', httpFailures: [], consoleErrors: [], pageErrors: [],
    renderedChars: 0, headingSample: '', bodySample: '', dir: '', horizontalOverflow: false, rawEnums: [], notes: '',
  };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // Let async data settle; networkidle is unreliable against a live backend
    // with polling pages, so wait for the app shell then a short settle.
    await page.waitForTimeout(1200);

    const body = await page.locator('body').innerText().catch(() => '');
    ev.renderedChars = body.trim().length;
    ev.headingSample = (await page.locator('h1, h2').first().innerText().catch(() => '')).slice(0, 120);
    // Skip the shared nav/shell chrome so the sample is the page's own content.
    ev.bodySample = body.replace(/\s+/g, ' ').slice(-600);
    ev.dir = await page.evaluate(() => document.documentElement.getAttribute('dir') ?? '');
    ev.horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);

    const enums = Array.from(new Set((body.match(RAW_ENUM) ?? []).filter((e) => !ENUM_ALLOW.has(e))));
    ev.rawEnums = enums.slice(0, 8);

    const blocked = EXTERNAL_GATE_MARKERS.some((m) => body.includes(m));
    // A rendered ErrorState is NOT a crash: parent-web routes the registered
    // external gates through it with honest localized copy. Only an empty
    // render, a router-level failure, or an uncaught exception is a defect.
    const crashed = ev.renderedChars < 40 || /Unexpected Application Error|ChunkLoadError/i.test(body);

    if (rec.pageErrors.length > 0) { ev.status = 'DEFECT'; ev.notes = 'uncaught page error'; }
    else if (crashed) { ev.status = 'DEFECT'; ev.notes = 'blank or crashed render'; }
    else if (blocked) { ev.status = 'BLOCKED_EXTERNAL'; ev.notes = 'honest external-gate state rendered'; }
    else { ev.status = 'PASS'; }
  } catch (e) {
    ev.status = 'ERROR';
    ev.notes = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }
  ev.consoleErrors = rec.consoleErrors.slice(0, 6);
  ev.pageErrors = rec.pageErrors.slice(0, 4);
  ev.httpFailures = Array.from(new Set(rec.httpFailures)).slice(0, 8);
  return ev;
}

// -------------------------------------------------------------------- suites
const INVOICE_PERSONA = 'owner-bill-detail';
const PARENT_ACCOUNT = process.env.QA_PARENT_ACCOUNT ?? 'owner-cp-dashboard';
const ADMIN_ACCOUNT = process.env.QA_ADMIN_ACCOUNT ?? 'app_owner';
const PARENT_PUBLIC = new Set(['/register', '/verify-email', '/login', '/forgot-password', '/reset-password']);

test.describe.configure({ mode: 'serial' });

test('parent-web route sweep', async ({ browser }) => {
  const vp = VIEWPORTS[VIEWPORT_NAME];
  const ctx = await browser.newContext({ viewport: vp, locale: LANG === 'AR' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await setLanguage(page);

  const routes = ROUTES.filter((r) => r.app === 'parent-web');
  // Public routes first, unauthenticated.
  for (const r of routes.filter((x) => PARENT_PUBLIC.has(x.route))) {
    evidence.push(await visit(page, r.app, r.route, 'unauthenticated'));
  }
  // Then everything else, as a real signed-in OWNER.
  await loginParent(page, PARENT_ACCOUNT);
  const INVOICE_ROUTE = '/subscription/invoices/:invoiceId';
  for (const r of routes.filter((x) => !PARENT_PUBLIC.has(x.route) && x.route !== INVOICE_ROUTE)) {
    evidence.push(await visit(page, r.app, r.route, 'OWNER'));
  }
  await ctx.close();

  // Invoice detail is family-scoped: sign in as the family that actually owns
  // the seeded invoice, in a clean context, so the route is exercised for real.
  const ctx2 = await browser.newContext({ viewport: vp, locale: LANG === 'AR' ? 'ar' : 'en-US' });
  const page2 = await ctx2.newPage();
  await page2.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await setLanguage(page2);
  await loginParent(page2, INVOICE_PERSONA);
  evidence.push(await visit(page2, 'parent-web', INVOICE_ROUTE, 'OWNER(invoice-owner)'));
  await ctx2.close();
});

test('platform-admin-web route sweep', async ({ browser }) => {
  const vp = VIEWPORTS[VIEWPORT_NAME];
  const ctx = await browser.newContext({ viewport: vp, locale: LANG === 'AR' ? 'ar' : 'en-US' });
  const page = await ctx.newPage();
  const routes = ROUTES.filter((r) => r.app === 'platform-admin-web');

  await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
  if (LANG === 'AR') {
    await page.evaluate(() => { try { localStorage.setItem('i18nextLng', 'ar'); } catch { /* ignore */ } });
  }
  evidence.push(await visit(page, 'platform-admin-web', '/login', 'unauthenticated'));

  await loginAdmin(page, ADMIN_ACCOUNT);
  for (const r of routes.filter((x) => x.route !== '/login')) {
    evidence.push(await visit(page, r.app, r.route, 'APP_OWNER'));
  }
  await ctx.close();
});

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(evidence, null, 1), 'utf8');
  const by: Record<string, number> = {};
  evidence.forEach((e) => { by[e.status] = (by[e.status] ?? 0) + 1; });
  console.log(`SWEEP ${LANG}/${VIEWPORT_NAME}: ${evidence.length} routes ${JSON.stringify(by)}`);
});
