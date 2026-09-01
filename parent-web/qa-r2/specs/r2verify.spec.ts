/**
 * Round-2 targeted re-verification (real Chromium -> real Vite -> real Fastify
 * -> real disposable MySQL, VITE_PCA_DEMO_MODE=false).
 *
 * Scope is deliberately narrow -- only the two routes whose source changed:
 *   A. /children/:childId/screen-time  (runtime-sync fail-closed fix)
 *   B. /privacy/permissions            (mobile overflow + enum presentation)
 *
 * The completed 62-route EN/AR/mobile sweeps are NOT re-run here; per the
 * programme's rule, changed routes get a targeted retest instead.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH!, 'utf8'));
const PARENT = 'http://localhost:4012';
const OUT = process.env.QA_VERIFY_OUT!;

type Rec = {
  check: string;
  lang: string;
  viewport: string;
  route: string;
  pass: boolean;
  detail: Record<string, unknown>;
};
const results: Rec[] = [];

function recorders(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpFailures: string[] = [];
  const syncCalls: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/sync')) syncCalls.push(`${r.method()} ${p}`);
  });
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400) return;
    const p = new URL(r.url()).pathname;
    const expectedProbe = s === 401 && p === '/api/parent/session';
    if (!expectedProbe) httpFailures.push(`${s} ${r.request().method()} ${p}`);
  });
  return { consoleErrors, pageErrors, httpFailures, syncCalls };
}

async function loginParent(page: Page, key: string) {
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(M.parentAccounts[key].email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}

async function setArabic(page: Page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem('pca.parent-web.language', 'ar');
      localStorage.setItem('i18nextLng', 'ar');
    } catch { /* ?lng= fallback still applies */ }
  });
}

/** True when the document is wider than its own viewport. */
async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
}

// ---------------------------------------------------------------- A: sync fix
test('A. screen-time makes no /api/sync/* request and raises no uncaught error', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginParent(page, 'owner-cp-dashboard');

  const rec = recorders(page);
  await page.goto(`${PARENT}/children/child-sweep-probe/screen-time`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const body = await page.locator('body').innerText();
  const detail = {
    syncCalls: rec.syncCalls,
    httpFailures: Array.from(new Set(rec.httpFailures)).slice(0, 10),
    pageErrors: rec.pageErrors,
    consoleErrors: rec.consoleErrors.slice(0, 4),
    renderedChars: body.trim().length,
    bodyTail: body.replace(/\s+/g, ' ').slice(-320),
  };

  // The regression this fix targets: zero requests to the nonexistent surface.
  const noSyncCalls = rec.syncCalls.length === 0;
  const noSync404 = !rec.httpFailures.some((f) => f.includes('/api/sync'));
  const noPageErrors = rec.pageErrors.length === 0;
  const rendered = body.trim().length > 40;

  results.push({
    check: 'screen-time: no /api/sync traffic, no uncaught error',
    lang: 'EN', viewport: 'desktop-1440x900',
    route: '/children/:childId/screen-time',
    pass: noSyncCalls && noSync404 && noPageErrors && rendered,
    detail,
  });

  expect(rec.syncCalls, 'no request may be issued to /api/sync/*').toEqual([]);
  expect(rec.httpFailures.filter((f) => f.includes('/api/sync'))).toEqual([]);
  expect(rec.pageErrors).toEqual([]);
  expect(body.trim().length).toBeGreaterThan(40);
  await ctx.close();
});

// -------------------------------------------------- B: permissions, EN + AR
for (const lang of ['EN', 'AR'] as const) {
  test(`B. /privacy/permissions has no horizontal overflow at 375x812 (${lang})`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      locale: lang === 'AR' ? 'ar' : 'en-US',
    });
    const page = await ctx.newPage();
    const rec = recorders(page);

    await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
    if (lang === 'AR') await setArabic(page);
    await loginParent(page, 'owner-cp-dashboard');

    const url = `${PARENT}/privacy/permissions${lang === 'AR' ? '?lng=ar' : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const overflow = await hasHorizontalOverflow(page);
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir') ?? '');

    // Per-element check: no individual identifier may exceed the viewport.
    const widest = await page.evaluate(() => {
      const codes = Array.from(document.querySelectorAll('code.permission-entry-id'));
      let max = 0;
      let text = '';
      for (const c of codes) {
        const w = (c as HTMLElement).getBoundingClientRect().width;
        if (w > max) { max = w; text = (c.textContent ?? '').trim(); }
      }
      return { count: codes.length, maxWidth: Math.round(max), text, viewport: window.innerWidth };
    });

    // Each identifier must be accompanied by a human-readable name.
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.permission-entry-term')).map((t) => ({
        name: (t.querySelector('.permission-entry-name')?.textContent ?? '').trim(),
        id: (t.querySelector('code')?.textContent ?? '').trim(),
        dir: t.querySelector('code')?.getAttribute('dir') ?? '',
      })),
    );

    const arabicRe = /[؀-ۿ]/;
    const everyIdHasName = names.length === 10 && names.every(
      (n) => n.name.length > 0 && !n.name.includes('android.permission.') && !/^[A-Z0-9_]+$/.test(n.name),
    );
    const everyIdLtr = names.every((n) => n.dir === 'ltr');
    const namesLocalized = lang === 'AR'
      ? names.every((n) => arabicRe.test(n.name))
      : names.every((n) => !arabicRe.test(n.name));
    const dirOk = lang === 'AR' ? dir === 'rtl' : dir === 'ltr';

    results.push({
      check: 'privacy/permissions: mobile overflow + enum presentation',
      lang, viewport: 'mobile-375x812', route: '/privacy/permissions',
      pass: !overflow && everyIdHasName && everyIdLtr && namesLocalized && dirOk
        && rec.pageErrors.length === 0,
      detail: {
        horizontalOverflow: overflow,
        dir,
        widestIdentifier: widest,
        entryCount: names.length,
        everyIdHasName, everyIdLtr, namesLocalized,
        pageErrors: rec.pageErrors,
        httpFailures: Array.from(new Set(rec.httpFailures)).slice(0, 6),
        sample: names.slice(0, 2),
      },
    });

    expect(overflow, `no horizontal overflow at 375x812 (${lang})`).toBe(false);
    expect(widest.maxWidth).toBeLessThanOrEqual(widest.viewport);
    expect(names.length).toBe(10);
    expect(everyIdHasName, 'every identifier is paired with a human-readable name').toBe(true);
    expect(everyIdLtr, 'identifiers are direction-isolated').toBe(true);
    expect(namesLocalized, `names are localized for ${lang}`).toBe(true);
    expect(dir).toBe(lang === 'AR' ? 'rtl' : 'ltr');
    expect(rec.pageErrors).toEqual([]);
    await ctx.close();
  });
}

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.lang}/${r.viewport}  ${r.route}  -- ${r.check}`);
  }
});
