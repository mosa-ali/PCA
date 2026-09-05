/**
 * PUBLIC-12 + PUBLIC-13 — Release A evidence harness.
 *
 * One run produces every objective measurement the owner asked for, in a real
 * browser, and writes dist/release-a-evidence.json alongside a console summary.
 *
 * PUBLIC-13 route matrix : every built route x EN/AR x 8 mandated widths
 * PUBLIC-12 accessibility: axe (WCAG 2.1 A+AA), keyboard-only traversal, visible
 *                          focus, heading order, landmarks, form labels, lang,
 *                          RTL semantics, reduced motion, touch targets, reflow
 * PUBLIC-12 performance  : artifact size, per-page HTML, CSS, JS, images,
 *                          transfer estimate, LCP, CLS, blocking resources,
 *                          external requests
 * PUBLIC-12 SEO          : canonical, hreflang, x-default, title, description,
 *                          OpenGraph, robots, sitemap agreement, semantic
 *                          structure, no gated claim wording in metadata
 *
 * WHY A REAL BROWSER. PUBLIC-0 recorded that this repository's only existing
 * accessibility gate runs axe under jsdom, where the color-contrast rule cannot
 * return a result at all, and that CI runs no Playwright job, so every RTL and
 * geometric assertion in the repo is written but never executed. Everything
 * here is measured in Chromium, and the numbers are written down rather than
 * summarised as a verdict.
 *
 * DEPENDENCY NOTE: public-web stays zero-dependency. This optional harness
 * borrows parent-web's already-installed Playwright and axe-core rather than
 * adding a package dependency, a lockfile or a CI audit entry.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire('file:///D:/PCA/pca-app/parent-web/');
const { chromium } = require('playwright-core');
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE = process.env.PCA_UAT_BASE ?? 'http://127.0.0.1:4200';

/** Design Guideline section 21 + owner ruling section 5. */
const WIDTHS = [320, 375, 390, 480, 768, 1024, 1280, 1600];

// ---------------------------------------------------------------------------
// Discover the emitted pages
// ---------------------------------------------------------------------------
async function walk(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'assets') continue;
      out.push(...(await walk(join(dir, e.name), `${prefix}/${e.name}`)));
    } else if (e.name === 'index.html') out.push(`${prefix}/`);
  }
  return out;
}
const ROUTES = (await walk(DIST)).sort();

// ---------------------------------------------------------------------------
// Static artifact measurement
// ---------------------------------------------------------------------------
async function measureArtifact() {
  const files = [];
  async function scan(dir, prefix = '') {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await scan(p, `${prefix}/${e.name}`);
      else {
        const body = await readFile(p);
        files.push({
          path: `${prefix}/${e.name}`,
          ext: extname(e.name),
          bytes: body.length,
          gzip: gzipSync(body).length,
        });
      }
    }
  }
  await scan(DIST);
  const by = (ext) => files.filter((f) => f.ext === ext);
  const sum = (a, k) => a.reduce((n, f) => n + f[k], 0);
  return {
    fileCount: files.length,
    totalBytes: sum(files, 'bytes'),
    totalGzip: sum(files, 'gzip'),
    html: { count: by('.html').length, bytes: sum(by('.html'), 'bytes'), gzip: sum(by('.html'), 'gzip') },
    css: { count: by('.css').length, bytes: sum(by('.css'), 'bytes'), gzip: sum(by('.css'), 'gzip') },
    js: { count: by('.js').length, bytes: sum(by('.js'), 'bytes'), gzip: sum(by('.js'), 'gzip') },
    svg: { count: by('.svg').length, bytes: sum(by('.svg'), 'bytes'), gzip: sum(by('.svg'), 'gzip') },
    largest: files.sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((f) => `${f.path} ${f.bytes}B (${f.gzip}B gz)`),
    files,
  };
}

// ---------------------------------------------------------------------------
// Per-page browser probe
// ---------------------------------------------------------------------------
const LCP_CLS_INIT = `
  window.__pcaLcp = 0; window.__pcaCls = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__pcaLcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__pcaCls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
`;

