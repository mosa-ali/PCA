/**
 * RELEASE-A CONTAINER VERIFIER
 *
 * Asserts that a RUNNING container serves the reviewed artifact with the real
 * response headers. Nothing here reads the source tree for its expectations
 * except src/lib/seo.mjs, which is the single definition of the required
 * headers -- so nginx.conf, the build's assertion and this verifier cannot
 * disagree without one of them failing.
 *
 * WHY THIS EXISTS. Release A's whole clickjacking, transport and MIME defence
 * lives in response headers that a <meta> tag physically cannot deliver. Up to
 * now that defence has been a documented intention. A configuration file is not
 * evidence either: nginx silently discards every inherited `add_header` in any
 * location block that declares one of its own, so a plausible-looking config can
 * serve a fully protected home page and a naked 404. The only way to know is to
 * ask a running server, on every path, including the error pages.
 *
 * Usage:
 *   docker build -f public-web/deploy/Dockerfile -t pca-public:local .
 *   docker run -d --rm -p 8080:80 --name pca-public-local pca-public:local
 *   node public-web/deploy/verify-container.mjs http://127.0.0.1:8080
 */

import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_RESPONSE_HEADERS } from '../src/lib/seo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8080').replace(/\/$/, '');

const results = [];
const problems = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) problems.push(`${name}${detail ? ' — ' + detail : ''}`);
};

const get = async (path, init = {}) => {
  const res = await fetch(BASE + path, { redirect: 'manual', ...init });
  return { res, body: await res.text() };
};

