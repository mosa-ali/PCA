// PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A035): a REAL-BROWSER colour-contrast
// gate for the parent console.
//
// Why this exists: tests/accessibility/axe.test.tsx runs axe-core under jsdom,
// where the `color-contrast` rule can only ever report "incomplete" (jsdom does
// no layout or colour compositing), and the matcher reads results.violations
// only -- so every WCAG ratio in src/styles/global.css was a hand-written
// comment with nothing enforcing it. Chromium via Playwright computes real
// contrast.
//
// Every route is audited twice: English/LTR and Arabic/RTL. English uses
// axe-core's color-contrast rule; Arabic additionally uses the
// script-independent audit in ./lib/contrastAudit.ts, because axe-core 4.10
// skips Arabic-only text nodes (see that file's header) and a run that
// evaluates nothing must never read as green.
//
// Demo mode (VITE_PCA_DEMO_MODE=true, the committed .env) renders every page
// with fixture data, so the surfaces exercised here are the real components
// with real copy, not empty shells.
import { test, expect, type Page } from '@playwright/test';
import { runAxeContrast, runArabicTextContrast } from './lib/contrastAudit';

// The app ships a strict script-src 'self' CSP (a real control this audit must not weaken
// in the product). Injecting axe-core into the page is the audit harness, not the app,
// so CSP enforcement is bypassed for this test context only; e2e/rbac.spec.ts and the
// securityHeaders tests continue to assert the CSP itself.
test.use({ bypassCSP: true });

const ROUTES = [
  '/dashboard',
  '/family/devices',
  '/children/child-amir/screen-time',
  '/subscription?demoRole=OWNER',
  '/download',
  '/settings',
  '/privacy/retention',
] as const;

async function switchToArabic(page: Page) {
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  // The language switch re-renders every translated subtree (lazy routes may
  // suspend briefly): audit only once real Arabic text is on screen.
  await page.waitForFunction(() => /[؀-ۿ]/.test(document.body.innerText) && document.body.innerText.trim().length > 200);
}

for (const route of ROUTES) {
  test(`real-browser WCAG AA colour contrast holds on ${route} (English, LTR)`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const axe = await runAxeContrast(page);
    expect(axe.passesCount, `axe evaluated no text nodes on ${route}; the audit is vacuous`).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'axe-incomplete-nodes', description: String(axe.incompleteCount) });
    expect(axe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });

  test(`real-browser WCAG AA colour contrast holds on ${route} (Arabic, RTL)`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await switchToArabic(page);
    const axe = await runAxeContrast(page);
    const arabic = await runArabicTextContrast(page);
    test.info().annotations.push({ type: 'axe-passes/incomplete', description: `${axe.passesCount}/${axe.incompleteCount}` });
    test.info().annotations.push({ type: 'arabic-text-nodes evaluated/skipped', description: `${arabic.evaluated}/${arabic.skipped}` });
    // axe alone is NOT required to have evaluated anything here (it skips
    // Arabic-only text); the script-independent audit must have.
    expect(arabic.evaluated, `no Arabic text node could be evaluated on ${route}; the audit is vacuous`).toBeGreaterThan(0);
    expect(axe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
    expect(arabic.failures).toEqual([]);
  });
}
