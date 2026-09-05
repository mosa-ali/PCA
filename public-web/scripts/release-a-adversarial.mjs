/**
 * RELEASE A — FINAL ADVERSARIAL PASS
 *
 * Attacks the exact candidate tree. Deliberately aimed at what the build gates
 * and the container verifier do NOT already cover, because re-running a passing
 * gate and calling it an adversarial review is how a review produces zero
 * findings without looking at anything.
 *
 * Each check states what would be true if the site were lying, then tests for
 * it. Run against dist/ and, when a base URL is given, a running container.
 *
 * Usage:
 *   node scripts/release-a-adversarial.mjs [http://127.0.0.1:8099]
 */

import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv } from './lib/csv.mjs';
import { CONTENT } from '../src/content/index.mjs';
import { VIDEOS } from '../src/content/videos.mjs';
import { CLAIMS } from '../src/content/claims.mjs';
import { ROUTES } from '../src/content/routes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const DIST = join(ROOT, 'dist');
const BASE = process.argv[2] ?? null;

const findings = [];
const checked = [];
const notes = [];
const finding = (severity, area, what) => findings.push({ severity, area, what });
const ok = (area, what) => checked.push(`${area}: ${what}`);

async function walk(dir, prefix = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push({ rel, abs: join(dir, e.name) });
  }
  return out;
}

const files = await walk(DIST);
const textual = ['.html', '.css', '.js', '.svg', '.txt', '.xml', '.json'];
const corpus = new Map();
for (const f of files) {
  if (textual.includes(extname(f.rel))) corpus.set(f.rel, await readFile(f.abs, 'utf8'));
}
const allText = [...corpus.values()].join('\n');
const htmlFiles = [...corpus].filter(([rel]) => rel.endsWith('.html'));

// ---------------------------------------------------------------------------
// 1. Contact addresses must NOT be activated yet
// ---------------------------------------------------------------------------
{
  const hits = [];
  for (const [rel, body] of corpus) {
    for (const m of body.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) hits.push(`${rel}: ${m[0]}`);
    if (/mailto:/i.test(body)) hits.push(`${rel}: mailto: link`);
  }
  if (hits.length) {
    finding(
      'CRITICAL',
      'contact',
      `an email address or mailto: ships in the artifact while PUBLIC_REPLY_IDENTITY = NOT_READY: ${hits.slice(0, 4).join(' | ')}`
    );
  } else {
    ok('contact', 'no email address and no mailto: anywhere in the artifact');
  }

  const claimsToWork = /can now (?:email|contact|reach)|write to us|email us|راسلنا|يمكنك مراسلتنا/i;
  if (claimsToWork.test(allText)) {
    finding('CRITICAL', 'contact', 'the artifact invites the reader to send a message, which PCA cannot yet receive.');
  } else {
    ok('contact', 'no page invites a message PCA cannot receive');
  }
}