// ---------------------------------------------------------------------------
// What the artifact contains
// ---------------------------------------------------------------------------
async function walk(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

const files = await walk(DIST);
const pages = files.filter((f) => f.endsWith('/index.html')).map((f) => f.replace(/index\.html$/, ''));
const assets = files.filter((f) => !f.endsWith('.html'));

console.log(`verifying ${BASE}`);
console.log(`artifact: ${files.length} file(s), ${pages.length} page(s)\n`);

// ---------------------------------------------------------------------------
// 1. Health, and the difference between "container up" and "site correct"
// ---------------------------------------------------------------------------
{
  const { res, body } = await get('/healthz');
  check('health endpoint answers 200', res.status === 200, `got ${res.status}`);
  check('health endpoint is plain text', body.trim() === 'ok', `got "${body.trim().slice(0, 40)}"`);
}

// ---------------------------------------------------------------------------
// 2. Security headers on EVERY page, and on the error pages
// ---------------------------------------------------------------------------
const headerTargets = [...pages, '/does-not-exist-' + Date.now(), '/robots.txt', '/sitemap.xml', '/assets/pca-public.css'];

for (const target of headerTargets) {
  const { res } = await get(target);
  for (const [header, expected] of Object.entries(REQUIRED_RESPONSE_HEADERS)) {
    const actual = res.headers.get(header);
    check(
      `${header} on ${target}`,
      actual === expected,
      actual === null ? 'header absent' : `got "${actual}"`
    );
  }
}

// ---------------------------------------------------------------------------
// 3. The policy must not have been quietly widened
// ---------------------------------------------------------------------------
{
  const { res } = await get('/');
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  for (const banned of ["'unsafe-inline'", "'unsafe-eval'", 'http:', 'https:', '*']) {
    check(`CSP does not grant ${banned}`, !csp.includes(banned));
  }
  check('CSP carries frame-ancestors', csp.includes("frame-ancestors 'none'"));
  check('server version is not advertised', !/nginx\/\d/.test(res.headers.get('Server') ?? ''), res.headers.get('Server') ?? '');
}

// ---------------------------------------------------------------------------
// 4. Every page and asset is actually served
// ---------------------------------------------------------------------------
for (const page of pages) {
  const { res, body } = await get(page);
  check(`${page} serves 200`, res.status === 200, `got ${res.status}`);
  check(`${page} is HTML`, (res.headers.get('Content-Type') ?? '').startsWith('text/html'), res.headers.get('Content-Type') ?? '');

  const local = await readFile(join(DIST, page.replace(/\/$/, '') + '/index.html'), 'utf8');
  check(`${page} is byte-identical to the reviewed artifact`, body === local);

  const expectedLang = page.startsWith('/ar/') ? 'ar' : 'en';
  const expectedDir = page.startsWith('/ar/') ? 'rtl' : 'ltr';
  check(`${page} declares lang="${expectedLang}" in the served markup`, body.includes(`lang="${expectedLang}"`));
  check(`${page} declares dir="${expectedDir}" in the served markup`, body.includes(`dir="${expectedDir}"`));
}

for (const asset of assets) {
  const { res } = await get(asset);
  check(`${asset} serves 200`, res.status === 200, `got ${res.status}`);
}

// ---------------------------------------------------------------------------
// 5. Routing: real 404, no SPA fallback, relative redirects
// ---------------------------------------------------------------------------
{
  const { res, body } = await get('/definitely-not-a-page-' + Date.now());
  check('unknown path returns HTTP 404', res.status === 404, `got ${res.status}`);
  check('404 renders the real error page', body.includes('Page not found') || body.includes('404'));
  check('404 is not a soft-200 of the home page', !body.includes('<link rel="canonical" href="https://www.pcasafe.com/"'));
}
{
  // /privacy (no trailing slash) must redirect WITHOUT naming the container's
  // own hostname, or App Service's internal address leaks into the browser bar.
  const { res } = await get('/privacy');
  const location = res.headers.get('Location') ?? '';
  check('directory redirect is issued', res.status >= 300 && res.status < 400, `got ${res.status}`);
  check('directory redirect is relative, not absolute', !/^https?:\/\//i.test(location), location);
}
{
  const { res } = await get('/.env');
  check('dotfile paths are denied', res.status === 403 || res.status === 404, `got ${res.status}`);
}
{
  // /assets/ and /assets/video/ contain no index.html. If autoindex were ever
  // switched on, they would become a browsable listing of the whole artifact.
  for (const dir of ['/assets/', '/assets/video/']) {
    const { res, body } = await get(dir);
    check(`${dir} is not a browsable listing`, res.status === 404, `got ${res.status}`);
    check(`${dir} does not leak a file index`, !/Index of/i.test(body));
  }
}

// ---------------------------------------------------------------------------
// 6. Compression
// ---------------------------------------------------------------------------
{
  const res = await fetch(BASE + '/assets/pca-public.css', { headers: { 'Accept-Encoding': 'gzip' } });
  check('CSS is served gzipped', (res.headers.get('Content-Encoding') ?? '') === 'gzip', res.headers.get('Content-Encoding') ?? 'none');
  const html = await fetch(BASE + '/', { headers: { 'Accept-Encoding': 'gzip' } });
  check('HTML is served gzipped', (html.headers.get('Content-Encoding') ?? '') === 'gzip', html.headers.get('Content-Encoding') ?? 'none');
}

// ---------------------------------------------------------------------------
// 7. Nothing internal escaped into the deploy root
// ---------------------------------------------------------------------------
{
  // /50x.html and /index.html ship in the nginx base image's document root, and
  // COPY merges into that directory rather than replacing it. The first build
  // of this image served a stock /50x.html at 200 and every HTTP check passed,
  // because nothing requests a file it does not know exists.
  const baseImageLeftovers = ['/50x.html'];
  for (const leak of [
    ...baseImageLeftovers,
    '/build-report.json',
    '/release-a-evidence.json',
    '/MANIFEST.sha256',
    '/package.json',
    '/build.mjs',
  ]) {
    const { res } = await get(leak);
    check(`${leak} is not served`, res.status === 404 || res.status === 403, `got ${res.status}`);
  }
  const { body } = await get('/');
  for (const attr of ['data-claim', 'data-claim-status', 'data-review']) {
    check(`home carries no ${attr} attribute`, !body.includes(attr + '='));
  }
}

// ---------------------------------------------------------------------------
// 8. A real browser: does it render, and is the console clean under the
//    REAL header CSP rather than the weaker meta one?
// ---------------------------------------------------------------------------
let browserRan = false;
try {
  const require = createRequire(join(ROOT, '../parent-web/'));
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch();
  browserRan = true;

  for (const page of ['/', '/ar/', '/how-it-works/', '/privacy/', '/ar/privacy/']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await ctx.newPage();
    const consoleErrors = [];
    const external = [];
    tab.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    tab.on('request', (r) => {
      if (!r.url().startsWith(BASE)) external.push(r.url());
    });
    await tab.goto(BASE + page, { waitUntil: 'networkidle' });

    check(`${page}: no console errors under the response-header CSP`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
    check(`${page}: no external requests`, external.length === 0, external.slice(0, 2).join(' | '));

    // HTTP 200 with the right MIME type says nothing about rendering -- three
    // SVGs once shipped with an illegal `--` inside an XML comment, served
    // perfectly, and displayed as broken-image icons.
    const brokenImages = await tab.evaluate(() =>
      [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc)
    );
    check(`${page}: every image actually renders`, brokenImages.length === 0, brokenImages.join(' | '));

    const styled = await tab.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${page}: stylesheet applied (body has a painted background)`, styled !== 'rgba(0, 0, 0, 0)', styled);

    await ctx.close();
  }
  await browser.close();
} catch (err) {
  check('real-browser verification ran', false, `Playwright unavailable: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
console.log(`checks: ${passed}/${results.length} passed`);
if (browserRan) console.log('real browser: yes (Chromium)');

if (problems.length) {
  console.error(`\nLOCAL_RELEASE_A_CONTAINER = FAIL — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('');
  process.exitCode = 1;
} else {
  console.log('\nLOCAL_RELEASE_A_CONTAINER = PASS');
  console.log('PRODUCTION_SECURITY_HEADER_CONFIGURATION = PASS_LOCAL');
  console.log('\nThis is local evidence only. Nothing has been deployed.');
}
