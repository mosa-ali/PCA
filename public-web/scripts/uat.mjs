/**
 * PUBLIC-13 — full-site real-Chromium UAT harness.
 *
 * Run:  node build.mjs && node scripts/serve.mjs &   then   node scripts/uat.mjs
 *
 * WHY THIS EXISTS RATHER THAN A jsdom SUITE. PUBLIC-0 established that this
 * repository's only accessibility gate runs axe under jsdom, where axe-core's
 * color-contrast rule cannot produce a pass or fail at all, and that CI runs no
 * Playwright job whatsoever -- so every RTL and geometric assertion in the repo
 * is written but never executed. This harness runs in a real browser and checks
 * what only a real browser can see: computed layout overflow at 320px, measured
 * touch-target heights, live console errors, failed requests, and the rendered
 * text (not the source) for forbidden claims.
 *
 * It has already earned its place. On its first run it found four defects the
 * build gates could not: a CSP-blocked inline style, 16-18px of horizontal
 * overflow at 320px, sub-44px touch targets, and a permanent console error from
 * an inert meta frame-ancestors directive.
 *
 * DEPENDENCY NOTE: public-web itself stays zero-dependency -- 
> pca-public-web@0.1.0 build
> node build.mjs

PCA Public build OK
  origin              https://www.pcasafe.com
  content keys        EN 268 / AR 268 (exact parity)
  contrast pairs      30 checked, min 3.25:1, all pass
  pages emitted       32 (16 route(s) x 2 locales)
  routes pending      none
  AR native review    12 key(s) pending sign-off (OD-12 gate)
  claim-scan exempt   2 approved phrase(s):
                        access.expect.items[1] [en] vs CLM-041
                        access.expect.items[1] [ar] vs CLM-041
  new copy to review  8 key(s)
 * needs nothing installed. This optional dev harness borrows parent-web's
 * already-installed Playwright via createRequire rather than adding a package
 * dependency, a lockfile or a CI audit entry.
 */
import { createRequire } from 'node:module';
import { readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire('file:///D:/PCA/pca-app/parent-web/');
const { chromium } = require('playwright-core');

const DIST = 'D:/PCA/pca-app/public-web/dist';
const OUT = 'C:/Users/mdrwe/AppData/Local/Temp/claude/D--PCA-pca-app/af1adf8d-3fee-4bc0-8f65-fc2f413c5720/scratchpad/shots';
const BASE = 'http://127.0.0.1:4200';

async function findPages(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'assets') continue;
      out.push(...(await findPages(join(dir, e.name), `${prefix}/${e.name}`)));
    } else if (e.name === 'index.html') {
      out.push(`${prefix}/`);
    }
  }
  return out;
}

const urls = (await findPages(DIST)).sort();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

// Every page at one representative mobile width, plus the full matrix on home.
const WIDE = [320, 375, 390, 768, 1024, 1280, 1600];

for (const path of urls) {
  const isAr = path.startsWith('/ar/');
  const widths = path === '/' || path === '/ar/' ? WIDE : [375, 1280];
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const tab = await ctx.newPage();
    const consoleErrors = [];
    const failed = [];
    tab.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    tab.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    tab.on('requestfailed', (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText}`));
    tab.on('response', (r) => { if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url()}`); });

    await tab.goto(BASE + path, { waitUntil: 'networkidle' });

    const probe = await tab.evaluate(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - de.clientWidth;
      const offenders = [];
      if (overflow > 0) {
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.right > de.clientWidth + 1 || r.left < -1) {
            offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
            if (offenders.length >= 4) break;
          }
        }
      }
      const small = [];
      for (const el of document.querySelectorAll('a, button, summary')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 43.5) small.push(`${el.tagName.toLowerCase()}"${(el.textContent || '').trim().slice(0, 20)}" h=${r.height.toFixed(0)}`);
      }
      const headings = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]));
      const skips = [];
      for (let i = 1; i < headings.length; i += 1) {
        if (headings[i] - headings[i - 1] > 1) skips.push(`${headings[i - 1]}->${headings[i]}`);
      }
      return {
        lang: de.lang, dir: de.dir, overflow, offenders,
        small: small.slice(0, 4),
        h1Count: document.querySelectorAll('h1').length,
        title: document.title,
        titleLen: document.title.length,
        desc: document.querySelector('meta[name=description]')?.content ?? '',
        canonical: document.querySelector('link[rel=canonical]')?.href ?? '',
        robots: document.querySelector('meta[name=robots]')?.content ?? '',
        // data-claim no longer ships (owner ruling 2026-09-05 section 2), so
        // report the visible status instead: class + label text.
        pills: [...document.querySelectorAll('.pw-status')].map(
          (p) => `${(p.className.match(/pw-status--(\w+)/) || [, '?'])[1]}:${p.textContent.trim()}`
        ),
        internalMetadata: [...document.querySelectorAll('*')].filter((el) =>
          [...el.attributes].some((a) => /^data-(claim|review)/.test(a.name))
        ).length,
        internalLinks: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')),
        external: [...document.querySelectorAll('a[href^="http"]')].map((a) => a.getAttribute('href')).filter((h) => !h.startsWith('http://127.0.0.1')),
        forms: document.querySelectorAll('form').length,
        imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        // A 200 response and the right MIME type prove delivery, not rendering.
        // Both video posters and the favicon once shipped as malformed XML:
        // served fine, green build, broken-image icon on screen. naturalWidth
        // is the only signal that catches that, and it needs a real browser.
        brokenImages: [...document.querySelectorAll('img')]
          .filter((i) => i.complete && i.naturalWidth === 0)
          .map((i) => i.getAttribute('src')),
        bodyText: document.body.innerText,
      };
    });

    if (width === 1280 && !isAr) await tab.screenshot({ path: `${OUT}/full${path.replace(/\//g, '_')}.png`, fullPage: true });

    results.push({ path, width, ...probe, consoleErrors, failed });
    await ctx.close();
  }
}
await browser.close();