async function probePage(browser, path, width, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  await page.addInitScript(LCP_CLS_INIT);

  const consoleErrors = [];
  const failed = [];
  const requests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', async (r) => {
    if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url()}`);
    requests.push({ url: r.url(), status: r.status(), type: r.request().resourceType() });
  });

  await page.goto(BASE + path, { waitUntil: 'networkidle' });

  const probe = await page.evaluate(() => {
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
    for (const el of document.querySelectorAll('a, button, summary, input, select, textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 43.5) small.push(`${el.tagName.toLowerCase()}"${(el.textContent || '').trim().slice(0, 18)}" h=${r.height.toFixed(0)}`);
    }
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
    const skips = [];
    for (let i = 1; i < headings.length; i += 1) {
      if (headings[i] - headings[i - 1] > 1) skips.push(`${headings[i - 1]}->${headings[i]}`);
    }
    const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content ?? '';
    const og = (p) => document.querySelector(`meta[property="${p}"]`)?.content ?? '';
    const labelled = [...document.querySelectorAll('input,select,textarea')].filter((el) => {
      if (el.type === 'hidden') return true;
      const id = el.getAttribute('id');
      return (
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      );
    }).length;
    return {
      lang: de.lang,
      dir: de.dir,
      overflow,
      offenders,
      smallTargets: small.slice(0, 6),
      h1Count: document.querySelectorAll('h1').length,
      headingSkips: skips,
      landmarks: {
        header: document.querySelectorAll('header').length,
        nav: document.querySelectorAll('nav').length,
        main: document.querySelectorAll('main').length,
        footer: document.querySelectorAll('footer').length,
      },
      formControls: document.querySelectorAll('input,select,textarea').length,
      labelledControls: labelled,
      forms: document.querySelectorAll('form').length,
      title: document.title,
      description: meta('description'),
      robots: meta('robots'),
      canonical: document.querySelector('link[rel=canonical]')?.href ?? '',
      hreflang: [...document.querySelectorAll('link[rel=alternate]')].map((l) => l.hreflang),
      og: { title: og('og:title'), description: og('og:description'), url: og('og:url'), locale: og('og:locale'), type: og('og:type') },
      brokenImages: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      imgNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
      internalMetadata: [...document.querySelectorAll('*')].filter((el) =>
        [...el.attributes].some((a) => /^data-(claim|review)/.test(a.name))
      ).length,
      inlineStyleAttrs: document.querySelectorAll('[style]').length,
      inlineScripts: [...document.querySelectorAll('script')].filter((s) => !s.src).length,
      // canonical, hreflang and og:url are ABSOLUTE by design and name the
      // canonical public origin -- they are not third-party references. Only
      // origins other than the canonical one count as external.
      externalRefs: (() => {
        const canonicalOrigin = (() => {
          try { return new URL(document.querySelector('link[rel=canonical]')?.href ?? '').origin; }
          catch { return null; }
        })();
        return [...document.querySelectorAll('[href],[src]')]
          .map((e) => e.getAttribute('href') || e.getAttribute('src'))
          .filter((u) => u && /^https?:\/\//i.test(u))
          .filter((u) => !u.startsWith('http://127.0.0.1'))
          .filter((u) => !canonicalOrigin || !u.startsWith(canonicalOrigin));
      })(),
      mixedContent: [...document.querySelectorAll('[href],[src]')]
        .map((e) => e.getAttribute('href') || e.getAttribute('src'))
        .filter((u) => u && /^http:\/\//i.test(u) && !u.startsWith('http://127.0.0.1')),
      videoPlaceholders: document.querySelectorAll('.pw-video__placeholder').length,
      videoElements: document.querySelectorAll('video').length,
      transcripts: document.querySelectorAll('.pw-video__transcript').length,
      detailsCount: document.querySelectorAll('details').length,
      statusPills: [...document.querySelectorAll('.pw-status')].map((p) => p.textContent.trim()),
      internalLinks: [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')),
      bodyText: document.body.innerText,
    };
  });

  const vitals = await page.evaluate(() => ({ lcp: window.__pcaLcp ?? 0, cls: window.__pcaCls ?? 0 }));

  let axeResult = null;
  if (opts.axe) {
    await page.evaluate(axeSource);
    axeResult = await page.evaluate(async () =>
      // eslint-disable-next-line no-undef
      await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    );
    axeResult = {
      violations: axeResult.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      passes: axeResult.passes.length,
      incomplete: axeResult.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
    };
  }

  let keyboard = null;
  if (opts.keyboard) {
    const order = [];
    let trapped = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28),
          outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
          boxShadow: cs.boxShadow !== 'none',
          visible: r.width > 0 && r.height > 0,
        };
      });
      if (!info) break;
      order.push(info);
    }
    const noFocusRing = order.filter((o) => o.visible && !o.outline && !o.boxShadow);
    keyboard = {
      reachable: order.length,
      firstStop: order[0]?.text ?? null,
      withoutVisibleFocus: noFocusRing.map((o) => `${o.tag}"${o.text}"`),
      trapped,
    };
  }

  await ctx.close();
  return { path, width, ...probe, vitals, axe: axeResult, keyboard, consoleErrors, failed, requests };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const artifact = await measureArtifact();
const browser = await chromium.launch();
const results = [];

// PUBLIC-13: full matrix.
for (const path of ROUTES) {
  for (const width of WIDTHS) {
    const deep = width === 1280;
    results.push(await probePage(browser, path, width, { axe: deep, keyboard: deep }));
  }
}

// Reduced-motion pass and a reflow pass (320px ~ 400% zoom of a 1280 layout).
const reducedMotion = await probePage(browser, '/', 1280, { reducedMotion: true });
const reflow = await probePage(browser, '/', 320, {});

// 404 behaviour.
const notFound = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}/this-route-does-not-exist/`, { waitUntil: 'networkidle' });
  const out = await page.evaluate(() => ({
    status: document.title,
    hasHomeLink: !!document.querySelector('a[href="/"]'),
    hasArabicLink: !!document.querySelector('a[href="/ar/"]'),
    robots: document.querySelector('meta[name=robots]')?.content ?? '',
    text: document.body.innerText.slice(0, 160),
  }));
  await ctx.close();
  return { httpStatus: res?.status(), ...out };
})();

