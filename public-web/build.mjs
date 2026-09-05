/**
 * PCA Public — build.
 *
 * Zero dependencies. `node build.mjs` produces dist/ with no install step, no
 * node_modules, no lockfile and no supply-chain surface. That was a deliberate
 * choice: PUBLIC-0 recorded that this repo has no workspace tooling, so a new
 * package would otherwise mean a seventh independent node_modules plus a new
 * entry in the CI dependency-audit job. There is nothing here to audit.
 *
 * EVERY GATE BELOW IS EXECUTED, NOT DOCUMENTED.
 *
 * The repository's recorded pattern is quality signals that report green while
 * asserting nothing -- a mutation runner that runs no tests, an accessibility
 * suite that cannot evaluate contrast because it runs in jsdom, a two-layer
 * token rule kept only in a comment (and already broken in four rules), an RTL
 * invariant guarded only by a Playwright spec CI never runs. So each gate here
 * computes a real answer and throws:
 *
 *   assertContentParity   EN/AR key sets, array shapes, no empty strings
 *   assertContrast        real WCAG 2.1 relative-luminance maths on every pair
 *   assertNoPhysicalCss   no margin-left/padding-right/left:/right: box props
 *   assertNoRawTokenUse   components never reference a Layer-1 --pca-* token
 *   assertClaimLabels     no status label stronger than the claim register
 *   assertNoForbiddenText unambiguous prohibited claim strings
 *   assertNoExternalRefs  no third-party origin in any href/src
 *
 * Scope honesty: assertNoForbiddenText matches only phrases that cannot be
 * anything but a violation. It deliberately does NOT try to distinguish an
 * assertion from a negation -- the approved copy legitimately says prices are
 * "not yet approved", and a naive substring rule would fail on it. Nuanced
 * wording is gated by the claim register and human review, not by this scan.
 * Saying so is the point; a scan that pretends to full coverage would be
 * exactly the kind of green signal this project has learned to distrust.
 */

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT, NEW_COPY, AR_REVIEW_PENDING, PAGE_CONTENT } from './src/content/index.mjs';
import {
  LOCALES,
  LOCALE_META,
  DEFAULT_LOCALE,
  RELEASE,
  ROUTES,
  buildableRoutes,
  mainRoutes,
  utilityRoutes,
  urlFor,
  outputPathFor,
} from './src/content/routes.mjs';
import { VIDEOS } from './src/content/videos.mjs';
import { CLAIMS, STATUS_CSS, labelKeyForClaim, PROPOSED_CLAIMS } from './src/content/claims.mjs';
import { siteOrigin, absoluteUrl, REQUIRED_RESPONSE_HEADERS, CSP_CONTENT } from './src/lib/seo.mjs';
import * as homePage from './src/pages/home.mjs';
import * as howItWorksPage from './src/pages/howItWorks.mjs';
import * as privacyPage from './src/pages/privacy.mjs';
import * as contactPage from './src/pages/contact.mjs';
import * as accessibilityPage from './src/pages/accessibility.mjs';
import * as privacyPolicyPage from './src/pages/privacyPolicy.mjs';
import * as termsPage from './src/pages/terms.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');

/**
 * Reports live OUTSIDE the deploy root.
 *
 * PUBLIC-14 found build-report.json shipping at dist/build-report.json —
 * reachable at https://www.pcasafe.com/build-report.json — carrying the whole
 * internal claim-governance state: which claims are unproven, that auth is not
 * live, that a predeploy security blocker exists. dist/ is what gets deployed,
 * so nothing internal may be written into it. The same applied to the UAT
 * harness's release-a-evidence.json.
 */
const REPORTS = join(ROOT, 'reports');
const CHECK_ONLY = process.argv.includes('--check-only');

/** routeId -> page module. A route builds only when a renderer exists. */
const PAGES = {
  // The three main public pages (owner IA ruling, 2026-09-05)
  home: homePage,
  howItWorks: howItWorksPage,
  privacy: privacyPage,
  // Utility and legal — footer only, never primary navigation
  contact: contactPage,
  accessibility: accessibilityPage,
  privacyPolicy: privacyPolicyPage,
  terms: termsPage,
};

const IMPLEMENTED = new Set(Object.keys(PAGES));

const failures = [];
function fail(gate, message) {
  failures.push(`[${gate}] ${message}`);
}

// ---------------------------------------------------------------------------
// Gate 1 — EN/AR content parity
// ---------------------------------------------------------------------------

function shapeOf(value) {
  if (Array.isArray(value)) return `array:${value.length}`;
  if (value && typeof value === 'object') return `object:${Object.keys(value).sort().join(',')}`;
  return typeof value;
}

function assertContentParity() {
  const enContent = CONTENT.en;
  const arContent = CONTENT.ar;
  const enKeys = Object.keys(enContent).sort();
  const arKeys = Object.keys(arContent).sort();

  for (const key of enKeys) {
    if (!(key in arContent)) fail('parity', `key present in EN but missing in AR: ${key}`);
  }
  for (const key of arKeys) {
    if (!(key in enContent)) fail('parity', `key present in AR but missing in EN: ${key}`);
  }

  for (const key of enKeys) {
    if (!(key in arContent)) continue;
    const a = enContent[key];
    const b = arContent[key];
    if (shapeOf(a) !== shapeOf(b)) {
      fail('parity', `shape mismatch for ${key}: EN ${shapeOf(a)} vs AR ${shapeOf(b)}`);
      continue;
    }
    if (Array.isArray(a)) {
      a.forEach((item, i) => {
        if (shapeOf(item) !== shapeOf(b[i])) {
          fail('parity', `shape mismatch for ${key}[${i}]: EN ${shapeOf(item)} vs AR ${shapeOf(b[i])}`);
        }
        // A claim id attached in one locale must be attached in the other,
        // or the two languages would advertise different availability.
        if (item && typeof item === 'object' && item.claimId !== b[i]?.claimId) {
          fail('parity', `claimId mismatch for ${key}[${i}]: EN ${item.claimId} vs AR ${b[i]?.claimId}`);
        }
      });
    }
  }

  const emptyCheck = (locale, table) => {
    for (const [key, value] of Object.entries(table)) {
      const strings = [];
      const collect = (v) => {
        if (typeof v === 'string') strings.push(v);
        else if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') Object.values(v).forEach(collect);
      };
      collect(value);
      for (const s of strings) {
        if (s.trim() === '') fail('parity', `empty string in ${locale} for key ${key}`);
      }
    }
  };
  emptyCheck('en', enContent);
  emptyCheck('ar', arContent);

  return { enKeys: enKeys.length, arKeys: arKeys.length };
}

