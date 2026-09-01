import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const M = JSON.parse(readFileSync(process.env.QA_SEED_MANIFEST_PATH, 'utf8'));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:4012/login', { waitUntil: 'domcontentloaded' });
await p.getByLabel(/email/i).fill(M.parentAccounts['owner-cp-dashboard'].email);
await p.getByLabel(/password/i).fill(M.seedPassword);
await p.getByRole('button', { name: /sign in|log in/i }).click();
await p.waitForURL(/\/dashboard/, { timeout: 30000 });
await p.waitForTimeout(1500);
for (const r of ['/dashboard', '/children', '/requests', '/family/members']) {
  await p.goto('http://localhost:4012' + r, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const t = await p.locator('body').innerText();
  console.log('=========== ' + r + ' ===========');
  console.log(t.replace(/\n{2,}/g, '\n').slice(0, 700));
}
await b.close();