await browser.close();

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------
const GATED_IN_METADATA = /\bWCAG\b|AA compliant|free plan|free forever|Google Play|App Store|available now|\bMFA\b|Mode B|100% (secure|private)|unhackable/i;

const problems = [];
function flag(where, msg) { problems.push(`${where}: ${msg}`); }

for (const r of results) {
  const w = `${r.path}@${r.width}`;
  const expectLang = r.path.startsWith('/ar/') ? 'ar' : 'en';
  const expectDir = expectLang === 'ar' ? 'rtl' : 'ltr';
  if (r.lang !== expectLang) flag(w, `lang=${r.lang} want ${expectLang}`);
  if (r.dir !== expectDir) flag(w, `dir=${r.dir} want ${expectDir}`);
  if (r.overflow > 0) flag(w, `horizontal overflow ${r.overflow}px (${r.offenders.join(',')})`);
  if (r.consoleErrors.length) flag(w, `console errors: ${r.consoleErrors.join(' | ')}`);
  if (r.failed.length) flag(w, `failed requests: ${r.failed.join(' | ')}`);
  if (r.h1Count !== 1) flag(w, `${r.h1Count} h1 elements`);
  if (r.headingSkips.length) flag(w, `heading skips: ${r.headingSkips.join(', ')}`);
  if (r.smallTargets.length) flag(w, `touch targets <44px: ${r.smallTargets.join(', ')}`);
  if (r.brokenImages.length) flag(w, `broken images: ${r.brokenImages.join(', ')}`);
  if (r.imgNoAlt) flag(w, `${r.imgNoAlt} img without alt`);
  if (r.internalMetadata) flag(w, `${r.internalMetadata} elements expose internal claim metadata`);
  if (r.inlineStyleAttrs) flag(w, `${r.inlineStyleAttrs} inline style attributes (CSP style-src 'self' would block)`);
  if (r.inlineScripts) flag(w, `${r.inlineScripts} inline scripts (CSP script-src 'self' would block)`);
  if (r.externalRefs.length) flag(w, `external refs: ${r.externalRefs.join(', ')}`);
  if (r.mixedContent.length) flag(w, `mixed content: ${r.mixedContent.join(', ')}`);
  if (r.forms) flag(w, `${r.forms} form elements (Release A submits none)`);
  if (r.formControls !== r.labelledControls) flag(w, `${r.formControls - r.labelledControls} unlabelled form controls`);
  if (r.landmarks.main !== 1) flag(w, `${r.landmarks.main} <main> landmarks`);
  if (!r.title) flag(w, 'no title');
  if (!r.description) flag(w, 'no meta description');
  if (!r.canonical) flag(w, 'no canonical');
  if (!r.hreflang.includes('en') || !r.hreflang.includes('ar') || !r.hreflang.includes('x-default')) {
    flag(w, `hreflang incomplete: ${r.hreflang.join(',')}`);
  }
  if (!r.og.title || !r.og.url) flag(w, 'incomplete OpenGraph');
  if (GATED_IN_METADATA.test(`${r.title} ${r.description} ${r.og.title} ${r.og.description}`)) {
    flag(w, 'gated/forbidden claim wording in metadata');
  }
  if (r.videoElements > 0) flag(w, `${r.videoElements} <video> elements while both videos are placeholders`);
  if (r.axe?.violations.length) flag(w, `axe: ${r.axe.violations.map((v) => `${v.id}(${v.impact})x${v.nodes}`).join(', ')}`);
  if (r.keyboard?.withoutVisibleFocus.length) flag(w, `no visible focus: ${r.keyboard.withoutVisibleFocus.join(', ')}`);
}

