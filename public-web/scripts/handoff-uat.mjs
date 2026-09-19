/**
 * Browser integration proof for the Public -> approved application handoffs.
 * This clicks both chooser options in EN and AR and verifies the existing
 * Parent Web / Platform Admin login forms load instead of a Public 404.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('file:///D:/PCA/pca-app/parent-web/');
const { chromium } = require('playwright-core');

const publicBase = process.env.PUBLIC_WEB_UAT_BASE ?? 'http://127.0.0.1:4200';
const parentOrigin = process.env.PUBLIC_PARENT_WEB_ORIGIN ?? 'http://127.0.0.1:4000';
const platformAdminOrigin = process.env.PUBLIC_PLATFORM_ADMIN_ORIGIN ?? 'http://127.0.0.1:4100';
const targets = [
  { name: 'Parent', href: '/parent/login/', origin: parentOrigin },
  { name: 'Platform Admin', href: '/platform-admin/login/', origin: platformAdminOrigin },
];

const browser = await chromium.launch();
const failures = [];

try {
  for (const localePath of ['/sign-in/', '/ar/sign-in/']) {
    for (const target of targets) {
      const page = await browser.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
      page.on('requestfailed', (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`));
      try {
        await page.goto(`${publicBase}${localePath}`, { waitUntil: 'networkidle' });
        const link = page.locator(`a[href*="${target.href}"]`).first();
        assert.equal(await link.count(), 1, `${localePath} must expose one ${target.name} chooser link`);
        await link.click();
        await page.waitForLoadState('networkidle');
        const finalUrl = new URL(page.url());
        assert.equal(finalUrl.origin, target.origin, `${localePath} ${target.name} origin`);
        assert.equal(finalUrl.pathname, '/login/', `${localePath} ${target.name} path`);
        assert.equal(await page.locator('form').count(), 1, `${target.name} approved login form must load`);
        assert.ok(await page.locator('input').count() >= 2, `${target.name} approved login inputs must load`);
        if (consoleErrors.length || failedRequests.length) {
          console.log(`NOTE ${localePath} -> ${target.name} backend/runtime noise: console=${consoleErrors.length} failedRequests=${failedRequests.length}`);
        }
        console.log(`PASS ${localePath} -> ${target.name} ${page.url()}`);
      } catch (error) {
        failures.push(`${localePath} -> ${target.name}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('PUBLIC_AUTH_HANDOFF_BROWSER = 4/4 PASS');
}