// Forbidden-claim scan over RENDERED TEXT (build scans HTML source).
const FORBIDDEN = [
  [/google\s*play|play\.google\.com/i, 'CLM-025 Google Play'],
  [/app\s*store|apps\.apple\.com/i, 'CLM-027 App Store'],
  [/available\s+now|download\s+for\s+android/i, 'CLM-024/026 availability'],
  [/unhackable|military[-\s]?grade|100%\s*(secure|private)|complete\s+anonymity/i, 'CLM-052 absolute'],
  [/zero\s+data|collects?\s+no\s+data/i, 'CLM-052 zero-data'],
  [/free\s+forever|always\s+free|permanent\s+free\s+plan|free\s+plan/i, 'CLM-041 free plan'],
  [/\$\s?\d|\d+\s?(USD|SAR|EUR|GBP)\b/i, 'CLM-042 price'],
  [/\bMFA\b|two[-\s]?factor|\b2FA\b/i, 'CLM-045 MFA'],
  [/\bWCAG\b|AA\s+compliant|fully\s+accessible|section\s+508/i, 'CLM-054 a11y conformance'],
  [/mode\s+b\b/i, 'CLM-039 Mode B'],
];

let fails = 0;
const seen = new Set();
console.log('\n=== PCA Public — full-site real Chromium UAT ===\n');
for (const r of results) {
  const p = [];
  const expectLang = r.path.startsWith('/ar/') ? 'ar' : 'en';
  const expectDir = expectLang === 'ar' ? 'rtl' : 'ltr';
  if (r.lang !== expectLang) p.push(`lang=${r.lang} want ${expectLang}`);
  if (r.dir !== expectDir) p.push(`dir=${r.dir} want ${expectDir}`);
  if (r.overflow > 0) p.push(`OVERFLOW ${r.overflow}px ${r.offenders.join(',')}`);
  if (r.consoleErrors.length) p.push(`console: ${r.consoleErrors.join(' | ')}`);
  if (r.failed.length) p.push(`requests: ${r.failed.join(' | ')}`);
  if (r.h1Count !== 1) p.push(`${r.h1Count} h1`);
  if (r.small.length) p.push(`small targets: ${r.small.join(', ')}`);
  if (r.external.length) p.push(`external links: ${r.external.join(',')}`);
  if (r.forms) p.push(`${r.forms} <form> (Release A submits none)`);
  if (r.imgNoAlt) p.push(`${r.imgNoAlt} img without alt`);
  if (r.brokenImages?.length) p.push(`BROKEN IMAGE (naturalWidth 0): ${r.brokenImages.join(', ')}`);
  if (r.internalMetadata) p.push(`${r.internalMetadata} element(s) expose internal claim metadata in production HTML`);
  if (!r.title) p.push('no <title>');
  if (!r.desc) p.push('no meta description');
  if (!r.canonical) p.push('no canonical');
  const scanText = r.bodyText;

  for (const [re, label] of FORBIDDEN) {
    const m = re.exec(scanText);
    if (m) p.push(`FORBIDDEN ${label}: "${m[0].trim()}"`);
  }
  if (p.length) fails += 1;
  const key = `${r.path}@${r.width}`;
  if (!seen.has(key)) seen.add(key);
  console.log(`${p.length ? 'FAIL' : ' ok '} ${r.path.padEnd(22)} ${String(r.width).padStart(4)}px  ${r.robots.padEnd(16)} pills=${r.pills.length}`);
  for (const x of p) console.log(`        - ${x}`);
}
console.log(`\n${results.length - fails}/${results.length} page checks clean`);

// SEO summary
console.log('\n=== SEO / claim summary (1280px pass) ===');
for (const r of results.filter((x) => x.width === 1280)) {
  console.log(`${r.path.padEnd(22)} title=${r.titleLen}ch robots=${r.robots.padEnd(16)} pills=[${r.pills.join(' ')}]`);
}