// Sitemap / robots agreement.
const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
const robots = await readFile(join(DIST, 'robots.txt'), 'utf8');
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
for (const r of results.filter((x) => x.width === 1280)) {
  const indexable = !/noindex/.test(r.robots);
  const inSitemap = sitemapLocs.includes(r.path);
  if (indexable && !inSitemap) flag(r.path, 'indexable but missing from sitemap.xml');
  if (!indexable && inSitemap) flag(r.path, 'noindex but present in sitemap.xml');
  if (!indexable && !new RegExp(`Disallow: ${r.path}`).test(robots)) flag(r.path, 'noindex but not disallowed in robots.txt');
}

const deep = results.filter((r) => r.width === 1280);
const axeViolations = deep.reduce((n, r) => n + (r.axe?.violations.length ?? 0), 0);
const axeIncomplete = [...new Set(deep.flatMap((r) => (r.axe?.incomplete ?? []).map((i) => i.id)))];
const home = deep.find((r) => r.path === '/');
const homeGz = artifact.files.find((f) => f.path === '/index.html')?.gzip ?? 0;
const cssGz = artifact.css.gzip;
const jsGz = artifact.js.gzip;

const report = {
  generated: 'scripts/release-a-evidence.mjs',
  base: BASE,
  routeMatrix: { routes: ROUTES.length, widths: WIDTHS, checks: results.length },
  passed: results.length - new Set(problems.map((p) => p.split(':')[0])).size,
  problems,
  accessibility: {
    axeViolations,
    axeRunsPerformed: deep.length,
    axeIncompleteRules: axeIncomplete,
    keyboardReachablePerPage: Object.fromEntries(deep.map((r) => [r.path, r.keyboard?.reachable ?? 0])),
    controlsWithoutVisibleFocus: deep.flatMap((r) => r.keyboard?.withoutVisibleFocus ?? []),
    reducedMotionClean: reducedMotion.consoleErrors.length === 0 && reducedMotion.overflow === 0,
    reflowAt320Clean: reflow.overflow === 0,
    landmarksPerPage: Object.fromEntries(deep.map((r) => [r.path, r.landmarks])),
  },
  performance: {
    artifactFiles: artifact.fileCount,
    artifactBytes: artifact.totalBytes,
    artifactGzip: artifact.totalGzip,
    htmlTotal: artifact.html,
    css: artifact.css,
    js: artifact.js,
    svg: artifact.svg,
    firstLoadGzipEstimate: homeGz + cssGz + jsGz,
    perPageHtml: Object.fromEntries(
      artifact.files.filter((f) => f.ext === '.html').map((f) => [f.path, { bytes: f.bytes, gzip: f.gzip }])
    ),
    lcpMs: Object.fromEntries(deep.map((r) => [r.path, Math.round(r.vitals.lcp)])),
    cls: Object.fromEntries(deep.map((r) => [r.path, Number(r.vitals.cls.toFixed(4))])),
    blockingResources: home ? home.requests.filter((q) => q.type === 'stylesheet').length : null,
    externalRequests: deep.reduce((n, r) => n + r.externalRefs.length, 0),
    requestsOnHome: home ? home.requests.length : null,
    largestFiles: artifact.largest,
  },
  seo: {
    sitemapEntries: sitemapLocs.length,
    robots,
    perPage: Object.fromEntries(
      deep.map((r) => [r.path, { title: r.title, titleLen: r.title.length, descLen: r.description.length, robots: r.robots, canonical: r.canonical, hreflang: r.hreflang, og: r.og }])
    ),
  },
  notFound,
  videos: {
    placeholdersRendered: deep.reduce((n, r) => n + r.videoPlaceholders, 0),
    videoElements: deep.reduce((n, r) => n + r.videoElements, 0),
    transcriptsRendered: deep.reduce((n, r) => n + r.transcripts, 0),
  },
};