// ---------------------------------------------------------------------------
// 1b. Release A converts on DOWNLOAD, never on login
//
// Owner ruling: there is no public login in Release A, and the conversion action
// is downloading the app. Two things have to hold at once, and they pull in
// opposite directions -- the download area must be VISIBLE, and it must not
// imply a download that does not exist. CLM-024's register entry states the
// second half in terms: "NO store badge, NO download action".
//
// Auth vocabulary is judged on RENDERED CONTROLS, not on prose. /how-it-works/
// legitimately describes account creation as a future step, on a page that opens
// by saying accounts are not open yet. Banning the words outright would force
// the site to become vaguer about what it cannot do yet, which is the opposite
// of the point.
// ---------------------------------------------------------------------------
{
  const AUTH_WORDS = /\b(log ?in|sign ?in|sign ?up|create account|get started)\b|تسجيل الدخول|إنشاء حساب/i;
  const controls = [];
  for (const [rel, body] of htmlFiles) {
    for (const m of body.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)) {
      const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (AUTH_WORDS.test(text)) controls.push(`${rel}: <${m[1]}> "${text}"`);
    }
  }
  if (controls.length) {
    finding('CRITICAL', 'no-public-login', `an auth control is rendered: ${controls.slice(0, 4).join(' | ')}`);
  } else {
    ok('no-public-login', 'no login, sign-in, sign-up or create-account control is rendered anywhere');
  }

  for (const routeId of ['login', 'signup', 'forgotPassword', 'resetPassword', 'verifyEmail']) {
    const route = ROUTES.find((r) => r.id === routeId);
    if (route?.build) finding('CRITICAL', 'no-public-login', `auth route ${routeId} is built into the artifact.`);
    if (route && corpus.has(`/${route.path}/index.html`)) {
      finding('CRITICAL', 'no-public-login', `auth route /${route.path}/ was emitted.`);
    }
  }

  // The download action must exist and must land on the download section.
  const downloadCtas = [];
  for (const [rel, body] of htmlFiles) {
    for (const m of body.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (/download|get the app|تنزيل|الحصول على التطبيق/i.test(text)) downloadCtas.push({ rel, href: m[1], text });
    }
  }
  if (!downloadCtas.length) {
    finding('CRITICAL', 'download-action', 'no download / get-the-app action is rendered anywhere.');
  } else if (!downloadCtas.some((c) => c.href.includes('#download'))) {
    finding('HIGH', 'download-action', 'a download action exists but none targets the #download section.');
  } else {
    ok('download-action', `${downloadCtas.length} download action(s) rendered, targeting the #download section`);
  }

  const hasSection = [...corpus].some(([rel, b]) => rel.endsWith('.html') && b.includes('id="download"'));
  if (!hasSection) finding('CRITICAL', 'download-action', 'nothing renders a section with id="download".');

  // Honesty: no store badge, no store URL, no install file, no fake link.
  const FAKE = [
    { re: /play\.google\.com|apps\.apple\.com|itunes\.apple\.com|appgallery|microsoft\.com\/store/i, what: 'an app-store URL' },
    { re: /\.apk\b|\.ipa\b|\.aab\b/i, what: 'an installable file reference' },
    { re: /(get it on google play|download on the app store|available on the app store)/i, what: 'store badge wording' },
    { re: /<img[^>]+(badge|play-?store|app-?store)[^>]*>/i, what: 'a store badge image' },
  ];
  const fakes = [];
  for (const [rel, body] of corpus) {
    for (const f of FAKE) if (f.re.test(body)) fakes.push(`${rel}: ${f.what}`);
  }
  if (fakes.length) {
    finding('CRITICAL', 'download-honesty', `the artifact implies a download that does not exist: ${fakes.slice(0, 4).join(' | ')}`);
  } else {
    ok('download-honesty', 'no store badge, no store URL, no .apk/.ipa/.aab, no fake download link');
  }

  // The download section must say, in both locales, that nothing ships yet.
  for (const path of ['/how-it-works/index.html', '/ar/how-it-works/index.html']) {
    const body = corpus.get(path) ?? '';
    const saysNotYet = /nothing to download yet|has not been released|لا يوجد شيء للتنزيل|لم يُطلَق/.test(body);
    if (!saysNotYet) {
      finding('CRITICAL', 'download-honesty', `${path} carries a download section without stating that nothing is downloadable yet.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Legal drafts must not be indexable, and must not be in the sitemap
// ---------------------------------------------------------------------------
{
  const sitemap = corpus.get('/sitemap.xml') ?? '';
  const robots = corpus.get('/robots.txt') ?? '';
  for (const routeId of ['privacyPolicy', 'terms']) {
    const route = ROUTES.find((r) => r.id === routeId);
    for (const locale of ['en', 'ar']) {
      const path = locale === 'en' ? `/${route.path}/` : `/ar/${route.path}/`;
      const html = corpus.get(`${path}index.html`);
      if (!html) {
        finding('HIGH', 'legal-drafts', `${path} was not emitted, so its indexability cannot be verified.`);
        continue;
      }
      if (!/name="robots"\s+content="noindex, nofollow"/.test(html)) {
        finding('CRITICAL', 'legal-drafts', `${path} is a provisional legal draft but does not declare noindex.`);
      }
      if (sitemap.includes(`${path}<`) || sitemap.includes(`${path}</loc>`) || sitemap.includes(path + '</loc>')) {
        finding('CRITICAL', 'legal-drafts', `${path} appears in sitemap.xml while OD-13 is unresolved.`);
      }
    }
  }
  if (!findings.some((f) => f.area === 'legal-drafts')) {
    ok('legal-drafts', 'privacy-policy and terms are noindex in both locales and absent from the sitemap');
  }
  if (/Disallow:\s*$/m.test(robots) === false && !/Allow:|Disallow:/.test(robots)) {
    finding('HIGH', 'robots', 'robots.txt declares neither Allow nor Disallow.');
  }
}

// ---------------------------------------------------------------------------
// 3. Availability honesty — iOS, AI, YouTube, and the child app
// ---------------------------------------------------------------------------
{
  const overclaims = [
    { re: /(iPhone|iPad|iOS)[^.<]{0,60}\b(available now|is available|works today|متاحة الآن|متوفرة الآن)/i, what: 'iOS presented as available' },
    { re: /\b(AI|الذكاء الاصطناعي)[^.<]{0,60}\b(available now|is available|works today|متاحة الآن)/i, what: 'AI features presented as available' },
    { re: /YouTube[^.<]{0,60}\b(available now|is available|fully protected|محمي بالكامل|متاحة الآن)/i, what: 'YouTube protection presented as available' },
    { re: /\bdownload (the )?(PCA )?(Child|Parent) (app )?(now|today)\b/i, what: 'an app download invited while neither app ships' },
  ];
  for (const o of overclaims) {
    if (o.re.test(allText)) finding('CRITICAL', 'availability', o.what);
  }
  // The converse: the planned-later features must actually SAY so somewhere.
  for (const [label, re] of [
    ['iOS', /(iPhone|iPad)[^.<]{0,80}(later release|إصدار لاحق)/i],
    ['AI', /(AI-supported|الذكاء الاصطناعي)[^.<]{0,80}(later release|إصدار لاحق)/i],
    ['YouTube', /YouTube[^.<]{0,80}(later release|إصدار لاحق)/i],
  ]) {
    if (!re.test(allText)) finding('HIGH', 'availability', `${label} is mentioned but never stated as coming in a later release.`);
  }
  if (!findings.some((f) => f.area === 'availability')) {
    ok('availability', 'iOS, AI and YouTube are each stated as later; no app download is invited');
  }
}

// ---------------------------------------------------------------------------
// 4. Video placeholder honesty
// ---------------------------------------------------------------------------
{
  for (const v of Object.values(VIDEOS)) {
    if (v.available) finding('CRITICAL', 'video', `${v.id} is marked available, but no footage has been produced.`);
  }
  // NOT /youtu.?be/ -- that matches the word "YouTube", which appears legitimately
  // in the FAQ as a feature planned for later. Match the domain, not the brand.
  if (/<video\b|<iframe\b|\.mp4\b|\.webm\b|youtube\.com|youtu\.be/i.test(allText)) {
    finding('CRITICAL', 'video', 'the artifact references playable video, which does not exist.');
  }
  const watchInvites = /\bwatch the (video|film)\b|\bplay video\b|شاهد الفيديو|شغّل الفيديو/i;
  if (watchInvites.test(allText)) {
    finding('HIGH', 'video', 'the artifact invites the reader to watch a video that has not been recorded.');
  }
  if (!findings.some((f) => f.area === 'video')) {
    ok('video', 'both videos are placeholders: no player, no media file, no invitation to watch');
  }
}

// ---------------------------------------------------------------------------
// 5. Claim register freshness — claims.mjs against the authoritative CSV
// ---------------------------------------------------------------------------
{
  const csv = await readFile(join(REPO, 'docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv'), 'utf8');

  /**
   * A real RFC4180 reader, not `line.split(',')`.
   *
   * The naive version reported 19 CRITICAL claim mismatches on a corpus where
   * every claim actually agrees with the register: the evidence column contains
   * commas inside quotes, so every column after it was shifted and the status
   * column read back things like "network payloads". A checker that fabricates
   * 19 criticals is worse than no checker -- the real one would be lost in them.
   */
  const rows = parseCsv(csv);
  const header = rows[0];
  const idCol = header.findIndex((h) => /claim.?id/i.test(h));
  const statusCol = header.findIndex((h) => /status/i.test(h));
  const registered = new Map(rows.slice(1).filter((r) => r[idCol]).map((r) => [r[idCol].trim(), (r[statusCol] ?? '').trim()]));

  const { STATUS_LABEL_KEY } = await import('../src/content/claims.mjs');

  // Which claims the artifact actually asserts, taken from the pre-strip render
  // rather than from dist/ -- the anchors are stripped before the HTML ships.
  const { renderPages } = await import('../build.mjs');
  const { siteOrigin } = await import('../src/lib/seo.mjs');
  const renderedClaimIds = new Set();
  for (const page of renderPages(siteOrigin())) {
    for (const m of page.htmlWithMetadata.matchAll(/data-claim="([^"]+)"/g)) renderedClaimIds.add(m[1]);
  }
  let drift = 0;
  let proposed = 0;
  for (const [id, claim] of Object.entries(CLAIMS)) {
    if (!registered.has(id)) {
      // Absent from the register means PROPOSED. The build allows a proposal to
      // exist in source; what matters is whether the ARTIFACT asserts it. So the
      // question is not "could this render a label" but "does this ship".
      if (renderedClaimIds.has(id)) {
        finding('CRITICAL', 'claim-register', `${id} is rendered by the site but is not in the register CSV.`);
        drift++;
      } else {
        proposed++;
        if (STATUS_LABEL_KEY[claim.status] !== null) {
          notes.push(
            `${id} is proposed (not in the register) and its status ${claim.status} could render a label. ` +
              'Not shipping -- assertRenderedClaimsAreRegistered() in build.mjs now refuses to render it.'
          );
        }
      }
    } else if (registered.get(id) !== claim.status) {
      finding('CRITICAL', 'claim-register', `${id}: site says ${claim.status}, register says ${registered.get(id)}.`);
      drift++;
    }
  }
  if (!drift) {
    ok(
      'claim-register',
      `${renderedClaimIds.size} rendered claim(s) all in the register; ${Object.keys(CLAIMS).length} defined, ${proposed} proposed and none rendered`
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Arabic must not assert more than English on the release-state phrases
// ---------------------------------------------------------------------------
{
  const countIn = (locale, re) =>
    Object.values(CONTENT[locale])
      .flatMap((v) =>
        typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap((i) => (typeof i === 'string' ? [i] : Object.values(i))) : []
      )
      .filter((s) => typeof s === 'string' && re.test(s)).length;

  const pairs = [
    { label: 'later release', en: /later release/i, ar: /إصدار لاحق/ },
    // No \b before the Arabic alternatives: JS \b is ASCII-word based, so it never
    // matches at an Arabic letter boundary and the pattern silently finds nothing.
    { label: 'not open / not available yet', en: /\bnot (?:open|available|able)\b/i, ar: /(لم تُفتح|غير متاح|لا يمكننا|غير متاحة|لم يُفتح)/ },
    { label: 'readable (privacy qualifier)', en: /\breadable\b/i, ar: /مقروء/ },
  ];
  for (const p of pairs) {
    const en = countIn('en', p.en);
    const ar = countIn('ar', p.ar);
    if (ar < en) {
      finding(
        'CRITICAL',
        'en-ar-drift',
        `"${p.label}" appears in ${en} English string(s) but only ${ar} Arabic string(s) — the Arabic may assert more than the English.`
      );
    } else {
      ok('en-ar-drift', `"${p.label}" EN ${en} / AR ${ar}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Internal metadata and external calls
// ---------------------------------------------------------------------------
{
  const internal = /data-claim|CLM-\d{3}|PPR1R-|OD-\d{2}|PUBLIC-\d{1,2}\b|NOT_APPROVED_FOR_PUBLIC_CLAIM|COMING_LATER|REQUIRES_PLATFORM_SUPPORT/;
  const leaks = [...corpus].filter(([, body]) => internal.test(body)).map(([rel]) => rel);
  if (leaks.length) finding('CRITICAL', 'internal-metadata', `internal governance vocabulary ships in: ${leaks.join(', ')}`);
  else ok('internal-metadata', `no claim ids or governance vocabulary in any of ${corpus.size} shipped text files`);

  const external = [];
  for (const [rel, body] of htmlFiles) {
    for (const m of body.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
      if (!m[1].startsWith('https://www.pcasafe.com')) external.push(`${rel}: ${m[1]}`);
    }
  }
  for (const [rel, body] of corpus) {
    if (/\bfetch\s*\(|XMLHttpRequest|new WebSocket|new EventSource|@import\s+url\(https?:/i.test(body)) {
      external.push(`${rel}: runtime network call`);
    }
  }
  if (external.length) finding('CRITICAL', 'external', `the artifact reaches off-origin: ${external.slice(0, 4).join(' | ')}`);
  else ok('external', 'zero off-origin references and zero runtime network calls');
}

// ---------------------------------------------------------------------------
// 8. SEO integrity — canonical, hreflang, sitemap agreement
// ---------------------------------------------------------------------------
{
  const sitemap = corpus.get('/sitemap.xml') ?? '';
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const [rel, body] of htmlFiles) {
    if (rel === '/404.html') continue;
    const path = rel.replace(/index\.html$/, '');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(body)?.[1];
    const expected = `https://www.pcasafe.com${path}`;
    if (canonical !== expected) finding('HIGH', 'seo', `${path}: canonical is "${canonical}", expected "${expected}".`);
    const indexable = !/name="robots"\s+content="noindex/.test(body);
    const inSitemap = locs.includes(expected);
    if (indexable && !inSitemap) finding('HIGH', 'seo', `${path} is indexable but missing from the sitemap.`);
    if (!indexable && inSitemap) finding('CRITICAL', 'seo', `${path} is noindex but listed in the sitemap.`);
    // Only the <link rel="alternate"> elements define the hreflang set. The header
    // language switcher is a pair of <a hreflang> links, which is correct markup
    // and must not be counted -- scanning every hreflang attribute reported
    // [ar,ar,en,en,x-default] on all 14 pages.
    const alts = [...body.matchAll(/<link rel="alternate" hreflang="([^"]+)"/g)].map((m) => m[1]).sort();
    if (alts.join(',') !== 'ar,en,x-default') finding('HIGH', 'seo', `${path}: hreflang set is [${alts}], expected en, ar, x-default.`);
  }
  if (!findings.some((f) => f.area === 'seo')) {
    ok('seo', `canonical, hreflang and sitemap agree across ${htmlFiles.length - 1} pages (${locs.length} indexable)`);
  }
}

// ---------------------------------------------------------------------------
// 9. Artifact reproducibility — the same source must produce the same bytes
// ---------------------------------------------------------------------------
{
  const manifestOf = () => {
    execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'ignore' });
    execFileSync(process.execPath, ['deploy/manifest.mjs'], { cwd: ROOT, stdio: 'ignore' });
    return readFile(join(ROOT, 'reports/MANIFEST.sha256'), 'utf8');
  };
  const first = await manifestOf();
  const second = await manifestOf();
  const shaOf = (m) => /# artifact-sha256: ([0-9a-f]{64})/.exec(m)?.[1];
  if (first !== second) {
    finding('CRITICAL', 'reproducibility', `two consecutive builds of the same source produced different artifacts (${shaOf(first)} vs ${shaOf(second)}).`);
  } else {
    ok('reproducibility', `two consecutive builds byte-identical, artifact-sha256 ${shaOf(first)}`);
  }
}

// ---------------------------------------------------------------------------
// 10. Live container: headers, routing, stray files
// ---------------------------------------------------------------------------
if (BASE) {
  const get = async (p) => {
    const res = await fetch(BASE.replace(/\/$/, '') + p, { redirect: 'manual' });
    return { res, body: await res.text() };
  };
  for (const stray of ['/50x.html', '/build-report.json', '/MANIFEST.sha256', '/package.json', '/build.mjs', '/.git/config', '/reports/']) {
    const { res } = await get(stray);
    if (res.status !== 404 && res.status !== 403) finding('CRITICAL', 'image-root', `${stray} is served (HTTP ${res.status}).`);
  }
  const { res: notFound } = await get('/no-such-page-' + Date.now());
  if (notFound.status !== 404) finding('CRITICAL', 'routing', `an unknown path returns HTTP ${notFound.status}, not 404.`);
  if (!notFound.headers.get('Content-Security-Policy')) finding('CRITICAL', 'headers', 'the 404 response carries no CSP.');
  const { res: redir } = await get('/privacy');
  if (/^https?:\/\//i.test(redir.headers.get('Location') ?? '')) {
    finding('HIGH', 'routing', `the directory redirect leaks an absolute origin: ${redir.headers.get('Location')}`);
  }
  if (!findings.some((f) => ['image-root', 'routing', 'headers'].includes(f.area))) {
    ok('container', 'no stray file served, real 404 with CSP, relative redirects');
  }
} else {
  ok('container', 'skipped — no base URL given');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const critical = findings.filter((f) => f.severity === 'CRITICAL');
const high = findings.filter((f) => f.severity === 'HIGH');

console.log('RELEASE A — FINAL ADVERSARIAL PASS\n');
for (const c of checked) console.log('  pass  ' + c);
for (const n of notes) console.log('  note  ' + n);
console.log('');
if (findings.length) {
  for (const f of findings) console.log(`  ${f.severity}  [${f.area}] ${f.what}`);
  console.log('');
}
console.log(`RELEASE_A_REPO_CRITICAL_FINDINGS = ${critical.length}`);
console.log(`RELEASE_A_REPO_HIGH_FINDINGS     = ${high.length}`);
if (findings.length) process.exitCode = 1;