// ---------------------------------------------------------------------------
// Gate 2 — WCAG 2.1 contrast, computed
// ---------------------------------------------------------------------------

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const int = parseInt(m[1], 16);
  const r = channelLuminance((int >> 16) & 255);
  const g = channelLuminance((int >> 8) & 255);
  const b = channelLuminance(int & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every foreground/background pair the stylesheets actually put together.
 * `min` is 4.5 for text (WCAG 1.4.3 AA) and 3.0 for UI component boundaries
 * and focus indicators (1.4.11).
 */
const CONTRAST_PAIRS = [
  { name: 'text on surface', fg: '#132030', bg: '#ffffff', min: 4.5 },
  { name: 'text on canvas', fg: '#132030', bg: '#f7f9fc', min: 4.5 },
  { name: 'text on raised', fg: '#132030', bg: '#eef2f6', min: 4.5 },
  { name: 'text on warm', fg: '#132030', bg: '#faf6f0', min: 4.5 },
  { name: 'text on trust-soft (reassure block)', fg: '#132030', bg: '#e8f6f3', min: 4.5 },
  { name: 'secondary text on surface', fg: '#4a5a6e', bg: '#ffffff', min: 4.5 },
  { name: 'secondary text on canvas', fg: '#4a5a6e', bg: '#f7f9fc', min: 4.5 },
  { name: 'secondary text on raised', fg: '#4a5a6e', bg: '#eef2f6', min: 4.5 },
  { name: 'secondary text on warm', fg: '#4a5a6e', bg: '#faf6f0', min: 4.5 },
  { name: 'white on primary (button)', fg: '#ffffff', bg: '#1b5fa8', min: 4.5 },
  { name: 'white on primary hover', fg: '#ffffff', bg: '#164a85', min: 4.5 },
  { name: 'white on primary active', fg: '#ffffff', bg: '#113a68', min: 4.5 },
  { name: 'primary text on surface (link, secondary button)', fg: '#1b5fa8', bg: '#ffffff', min: 4.5 },
  { name: 'primary text on primary-soft (secondary hover)', fg: '#1b5fa8', bg: '#eaf1f9', min: 4.5 },
  { name: 'primary hover text on primary-soft', fg: '#164a85', bg: '#eaf1f9', min: 4.5 },
  { name: 'trust text on surface (eyebrow)', fg: '#0f766a', bg: '#ffffff', min: 4.5 },
  { name: 'trust text on canvas (eyebrow)', fg: '#0f766a', bg: '#f7f9fc', min: 4.5 },
  { name: 'trust text on warm (eyebrow)', fg: '#0f766a', bg: '#faf6f0', min: 4.5 },
  { name: 'white on trust (brand mark)', fg: '#ffffff', bg: '#0f766a', min: 4.5 },
  { name: 'status available', fg: '#12704b', bg: '#e7f5ee', min: 4.5 },
  { name: 'status limited', fg: '#7a5600', bg: '#fdf3dc', min: 4.5 },
  { name: 'status coming-later', fg: '#4a5a6e', bg: '#eef2f6', min: 4.5 },
  { name: 'status requires-platform', fg: '#1b5fa8', bg: '#eaf1f9', min: 4.5 },
  { name: 'notice', fg: '#7a5600', bg: '#fdf3dc', min: 4.5 },
  { name: 'danger', fg: '#b42318', bg: '#fdecea', min: 4.5 },
  { name: 'focus ring on surface', fg: '#0b57d0', bg: '#ffffff', min: 3.0 },
  { name: 'focus ring on canvas', fg: '#0b57d0', bg: '#f7f9fc', min: 3.0 },
  { name: 'focus ring on warm', fg: '#0b57d0', bg: '#faf6f0', min: 3.0 },
  { name: 'strong border on surface', fg: '#7d8ca0', bg: '#ffffff', min: 3.0 },
  { name: 'strong border on canvas', fg: '#7d8ca0', bg: '#f7f9fc', min: 3.0 },
];

function assertContrast() {
  const results = [];
  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    const pass = ratio >= pair.min;
    results.push({ ...pair, ratio: Number(ratio.toFixed(2)), pass });
    if (!pass) {
      fail('contrast', `${pair.name}: ${ratio.toFixed(2)}:1 is below the required ${pair.min}:1 (${pair.fg} on ${pair.bg})`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Gate 3 — RTL: no physical box properties in the stylesheets
// ---------------------------------------------------------------------------

const PHYSICAL_PROP = /(^|[;{\s])(margin|padding|border)-(left|right)\s*:/i;
const PHYSICAL_INSET = /(^|[;{\s])(left|right)\s*:/i;

/**
 * Blanks every /* ... *\/ block while preserving line count, so a comment that
 * merely NAMES a banned property (as this file's own rule descriptions do)
 * cannot trip the scan, and reported line numbers still match the source.
 */
function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

async function assertNoPhysicalCss(files) {
  for (const file of files) {
    const source = await readFile(join(ROOT, file), 'utf8');
    const scanned = stripCssComments(source);
    const original = source.split('\n');
    scanned.split('\n').forEach((line, i) => {
      if (PHYSICAL_PROP.test(line) || PHYSICAL_INSET.test(line)) {
        fail('rtl-css', `${file}:${i + 1} uses a physical box property; use the logical equivalent: ${original[i].trim()}`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Gate 4 — token layering: components never touch Layer 1
// ---------------------------------------------------------------------------

async function assertNoRawTokenUse(files) {
  for (const file of files) {
    const source = await readFile(join(ROOT, file), 'utf8');
    source.split('\n').forEach((line, i) => {
      if (/var\(\s*--pca-/.test(line)) {
        fail(
          'token-layer',
          `${file}:${i + 1} references a Layer-1 --pca-* token directly. Components must use the semantic --pw-* layer: ${line.trim()}`
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Gate 5/6/7 — rendered-output scans
// ---------------------------------------------------------------------------

/**
 * ARABIC patterns. The scan was Latin-only, so the absolute-privacy, free-plan,
 * pricing and store gates protected the English half of the site and nothing
 * else. These mirror the Latin patterns for the claims where an Arabic
 * violation is expressible.
 */
const FORBIDDEN_PATTERNS_AR = [
  { claim: 'CLM-025', label: 'Google Play availability (AR)', re: /Google\s*Play|متجر\s*جوجل/i },
  { claim: 'CLM-027', label: 'App Store availability (AR)', re: /App\s*Store|متجر\s*التطبيقات/i },
  { claim: 'CLM-038', label: 'production AI claim (AR)', re: /حماية\s*بالذكاء\s*الاصطناعي|الذكاء\s*الاصطناعي[^.]{0,30}(في\s*الإنتاج|مُفعّل|مفعل|نشط)/ },
  { claim: 'CLM-039', label: 'YouTube Mode B (AR)', re: /Mode\s*B|وضع\s*YouTube\s*المتقدم/i },
  { claim: 'CLM-041', label: 'free-plan promise (AR)', re: /خطة\s*مجانية\s*(دائمة|أبدية)|مجاني(ة)?\s*(إلى\s*)?الأبد|مجانًا\s*للأبد/ },
  // Affirmative constructions only. The approved Home FAQ copy says the
  // opposite ("لم تُنشر الخطط والأسعار النهائية بعد"), and a pattern that fires
  // on a negation would force a rewrite of owner-approved copy — the tail
  // wagging the dog, which this project has already corrected once.
  { claim: 'CLM-042', label: 'finalized pricing (AR)', re: /(تم\s*اعتماد|اعتُمدت|اُعتمدت)\s*(أسعار|الأسعار)|(أسعار|الأسعار)[^.]{0,25}متاحة\s*للعامة|\d+\s*(ريال|دولار|يورو|درهم)/ },
  { claim: 'CLM-044', label: 'absolute deletion claim (AR)', re: /(ال)?حذف\s*(ال)?فوري|يحذف[^.]{0,30}جميع\s*سجلات|بشكل\s*نهائي[^.]{0,20}فور/ },
  { claim: 'CLM-045', label: 'MFA claim (AR)', re: /المصادقة\s*(الثنائية|متعددة\s*العوامل)|مصادقة\s*(ثنائية|متعددة\s*العوامل)|التحقق\s*(بخطوتين|من\s*خطوتين)/ },
  { claim: 'CLM-048', label: 'screenshot attachment (AR)', re: /إرفاق\s*(لقطات|لقطة)\s*الشاشة|إرفاق\s*ملفات/ },
  { claim: 'CLM-052', label: 'absolute security claim (AR)', re: /غير\s*قابل(ة)?\s*للاختراق|100\s*%|بنسبة\s*100|أمان\s*مطلق|خصوصية\s*مطلقة|سرية\s*تامة/ },
  { claim: 'CLM-056', label: 'unapproved licence-free wording (AR)', re: /رخصة\s*مدفوعة|(بدون|دون)\s*(رخصة|ترخيص|دفع)|لا\s*يتطلب[^.]{0,30}(رخصة|ترخيص|دفع)/ },
];

/**
 * Every forbidden pattern must catch the sentence it exists to forbid.
 *
 * The claim register states each prohibited claim verbatim, in both languages,
 * on its NOT_APPROVED_FOR_PUBLIC_CLAIM rows. That makes it a ready-made test
 * corpus: if a pattern cannot match its own claim's CLAIM_TEXT, it cannot
 * protect anything, and the green build it produces is meaningless.
 *
 * PUBLIC-14 caught four Arabic patterns in exactly that state. This runs on
 * every build so it cannot happen again silently.
 */
async function assertForbiddenPatternsCatchTheirClaims() {
  const csv = await readFile(join(ROOT, '../docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv'), 'utf8');
  const rows = parseCsv(csv);
  const header = rows.shift() ?? [];
  const iId = header.indexOf('CLAIM_ID');
  const iEn = header.indexOf('CLAIM_TEXT_EN');
  const iAr = header.indexOf('CLAIM_TEXT_AR');
  const iStatus = header.indexOf('CURRENT_STATUS');

  const forbidden = new Map();
  for (const r of rows) {
    if (!r[iId] || (r[iStatus] ?? '').trim() !== 'NOT_APPROVED_FOR_PUBLIC_CLAIM') continue;
    forbidden.set(r[iId].trim(), { en: r[iEn] ?? '', ar: r[iAr] ?? '' });
  }

  let checked = 0;
  // A claim may be guarded by several patterns (CLM-052 has one for absolutes
  // and one for zero-data wording). The requirement is that AT LEAST ONE of a
  // claim's patterns catches the register's own prohibited sentence.
  const check = (patterns, lang) => {
    const byClaim = new Map();
    for (const p of patterns) {
      if (!forbidden.has(p.claim)) continue;
      if (!byClaim.has(p.claim)) byClaim.set(p.claim, []);
      byClaim.get(p.claim).push(p);
    }
    for (const [claim, group] of byClaim) {
      const text = lang === 'ar' ? forbidden.get(claim).ar : forbidden.get(claim).en;
      if (!text) continue;
      checked += 1;
      if (!group.some((p) => p.re.test(text))) {
        fail(
          'pattern-selftest',
          claim + ' has no ' + lang.toUpperCase() + ' pattern that matches the register\'s own prohibited text: "' + text +
            '" (patterns tried: ' + group.map((p) => p.label).join(', ') + ')'
        );
      }
    }
  };
  check(FORBIDDEN_PATTERNS, 'en');
  check(FORBIDDEN_PATTERNS_AR, 'ar');
  return checked;
}

const FORBIDDEN_PATTERNS = [
  // CLM-056 is APPROVED in the register but the owner ruling forbids rendering
  // it in Release A, so its absence needs a gate of its own.
  { claim: 'CLM-056', label: 'unapproved licence-free wording', re: /no\s+(paid\s+)?licen[cs]e\s+(is\s+)?(required|needed)|free\s+to\s+enroll?|without\s+(paying|payment)/i },
  { claim: 'CLM-025', label: 'Google Play availability', re: /google\s*play|play\.google\.com/i },
  { claim: 'CLM-027', label: 'App Store availability', re: /app\s*store|apps\.apple\.com/i },
  { claim: 'CLM-024/026', label: 'availability badge', re: /available\s+now|download\s+for\s+android/i },
  { claim: 'CLM-052', label: 'absolute security claim', re: /unhackable|military[-\s]?grade|100%\s*(secure|private)|complete\s+anonymity/i },
  { claim: 'CLM-052', label: 'zero-data claim', re: /zero\s+data|collects?\s+no\s+data/i },
  { claim: 'CLM-041', label: 'free-plan promise', re: /free\s+forever|always\s+free|permanent\s+free\s+plan|free\s+plan/i },
  { claim: 'CLM-042', label: 'price statement', re: /\$\s?\d|\d+\s?(USD|SAR|EUR|GBP)\b|pricing\s+is\s+(finalized|final|published)|prices?\s+(are|is)\s+(finalized|final|published|publicly\s+available)/i },
  { claim: 'CLM-045', label: 'parent MFA claim', re: /\bMFA\b|two[-\s]?factor|\b2FA\b|authenticator\s+app/i },
  { claim: 'CLM-054', label: 'accessibility conformance claim', re: /\bWCAG\b|AA\s+compliant|fully\s+accessible|section\s+508/i },
  { claim: 'CLM-048', label: 'feedback attachment', re: /attach\s+a\s+screenshot|upload\s+a\s+file|screenshot\s+attachment|attach\s+files?/i },
  { claim: 'CLM-038', label: 'production AI claim', re: /AI[-\s]?powered|production\s+AI|AI\s+protection\s+is\s+(enabled|active)/i },
  { claim: 'CLM-039', label: 'YouTube Mode B', re: /mode\s+b\b/i },
  { claim: 'CLM-044', label: 'absolute deletion claim', re: /(delete[sd]?|removal)[^.]{0,40}(immediately\s+and\s+irreversibly|all\s+records)/i },
];

/**
 * Auditable exemptions.
 *
 * The scan matches a banned phrase wherever it appears, and deliberately does
 * not try to tell an assertion from a negation. That is the right default --
 * but approved copy sometimes NAMES the promise PCA refuses to make, and
 * rewriting owner-approved copy to satisfy a regex would be the tail wagging
 * the dog. (It already happened once: a content writer softened the approved
 * "No misleading 'free forever' promise" into a vaguer sentence purely to get
 * past this gate.)
 *
 * So an exemption is possible, but only as an EXACT approved sentence, with a
 * written reason, printed on every build and recorded in dist/build-report.json.
 * A substring cannot be exempted, and nothing is exempted implicitly.
 */
const ALLOWED_EXACT_PHRASES = [
  // Empty. The single previous entry exempted the approved /access sentence
  // 'No misleading "free forever" promise'. The owner IA ruling consolidated
  // /access into Home's affordability section, which carries the CLM-040 values
  // statement without naming the promise, so nothing needs exempting today.
  // A stale exemption is a dead gate; assertAllowlistIsLive() below fails the
  // build if an entry no longer matches any rendered page.
];

/**
 * An exemption that no longer matches anything is a dead gate: it looks like
 * deliberate governance while protecting nothing, and it hides the fact that
 * the copy it was written for has gone. Fail the build instead.
 */
/**
 * Every key named in AR_REVIEW_PENDING or NEW_COPY must actually exist.
 *
 * PUBLIC-0 found parent-web ships an `_arReviewPending` array of 127 keys that
 * no test, lint rule or CI step reads, and whose count the PPR-2 ledger records
 * incorrectly. A review list that names deleted keys is worse than none: it
 * reports work outstanding that cannot be done, and hides work that can.
 * This consolidation deleted nine pages, which immediately stranded two keys.
 */
/**
 * Until sign-off is recorded, every Arabic key must be on the review list.
 * A curated subset silently understates the reviewer's job — PUBLIC-14 found
 * exactly that, with the highest-risk page's H1 and lede both omitted.
 */
function assertArabicReviewCoversCorpus() {
  const arKeys = Object.keys(CONTENT.ar);
  const listed = new Set(AR_REVIEW_PENDING);
  const missing = arKeys.filter((k) => !listed.has(k));
  if (missing.length) {
    fail(
      'ar-review',
      missing.length + ' Arabic key(s) ship but are not on AR_REVIEW_PENDING, e.g. ' + missing.slice(0, 3).join(', ') +
        '. The OD-12 gate covers the whole corpus; a partial list understates the review.'
    );
  }
}

function assertReviewListsAreLive() {
  const keys = new Set(Object.keys(CONTENT.en));
  for (const key of AR_REVIEW_PENDING) {
    if (!keys.has(key)) fail('review-list', `AR_REVIEW_PENDING names "${key}", which no longer exists in the content tables`);
  }
  for (const key of NEW_COPY) {
    if (!keys.has(key)) fail('review-list', `NEW_COPY names "${key}", which no longer exists in the content tables`);
  }
}

function assertAllowlistIsLive(allHtml) {
  for (const entry of ALLOWED_EXACT_PHRASES) {
    if (!allHtml.some((h) => h.includes(entry.phrase))) {
      fail(
        'allowlist-stale',
        `forbidden-claim exemption for ${entry.contentKey} [${entry.locale}] matches no rendered page. Remove it or restore the copy it was written for.`
      );
    }
  }
}

function assertNoForbiddenText(pageId, htmlText) {
  // Strip HTML comments so an explanatory note never trips a content gate.
  let visible = htmlText.replace(/<!--[\s\S]*?-->/g, '');

  // Remove exempted approved sentences before scanning. Exact match only.
  for (const entry of ALLOWED_EXACT_PHRASES) {
    if (visible.includes(entry.phrase)) visible = visible.split(entry.phrase).join(' ');
  }

  const patterns = pageId.endsWith(':ar')
    ? [...FORBIDDEN_PATTERNS, ...FORBIDDEN_PATTERNS_AR]
    : FORBIDDEN_PATTERNS;
  for (const pattern of patterns) {
    const match = pattern.re.exec(visible);
    if (match) {
      fail('forbidden-claim', `${pageId}: ${pattern.label} (${pattern.claim}) matched "${match[0].trim()}"`);
    }
  }
}

function assertClaimLabels(pageId, htmlText, locale) {
  const re = /<span class="pw-status ([^"]+)" data-claim="([^"]+)">([^<]*)<\/span>/g;
  let match;
  while ((match = re.exec(htmlText)) !== null) {
    const [, cssClass, claimId, text] = match;
    if (!CLAIMS[claimId]) {
      fail('claim-gate', `${pageId}: renders unregistered claim ${claimId}`);
      continue;
    }
    const expectedKey = labelKeyForClaim(claimId);
    if (!expectedKey) {
      fail('claim-gate', `${pageId}: claim ${claimId} (${CLAIMS[claimId].status}) must not render a status label at all`);
      continue;
    }
    if (STATUS_CSS[expectedKey] !== cssClass.trim()) {
      fail(
        'claim-gate',
        `${pageId}: claim ${claimId} is ${CLAIMS[claimId].status} and may only render "${expectedKey}", but rendered class "${cssClass}"`
      );
    }
    const expectedText = CONTENT[locale][expectedKey];
    if (text.trim() !== String(expectedText).trim()) {
      fail('claim-gate', `${pageId}: claim ${claimId} label text "${text}" does not match content key ${expectedKey}`);
    }
  }
}

/**
 * Every same-origin link must point at a path this build actually writes.
 * Catches links to approved-but-unimplemented routes, which would 404.
 */
function assertInternalLinksResolve(pageId, htmlText, emittedPaths) {
  const re = /href="(\/[^"#?]*)"/g;
  let match;
  while ((match = re.exec(htmlText)) !== null) {
    const href = match[1];
    if (href.startsWith('/assets/') || href === '/favicon.svg') continue;
    const target = href.endsWith('/') ? `${href.slice(1)}index.html` : href.slice(1);
    if (!emittedPaths.has(target)) {
      fail('internal-link', `${pageId}: links to "${href}" but this build emits no ${target}`);
    }
  }
}

/**
 * Internal claim/audit metadata must not reach production HTML.
 *
 * OWNER RULING, 2026-09-05 section 2: the public page has no need to expose
 * claim ids, review state or governance anchors in view-source.
 *
 * The audit relationship is preserved, not weakened. Ordering is what makes
 * that true: every page is rendered WITH data-claim, assertClaimLabels()
 * validates each label against the claim register on that markup, and only
 * then is the attribute stripped from what gets written to dist. So the gate
 * sees the anchors and the public never does.
 *
 * assertNoInternalClaimMetadata() then re-checks the stripped output, so the
 * two steps cannot silently drift apart -- a change that skipped the strip
 * would fail the build rather than quietly publish the ids.
 */
const INTERNAL_METADATA_ATTRS = ['data-claim', 'data-claim-id', 'data-claim-status', 'data-review'];

function stripInternalClaimMetadata(htmlText) {
  let out = htmlText;
  for (const attr of INTERNAL_METADATA_ATTRS) {
    out = out.replace(new RegExp('\\s' + attr + '="[^"]*"', 'g'), '');
  }
  return out;
}

function assertNoInternalClaimMetadata(pageId, publicHtml) {
  for (const attr of INTERNAL_METADATA_ATTRS) {
    if (publicHtml.includes(attr + '=')) {
      fail('internal-metadata', pageId + ': production HTML still contains ' + attr);
    }
  }
  const stray = /(?:data-|aria-[a-z]+=")[^"]*CLM-\d{3}/.exec(publicHtml);
  if (stray) {
    fail('internal-metadata', pageId + ': production HTML exposes a claim id in an attribute: ' + stray[0]);
  }
}

/**
 * Internal governance vocabulary that must not appear in ANY shipped file.
 *
 * The previous gate scanned rendered HTML only and reported zero, while claim
 * ids, register statuses, owner-decision ids and internal file paths were
 * sitting in the CSS header comment, the JS header comment, the favicon <desc>
 * and the caption-source headers. A sweep that cannot open the files where the
 * leak is will always report clean.
 */
const INTERNAL_VOCABULARY = [
  /CLM-\d{3}/,
  /\bPPR-?\d/,
  /\bOD-\d{2}\b/,
  /PUBLIC-\d{1,2}\b/,
  /claim register/i,
  /EXTERNAL_SECURITY_REVIEW/,
  /NOT_APPROVED_FOR_PUBLIC_CLAIM/,
  /REQUIRES_PLATFORM_SUPPORT/,
  /COMING_LATER/,
  /VERIFIED_AVAILABLE/,
  /NATIVE_REVIEW_REQUIRED/,
  /OWNER_APPROVAL_PENDING/,
  /build\.mjs|claims\.mjs|routes\.mjs|src\/content/,
  /D:[\\/]PCA/i,
  /127\.0\.0\.1|localhost/,
  /predeploy blocker/i,
];

/** Every file that will be deployed, whatever its type. */
async function assertNoInternalVocabularyInArtifact() {
  const { readdir } = await import('node:fs/promises');
  const walk = async (dir, prefix = '') => {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p, prefix + '/' + e.name)));
      else out.push({ abs: p, rel: prefix + '/' + e.name });
    }
    return out;
  };
  const TEXTUAL = ['.html', '.css', '.js', '.svg', '.txt', '.xml', '.json', '.webmanifest', '.vtt'];
  for (const f of await walk(DIST)) {
    if (!TEXTUAL.includes(extname(f.rel))) continue;
    const body = await readFile(f.abs, 'utf8');
    for (const re of INTERNAL_VOCABULARY) {
      const m = re.exec(body);
      if (m) {
        fail('internal-metadata', f.rel + ' leaks internal governance vocabulary: "' + m[0] + '"');
        break;
      }
    }
  }
}

function assertNoExternalRefs(pageId, htmlText, origin) {
  const re = /(?:href|src)="([^"]*)"/g;
  let match;
  while ((match = re.exec(htmlText)) !== null) {
    const value = match[1];
    if (!/^https?:\/\//i.test(value)) continue;
    // canonical / hreflang / og:url legitimately name the canonical origin.
    if (value.startsWith(origin)) continue;
    fail('external-ref', `${pageId}: references an external origin "${value}". Release A loads no third-party resource.`);
  }
}

// ---------------------------------------------------------------------------
// Gate 8 — video assets must exist before a video is marked available
// ---------------------------------------------------------------------------

/**
 * `available: true` is a promise that a real recording and its caption files
 * exist. This checks. Without it, flipping the flag would ship a <video> element
 * pointing at nothing -- a broken player, which the owner ruling forbids
 * explicitly. The poster is required in BOTH states, because the placeholder
 * card renders it.
 */
/**
 * Every shipped SVG must be well-formed XML.
 *
 * Found the hard way. Both video posters AND the favicon shipped with an XML
 * comment containing a double hyphen, which is illegal in XML. All three files
 * served HTTP 200 with the correct image/svg+xml content type, and the build
 * was green -- and every one of them rendered as a broken-image icon in a real
 * browser. A 200 and a MIME type prove delivery, not rendering.
 *
 * This gate checks the thing that actually broke. scripts/uat.mjs additionally
 * asserts naturalWidth > 0 for every <img> in a real browser, which catches the
 * whole class rather than this one cause.
 */
/**
 * The claim table must agree with the authoritative claim register CSV.
 *
 * WHY THIS IS THE GATE THAT MATTERS. assertClaimLabels() checks that a page
 * renders the label its claim status permits -- but statusPill() derives the
 * label from that same table, so the two agree by construction. Flipping a
 * status in claims.mjs changes the render and the expectation together and no
 * page-level check can see it. Proven, not assumed: flipping CLM-024 from
 * COMING_LATER to VERIFIED_AVAILABLE left the build green.
 *
 * PCA_PUBLIC_CLAIM_REGISTER.csv is the only independent source of truth, so
 * this parses it and compares. Both directions are enforced, so a claim cannot
 * be quietly promoted here, and a proposed claim cannot linger in the PROPOSED
 * list after the owner adds its real row.
 */
/** Minimal RFC4180 row reader: the CLAIM_TEXT columns contain commas. */
function parseCsv(csv) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function assertClaimsMatchRegister() {
  // The LIVING register is authoritative: the 53 rows issued in the frozen v0.2
  // package, plus rows approved since. The frozen package keeps its SHA256SUMS
  // integrity evidence intact because nothing is ever appended to it.
  const livingPath = join(ROOT, '../docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv');
  const basePath = join(
    ROOT,
    '../docs/public/PCA_Public_Programme_Documentation_Package_v0.2/PCA_PUBLIC_CLAIM_REGISTER.csv'
  );
  let csv;
  let baseCsv;
  try {
    csv = await readFile(livingPath, 'utf8');
    baseCsv = await readFile(basePath, 'utf8');
  } catch {
    fail('claim-register', 'claim register not found (living: ' + livingPath + ')');
    return { registered: 0, proposed: PROPOSED_CLAIMS.size, inherited: 0 };
  }

  const rows = parseCsv(csv);
  const header = rows.shift() ?? [];
  const idCol = header.indexOf('CLAIM_ID');
  const statusCol = header.indexOf('CURRENT_STATUS');
  if (idCol === -1 || statusCol === -1) {
    fail('claim-register', 'claim register CSV is missing CLAIM_ID or CURRENT_STATUS');
    return { registered: 0, proposed: PROPOSED_CLAIMS.size, inherited: 0 };
  }

  const csvStatus = new Map();
  for (const r of rows) {
    if (!r[idCol]) continue;
    csvStatus.set(r[idCol].trim(), (r[statusCol] ?? '').trim());
  }

  // The frozen baseline must still be honoured: every row it issued has to
  // appear in the living register with the SAME status. Approving new claims is
  // additive; silently re-adjudicating an issued one is not.
  const baseRows = parseCsv(baseCsv);
  const baseHeader = baseRows.shift() ?? [];
  const bId = baseHeader.indexOf('CLAIM_ID');
  const bStatus = baseHeader.indexOf('CURRENT_STATUS');
  let inherited = 0;
  for (const r of baseRows) {
    if (!r[bId]) continue;
    inherited += 1;
    const id = r[bId].trim();
    if (!csvStatus.has(id)) {
      fail('claim-register', id + ' was issued in the frozen v0.2 package but is missing from the living register.');
    } else if (csvStatus.get(id) !== (r[bStatus] ?? '').trim()) {
      fail(
        'claim-register',
        id + ' was issued as ' + (r[bStatus] ?? '').trim() + ' in the frozen v0.2 package but the living register says ' + csvStatus.get(id) + '.'
      );
    }
  }

  for (const [id, claim] of Object.entries(CLAIMS)) {
    const inCsv = csvStatus.has(id);
    const isProposed = PROPOSED_CLAIMS.has(id);

    if (isProposed && inCsv) {
      fail(
        'claim-register',
        id + ' is listed as PROPOSED but now exists in the claim register. Remove it from PROPOSED_CLAIMS and align its status with the CSV.'
      );
      continue;
    }
    if (!isProposed && !inCsv) {
      fail('claim-register', id + ' is used by this site but is not a row in the claim register CSV.');
      continue;
    }
    if (inCsv && csvStatus.get(id) !== claim.status) {
      fail(
        'claim-register',
        id + ': claims.mjs says ' + claim.status + ' but the claim register says ' + csvStatus.get(id) + '.'
      );
    }
  }

  return { registered: csvStatus.size, proposed: PROPOSED_CLAIMS.size, inherited };
}

/**
 * <desc> is read by assistive technology and ships publicly, so it must be a
 * plain description of the image. PUBLIC-14 found the favicon's desc carrying
 * OWNER_APPROVAL_PENDING and a design-guideline rationale.
 */
async function assertSvgDescIsPublicSafe() {
  const { readdir } = await import('node:fs/promises');
  for (const dir of ['src/assets', 'src/assets/video']) {
    let names = [];
    try { names = await readdir(join(ROOT, dir)); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith('.svg'))) {
      const rel = dir + '/' + name;
      const svg = await readFile(join(ROOT, rel), 'utf8');
      for (const m of svg.matchAll(/<desc>([\s\S]*?)<\/desc>/g)) {
        for (const re of INTERNAL_VOCABULARY) {
          if (re.test(m[1])) {
            fail('svg-desc', rel + ': <desc> contains internal vocabulary ("' + (re.exec(m[1]) ?? [''])[0] + '"). It is read aloud by screen readers and ships publicly.');
            break;
          }
        }
      }
    }
  }
}

async function assertSvgAssetsAreWellFormed() {
  const { readdir } = await import('node:fs/promises');
  for (const dir of ['src/assets', 'src/assets/video']) {
    let names = [];
    try {
      names = await readdir(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith('.svg'))) {
      const rel = dir + '/' + name;
      const svg = await readFile(join(ROOT, rel), 'utf8');
      for (const match of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
        if (match[1].includes('--')) {
          fail(
            'svg-wellformed',
            rel + ': an XML comment contains a double hyphen, which is illegal in XML and makes the file unrenderable. Use <desc> instead.'
          );
        }
      }
      if (!/viewBox=/.test(svg)) {
        fail('svg-wellformed', rel + ': no viewBox, so the image has no intrinsic aspect ratio');
      }
      if (!/^<svg[\s>]/m.test(svg.trim())) {
        fail('svg-wellformed', rel + ': does not start with an <svg> root element');
      }
    }
  }
}

async function assertVideoAssets() {
  const { access } = await import('node:fs/promises');
  const exists = async (rel) => {
    try {
      await access(join(ROOT, 'src', rel.replace(/^\/assets\//, 'assets/')));
      return true;
    } catch {
      return false;
    }
  };

  for (const video of Object.values(VIDEOS)) {
    if (!(await exists(video.poster))) {
      fail('video-assets', `video "${video.id}": poster ${video.poster} does not exist`);
    }
    if (!video.available) continue;
    if (!video.src) {
      fail('video-assets', `video "${video.id}" is marked available but has no src`);
      continue;
    }
    if (!(await exists(video.src))) {
      fail('video-assets', `video "${video.id}" is marked available but ${video.src} does not exist`);
    }
    for (const loc of video.captions) {
      if (!(await exists(`/assets/video/${video.id}.${loc}.vtt`))) {
        fail('video-assets', `video "${video.id}" is marked available but has no ${loc} caption file`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Gate 9 — no duplicated public content across pages
// ---------------------------------------------------------------------------

/**
 * The owner IA ruling's core goal: NO DUPLICATE PUBLIC CONTENT.
 *
 * Consolidating fourteen pages into three is only worth doing if the same
 * explanation does not simply reappear on all three. This extracts visible
 * sentences from each rendered page and reports any substantive one (>= 8
 * words) that appears on more than one route.
 *
 * Shared chrome is excluded by construction: header, footer and the skip link
 * are stripped before comparison, so navigation labels and the footer legal
 * note never count as duplication.
 */
const DUPLICATION_MIN_WORDS = 8;

function visibleSentences(htmlText) {
  const body = htmlText
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<header[\s\S]*?<\/header>/g, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/g, ' ')
    .replace(/<a class="pw-skip"[\s\S]*?<\/a>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  // Split on sentence-terminal punctuation (including the Arabic question mark
  // U+061F) or on a line break. A character class is used for the line break
  // rather than an escape, because this exact line previously shipped with a
  // literal newline inside the regex -- which made the whole module a
  // SyntaxError and silently disabled the duplication, reading-time and
  // video-asset gates. `node --check build.mjs` now runs in the check script.
  return body
    .split(/(?<=[.!?؟])\s+|[\r\n]+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.split(' ').length >= DUPLICATION_MIN_WORDS);
}

/**
 * Sentences that come from the GLOBAL content table are shared chrome by
 * design -- one string, rendered on many pages. The provisional-legal-draft
 * notice is the clear case: privacyPolicy and terms both render
 * global.legal.provisionalNotice, and that is correct, not duplication.
 *
 * Excluding them by VALUE (not by page) keeps the gate honest: if a page
 * author copies a global sentence into their own table, it is still global
 * text and still exempt -- but any sentence they actually wrote twice is not.
 */
function globalSentences() {
  const out = new Set();
  for (const locale of LOCALES) {
    const globalKeys = Object.keys(CONTENT[locale]).filter(
      (k) => !Object.values(PAGE_CONTENT).some((t) => k in t[locale])
    );
    for (const key of globalKeys) {
      const value = CONTENT[locale][key];
      const strings = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
      for (const str of strings) {
        for (const sentence of visibleSentences(str)) out.add(sentence.toLowerCase());
      }
    }
  }
  return out;
}

function findDuplicateContent(pages) {
  const exempt = globalSentences();
  const index = new Map();
  for (const page of pages) {
    for (const sentence of visibleSentences(page.html)) {
      if (exempt.has(sentence.toLowerCase())) continue;
      const key = `${page.locale}::${sentence.toLowerCase()}`;
      if (!index.has(key)) index.set(key, { sentence, locale: page.locale, routes: new Set() });
      index.get(key).routes.add(page.routeId);
    }
  }
  const dupes = [];
  for (const entry of index.values()) {
    if (entry.routes.size > 1) {
      dupes.push({
        locale: entry.locale,
        routes: [...entry.routes].sort(),
        sentence: entry.sentence.slice(0, 140),
      });
    }
  }
  return dupes;
}

// ---------------------------------------------------------------------------
// Gate 10 — Home reading time
// ---------------------------------------------------------------------------

/**
 * Owner ruling: Home must be a 2-3 minute read. At a conservative 200 words per
 * minute that is roughly 400-600 words; the gate allows up to 900 before
 * failing, so it catches an essay creeping back rather than policing style.
 */
const HOME_MAX_WORDS = 900;

function homeWordCount(pages) {
  const home = pages.find((p) => p.routeId === 'home' && p.locale === 'en');
  if (!home) return 0;
  return visibleSentences(home.html).join(' ').split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function makeTranslator(locale) {
  const table = CONTENT[locale];
  return function t(key) {
    if (!(key in table)) {
      throw new Error(`Missing content key "${key}" for locale "${locale}".`);
    }
    return table[key];
  };
}

function renderPages(origin) {
  const rendered = [];
  const routes = buildableRoutes().filter((r) => PAGES[r.id]);

  for (const route of routes) {
    for (const locale of LOCALES) {
      const ctx = {
        locale,
        dir: LOCALE_META[locale].dir,
        routeId: route.id,
        origin,
        t: makeTranslator(locale),
        // Routes that actually have a renderer. Components link only to these,
        // so an approved-but-unimplemented route never becomes a 404 link.
        built: IMPLEMENTED,
      };
      const htmlText = PAGES[route.id].render(ctx);
      const pageId = `${route.id}:${locale}`;

      assertNoForbiddenText(pageId, htmlText);
      assertClaimLabels(pageId, htmlText, locale);
      assertNoExternalRefs(pageId, htmlText, origin);

      // Direction and language must be in the SERVED markup, not applied later.
      if (!htmlText.includes(`lang="${LOCALE_META[locale].htmlLang}"`)) {
        fail('i18n-html', `${pageId}: served HTML does not declare lang="${LOCALE_META[locale].htmlLang}"`);
      }
      if (!htmlText.includes(`dir="${LOCALE_META[locale].dir}"`)) {
        fail('i18n-html', `${pageId}: served HTML does not declare dir="${LOCALE_META[locale].dir}"`);
      }

      // Claim gate first, on the markup that still carries the anchors...
      // ...then strip them so production HTML ships without internal metadata.
      const publicHtml = stripInternalClaimMetadata(htmlText);
      assertNoInternalClaimMetadata(pageId, publicHtml);

      rendered.push({ routeId: route.id, locale, path: outputPathFor(route.id, locale), html: publicHtml });
    }
  }

  const emittedPaths = new Set(rendered.map((p) => p.path));
  for (const page of rendered) {
    assertInternalLinksResolve(`${page.routeId}:${page.locale}`, page.html, emittedPaths);
  }

  return rendered;
}

function notFoundPage() {
  /**
   * Reads from the content tables rather than hardcoding, so the Arabic here is
   * covered by assertArabicReviewCoversCorpus(). PUBLIC-14 re-verification
   * found two Arabic sentences inlined in this function: on no review list,
   * invisible to a gate that can only see keys that exist.
   */
  const en = makeTranslator('en');
  const ar = makeTranslator('ar');
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${en('notFound.seo.title')}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/pca-public.css">
</head>
<body>
<main id="pw-main">
  <section class="pw-hero">
    <div class="pw-container">
      <h1 class="pw-hero__title">${en('notFound.title')}</h1>
      <p class="pw-hero__lead">${en('notFound.body')}</p>
      <div class="pw-cta-row">
        <a class="pw-btn pw-btn--primary" href="/">${en('notFound.homeCta')}</a>
      </div>
      <p class="pw-reassure" lang="ar" dir="rtl">${ar('notFound.arabicNote')} <a href="/ar/">${ar('notFound.arabicHomeCta')}</a></p>
    </div>
  </section>
</main>
</body>
</html>
`;
}

function sitemapXml(origin) {
  const entries = [];
  for (const route of buildableRoutes()) {
    if (!PAGES[route.id]) continue;
    if (!route.indexable) continue;
    for (const locale of LOCALES) {
      const alternates = LOCALES.map(
        (alt) => `    <xhtml:link rel="alternate" hreflang="${LOCALE_META[alt].htmlLang}" href="${absoluteUrl(route.id, alt, origin)}"/>`
      ).join('\n');
      entries.push(
        `  <url>\n    <loc>${absoluteUrl(route.id, locale, origin)}</loc>\n` +
          (route.priority ? `    <priority>${route.priority}</priority>\n` : '') +
          `${alternates}\n  </url>`
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

function robotsTxt(origin) {
  const disallow = buildableRoutes()
    .filter((r) => PAGES[r.id] && !r.indexable)
    .flatMap((r) => LOCALES.map((l) => `Disallow: ${urlFor(r.id, l)}`));
  return `# PCA Public
User-agent: *
${disallow.length ? disallow.join('\n') : 'Allow: /'}

Sitemap: ${origin}/sitemap.xml
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const origin = siteOrigin();

  const parity = assertContentParity();
  const contrast = assertContrast();
  await assertNoPhysicalCss(['src/styles/base.css', 'src/styles/components.css']);
  await assertNoRawTokenUse(['src/styles/base.css', 'src/styles/components.css']);
  const claimRegister = await assertClaimsMatchRegister();
  const patternsSelfTested = await assertForbiddenPatternsCatchTheirClaims();
  await assertSvgAssetsAreWellFormed();
  await assertSvgDescIsPublicSafe();
  await assertVideoAssets();
  assertReviewListsAreLive();
  assertArabicReviewCoversCorpus();

  const pages = renderPages(origin);

  assertAllowlistIsLive(pages.map((p) => p.html));

  const duplicates = findDuplicateContent(pages);
  for (const d of duplicates) {
    fail('duplication', `[${d.locale}] the same sentence appears on ${d.routes.join(' and ')}: "${d.sentence}"`);
  }

  const homeWords = homeWordCount(pages);
  if (homeWords > HOME_MAX_WORDS) {
    fail('reading-time', `Home is ${homeWords} English words, over the ${HOME_MAX_WORDS} ceiling. The owner ruling targets a 2-3 minute read.`);
  }

  if (failures.length) {
    console.error('\nBUILD FAILED — %d gate failure(s):\n', failures.length);
    for (const f of failures) console.error('  ' + f);
    console.error('');
    process.exitCode = 1;
    return;
  }

  const implemented = Object.keys(PAGES);
  const mainIds = mainRoutes().map((r) => r.id);
  const utilityIds = utilityRoutes().map((r) => r.id);
  const pending = ROUTES.filter((r) => r.build && !PAGES[r.id]).map((r) => r.id);

  const report = {
    generatedFrom: 'public-web/build.mjs',
    origin,
    release: RELEASE,
    locales: [...LOCALES],
    contentKeys: parity,
    primaryPublicPages: mainIds,
    utilityRoutes: utilityIds,
    videos: Object.fromEntries(
      Object.values(VIDEOS).map((v) => [v.id, { available: v.available, poster: v.poster, captionsRequired: v.captions }])
    ),
    contentDuplicationFindings: duplicates.length,
    internalClaimMetadataExposed: pages.reduce(
      (n, p) => n + INTERNAL_METADATA_ATTRS.filter((a) => p.html.includes(a + '=')).length,
      0
    ),
    homeEnglishWords: homeWords,
    pagesImplemented: implemented,
    routesApprovedButNotYetImplemented: pending,
    pagesEmitted: pages.length,
    contrast: {
      pairsChecked: contrast.length,
      allPass: contrast.every((c) => c.pass),
      minRatio: Math.min(...contrast.map((c) => c.ratio)),
      results: contrast,
    },
    forbiddenClaimAllowlist: ALLOWED_EXACT_PHRASES,
    arabicNativeReviewPending: AR_REVIEW_PENDING,
    newCopyRequiringReview: NEW_COPY,
    claimsReferenced: Object.keys(CLAIMS),
    claimRegister: { csvRows: claimRegister.registered, proposedNotYetInCsv: claimRegister.proposed },
    forbiddenPatternsSelfTested: patternsSelfTested,
    requiredResponseHeaders: REQUIRED_RESPONSE_HEADERS,
    notes: [
      'CLM-054 (accessibility conformance) remains NOT_APPROVED_FOR_PUBLIC_CLAIM. Computed token contrast is not rendered-page evidence; real-browser verification is required at PUBLIC-12.',
      'CLM-050/CLM-051 remain COMING_LATER until native Arabic sign-off (OD-12) and real-browser RTL UAT.',
      'Security response headers are a RELEASE-A PREDEPLOY BLOCKER per the owner ruling. This build emits the required set; the host or CDN must serve them.',
    ],
  };

  if (CHECK_ONLY) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'assets'), { recursive: true });

  const css = [
    await readFile(join(ROOT, 'src/styles/tokens.css'), 'utf8'),
    await readFile(join(ROOT, 'src/styles/base.css'), 'utf8'),
    await readFile(join(ROOT, 'src/styles/components.css'), 'utf8'),
  ].join('\n');
  /**
   * Comments are stripped from the SHIPPED bundles.
   *
   * The source files are heavily commented on purpose — the reasoning is the
   * point — but PUBLIC-14 found those comments carrying claim ids, register
   * statuses and internal file paths straight into /assets/pca-public.css and
   * .js, where anyone could read them. Documentation belongs in the repository,
   * not in the artifact. It also trims the payload.
   */
  const stripBlockComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const stripJsComments = (src) =>
    stripBlockComments(src)
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

  await writeFile(join(DIST, 'assets/pca-public.css'), stripBlockComments(css), 'utf8');
  await writeFile(
    join(DIST, 'assets/pca-public.js'),
    stripJsComments(await readFile(join(ROOT, 'src/client/ui.js'), 'utf8')),
    'utf8'
  );
  await writeFile(join(DIST, 'favicon.svg'), await readFile(join(ROOT, 'src/assets/favicon.svg'), 'utf8'), 'utf8');

  /**
   * Untimed caption source, one file per video per locale.
   *
   * Owner ruling section 4 requires captions/subtitles to be preserved for both
   * videos. A .vtt is a list of cue TIMINGS, and there is no recording to time
   * against -- writing one would be fabricating an asset. So the cue TEXT ships
   * instead, generated from the same transcript the page renders, in order.
   * Single source of truth, so the captions cannot drift from the spoken script,
   * and a producer has exactly what they need to cut the real .vtt.
   */
  await mkdir(join(DIST, 'assets/video'), { recursive: true });
  for (const video of Object.values(VIDEOS)) {
    for (const locale of video.captions) {
      const lines = CONTENT[locale][`${video.contentPrefix}.transcript`];
      // No internal identifiers, paths or review-process vocabulary: this file
      // ships to the public deploy root like everything else in dist/.
      const header = [
        `# ${CONTENT[locale][`${video.contentPrefix}.title`]} — caption text (${locale})`,
        '#',
        '# Cue lines in order, untimed. Timings are added when the recording exists.',
        '',
      ].join('\n');
      await writeFile(
        join(DIST, 'assets/video', `${video.id}.${locale}.captions.txt`),
        header + lines.map((line, i) => `${i + 1}. ${line}`).join('\n') + '\n',
        'utf8'
      );
    }
  }

  // Video assets (posters now; recordings and caption files when they land).
  const { readdir } = await import('node:fs/promises');
  await mkdir(join(DIST, 'assets/video'), { recursive: true });
  for (const name of await readdir(join(ROOT, 'src/assets/video'))) {
    await writeFile(join(DIST, 'assets/video', name), await readFile(join(ROOT, 'src/assets/video', name)));
  }

  for (const page of pages) {
    const target = join(DIST, page.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, page.html, 'utf8');
  }

  await writeFile(join(DIST, '404.html'), notFoundPage(), 'utf8');
  await writeFile(join(DIST, 'robots.txt'), robotsTxt(origin), 'utf8');
  await writeFile(join(DIST, 'sitemap.xml'), sitemapXml(origin), 'utf8');
  await mkdir(REPORTS, { recursive: true });
  await writeFile(join(REPORTS, 'build-report.json'), JSON.stringify(report, null, 2), 'utf8');

  await assertNoInternalVocabularyInArtifact();
  if (failures.length) {
    console.error('\nBUILD FAILED — %d artifact gate failure(s):\n', failures.length);
    for (const f of failures) console.error('  ' + f);
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log('PCA Public build OK');
  console.log(`  origin              ${origin}`);
  console.log(`  content keys        EN ${parity.enKeys} / AR ${parity.arKeys} (exact parity)`);
  console.log(`  contrast pairs      ${contrast.length} checked, min ${report.contrast.minRatio}:1, all pass`);
  console.log(`  pages emitted       ${pages.length} (${implemented.length} route(s) x ${LOCALES.length} locales)`);
  console.log(`  primary public      ${mainIds.length} (${mainIds.join(', ')})`);
  console.log(`  utility routes      ${utilityIds.length} (${utilityIds.join(', ')})`);
  console.log(`  home reading size   ${homeWords} EN words (ceiling ${HOME_MAX_WORDS})`);
  console.log(`  duplicate content   ${duplicates.length} finding(s)`);
  console.log(`  internal metadata   0 in HTML attributes, 0 governance vocabulary across every shipped file`);
  console.log(`  claim register      ${claimRegister.registered} rows (${claimRegister.inherited} inherited from frozen v0.2), ${claimRegister.proposed} proposed`);
  console.log(`  pattern self-test   ${patternsSelfTested} forbidden pattern(s) proven against the register's own prohibited text`);
  console.log(`  videos              ${Object.values(VIDEOS).map((v) => `${v.id}:${v.available ? 'available' : 'placeholder'}`).join(', ')}`);
  console.log(`  routes pending      ${pending.length ? pending.join(', ') : 'none'}`);
  console.log(`  AR native review    ${AR_REVIEW_PENDING.length} key(s) = the whole Arabic corpus, pending OD-12 sign-off`);
  console.log(`  claim-scan exempt   ${ALLOWED_EXACT_PHRASES.length} approved phrase(s):`);
  for (const e of ALLOWED_EXACT_PHRASES) {
    console.log(`                        ${e.contentKey} [${e.locale}] vs ${e.pattern}`);
  }
  console.log(`  new copy to review  ${NEW_COPY.length} key(s)`);
}

main().catch((err) => {
  console.error('BUILD ERROR:', err.message);
  process.exitCode = 1;
});