// Reports live OUTSIDE the deploy root: dist/ is what gets published, and
// this file carries internal test telemetry and a loopback base URL.
const REPORTS = join(ROOT, 'reports');
await (await import('node:fs/promises')).mkdir(REPORTS, { recursive: true });
await writeFile(join(REPORTS, 'release-a-evidence.json'), JSON.stringify(report, null, 2), 'utf8');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== PUBLIC-13 route matrix ===');
console.log(`  ${ROUTES.length} routes x ${WIDTHS.length} widths = ${results.length} checks`);
console.log(`  problems: ${problems.length}`);
for (const p of problems.slice(0, 40)) console.log(`    - ${p}`);

console.log('\n=== PUBLIC-12 accessibility ===');
console.log(`  axe violations (WCAG 2.1 A+AA): ${axeViolations} across ${deep.length} page runs`);
console.log(`  axe incomplete rules: ${axeIncomplete.length ? axeIncomplete.join(', ') : 'none'}`);
console.log(`  controls without a visible focus indicator: ${report.accessibility.controlsWithoutVisibleFocus.length}`);
console.log(`  keyboard-reachable controls on /: ${report.accessibility.keyboardReachablePerPage['/']}`);
console.log(`  reduced-motion pass clean: ${report.accessibility.reducedMotionClean}`);
console.log(`  reflow at 320px clean: ${report.accessibility.reflowAt320Clean}`);

console.log('\n=== PUBLIC-12 performance ===');
console.log(`  artifact: ${artifact.fileCount} files, ${artifact.totalBytes} B (${artifact.totalGzip} B gz)`);
console.log(`  first load (home html + css + js, gz): ${report.performance.firstLoadGzipEstimate} B`);
console.log(`  css ${artifact.css.bytes} B (${artifact.css.gzip} gz) | js ${artifact.js.bytes} B (${artifact.js.gzip} gz) | svg ${artifact.svg.bytes} B`);
console.log(`  requests on /: ${report.performance.requestsOnHome} | blocking stylesheets: ${report.performance.blockingResources} | external: ${report.performance.externalRequests}`);
console.log(`  LCP /: ${report.performance.lcpMs['/']} ms | CLS /: ${report.performance.cls['/']}`);

console.log('\n=== PUBLIC-12 SEO ===');
console.log(`  sitemap entries: ${sitemapLocs.length}`);
for (const [p, v] of Object.entries(report.seo.perPage)) {
  console.log(`  ${p.padEnd(20)} title=${String(v.titleLen).padStart(3)}ch desc=${String(v.descLen).padStart(3)}ch ${v.robots.padEnd(17)} hreflang=[${v.hreflang.join(',')}]`);
}

console.log('\n=== 404 ===');
console.log(`  HTTP ${notFound.httpStatus} | title="${notFound.status}" | robots=${notFound.robots} | home link=${notFound.hasHomeLink} | arabic link=${notFound.hasArabicLink}`);

console.log(`\nevidence written: dist/release-a-evidence.json`);
console.log(problems.length === 0 ? '\nALL CHECKS CLEAN' : `\n${problems.length} PROBLEM(S)`);
