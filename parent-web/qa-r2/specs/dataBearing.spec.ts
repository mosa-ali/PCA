/**
 * Data-bearing re-check for the affordances that only render when a list has
 * rows.
 *
 * The main P1/P2 evidence pass signed in as `owner-cp-dashboard`, which has no
 * invoices and no notifications, so /subscription/invoices and /notifications
 * legitimately rendered their empty states and their filter/pagination
 * controls never mounted. Judging those affordances "missing" from that run
 * would be wrong, so both routes are re-checked here as the seeded personas
 * that actually own the data.
 */
import { test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH!, 'utf8'));
const OUT = process.env.QA_DATA_OUT!;
const PARENT = 'http://localhost:4012';

const results: Record<string, unknown>[] = [];

async function loginParent(page: Page, key: string) {
  await page.goto(`${PARENT}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(M.parentAccounts[key].email);
  await page.locator('#login-password').fill(M.seedPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}

async function probe(page: Page) {
  return page.evaluate(() => {
    const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
      headers: Array.from(t.querySelectorAll('th')).map((h) => txt(h)),
      rowCount: t.querySelectorAll('tbody tr').length,
    }));
    return {
      tables,
      listItems: document.querySelectorAll('li').length,
      selects: Array.from(document.querySelectorAll('select')).map((s) => ({
        id: s.getAttribute('id') ?? '',
        options: Array.from(s.querySelectorAll('option')).map((o) => txt(o)),
      })),
      buttons: Array.from(document.querySelectorAll('button')).map((b) => txt(b)).filter(Boolean),
      hasPaginationAffordance: Array.from(document.querySelectorAll('button, a')).some((b) =>
        /next|previous|prev\b|show more|load more|page \d/i.test(b.textContent ?? '')),
      hasFilterAffordance: document.querySelectorAll('select').length > 1
        || Array.from(document.querySelectorAll('button')).some((b) => /all|unread|read\b/i.test(b.textContent ?? '')),
      bodyTail: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(-700),
    };
  });
}

test('data-bearing: invoices list as the family that owns invoices', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginParent(page, 'owner-bill-list');
  await page.goto(`${PARENT}/subscription/invoices`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const p = await probe(page);
  results.push({ route: '/subscription/invoices', persona: 'owner-bill-list', ...p });
  await ctx.close();
});

test('data-bearing: notifications as the seeded notifications persona', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginParent(page, 'owner-cp-notifications');
  await page.goto(`${PARENT}/notifications`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const p = await probe(page);
  results.push({ route: '/notifications', persona: 'owner-cp-notifications', ...p });
  await ctx.close();
});

test.afterAll(() => {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8');
  for (const r of results) {
    console.log(`${r.route} [${r.persona}] rows=${JSON.stringify((r.tables as unknown[]).map((t) => (t as { rowCount: number }).rowCount))} `
      + `pagination=${r.hasPaginationAffordance} filter=${r.hasFilterAffordance}`);
  }
});
