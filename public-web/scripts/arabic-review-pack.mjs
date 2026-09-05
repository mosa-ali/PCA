/**
 * RELEASE-A ARABIC REVIEW PACK GENERATOR
 *
 * Exports the entire current Arabic public corpus for an independent native
 * reviewer, and refuses to produce a pack it cannot prove is faithful.
 *
 * WHY THIS IS GENERATED, NOT WRITTEN
 * A hand-assembled review list was already found to understate the corpus: the
 * PUBLIC-14 pass caught a curated 22-key list that silently omitted the
 * /ar/privacy/ H1 and lede -- the two highest-risk strings on the site. Deriving
 * the pack from the content modules and from the SAME renderer the build uses
 * makes that class of omission structurally impossible rather than merely
 * forbidden.
 *
 * WHAT IT ASSERTS BEFORE WRITING ANYTHING (any failure aborts, no partial file):
 *   - EN and AR key sets are identical, and every AR key appears exactly once;
 *   - every row resolves to a real route in the route registry;
 *   - every claim id referenced exists in claims.mjs AND in the authoritative
 *     PCA_PUBLIC_CLAIM_REGISTER.csv;
 *   - every EN counterpart exists, is non-empty, and has the same shape as its
 *     Arabic twin (a string is not reviewable against an array);
 *   - re-rendering each page and stripping the internal claim metadata
 *     reproduces the emitted dist/ file BYTE FOR BYTE. That last one is what
 *     proves the pack describes the corpus that actually ships, rather than a
 *     second rendering path that has drifted away from it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not translate, correct, improve, shorten or re-word one character of
 * Arabic. Export and validation only: REVIEW_DECISION ships as PENDING_REVIEW
 * on all rows and PROPOSED_ARABIC ships empty, because a pack that arrives
 * pre-filled with a verdict is not a review.
 *
 * Usage:  node scripts/arabic-review-pack.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPages, CONTENT, CLAIMS } from '../build.mjs';
import { PAGE_CONTENT } from '../src/content/index.mjs';
import { ROUTES, routeById, outputPathFor, LOCALES } from '../src/content/routes.mjs';
import { siteOrigin } from '../src/lib/seo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const DIST = join(ROOT, 'dist');
const REPORTS = join(REPO, 'docs/public/reports');
const REGISTER_CSV = join(REPO, 'docs/public/PCA_PUBLIC_CLAIM_REGISTER.csv');

const PACK_CSV = join(REPORTS, 'RELEASE_A_ARABIC_REVIEW_PACK.csv');
const SIGNOFF_CSV = join(REPORTS, 'RELEASE_A_ARABIC_OWNER_SIGNOFF.csv');

const problems = [];
const fail = (check, message) => problems.push(`[${check}] ${message}`);

/** Refuse to produce a pack that cannot be proven faithful. Writes nothing. */
function abort() {
  console.error(`\nPACK GENERATION FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nNo file was written.\n');
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Page and section attribution
// ---------------------------------------------------------------------------

/**
 * Human page names. Keyed by route id, plus the two ids that are not routes:
 * `global` (header, footer, nav, shared CTA labels) and `video` (the two video
 * scripts, which render inside Home and How PCA Works but own no page).
 */
const PAGE_NAMES = {
  global: 'Site-wide (header, footer, navigation)',
  home: 'Home',
  howItWorks: 'How PCA Works',
  privacy: 'Privacy & Safety',
  contact: 'Contact',
  accessibility: 'Accessibility',
  privacyPolicy: 'Privacy Policy (provisional draft)',
  terms: 'Terms (provisional draft)',
  video: 'Video scripts (rendered on Home and How PCA Works)',
};

/** Where a content-only table is actually rendered, for the ROUTE column. */
const CONTENT_ONLY_ROUTES = {
  video: ['home', 'howItWorks'],
};

/** key -> owning table id, derived from the registry rather than from the key name. */
function ownerOfKey() {
  const owner = new Map();
  for (const [tableId, tables] of Object.entries(PAGE_CONTENT)) {
    for (const key of Object.keys(tables.en)) {
      if (owner.has(key)) fail('duplicate-key', `"${key}" is owned by both ${owner.get(key)} and ${tableId}.`);
      owner.set(key, tableId);
    }
  }
  // Anything left is global chrome.
  for (const key of Object.keys(CONTENT.en)) if (!owner.has(key)) owner.set(key, 'global');
  return owner;
}

/** The Arabic URL the reviewer should open to see the string in context. */
function arabicRoutesFor(tableId) {
  if (tableId === 'global') return ROUTES.filter((r) => r.build).map((r) => arPath(r.id));
  if (CONTENT_ONLY_ROUTES[tableId]) return CONTENT_ONLY_ROUTES[tableId].map(arPath);
  const route = routeById(tableId);
  if (!route) {
    fail('unresolved-route', `content table "${tableId}" does not resolve to a route.`);
    return [];
  }
  return [arPath(tableId)];
}

function arPath(routeId) {
  const out = outputPathFor(routeId, 'ar');
  return '/' + out.replace(/index\.html$/, '');
}

/**
 * SECTION_OR_COMPONENT from the key's own namespace: `privacy.notStored.items`
 * -> `notStored`. Two-segment keys such as `cta.access` are the component
 * itself. This is derivation, not a lookup table that can go stale.
 */
function sectionOf(key, tableId) {
  const parts = key.split('.');
  if (tableId === 'global' || parts.length === 2) return parts[0];
  return parts.slice(1, -1).join('.') || parts[0];
}

// ---------------------------------------------------------------------------
// Claim attribution — two independent sources, both real
// ---------------------------------------------------------------------------

/**
 * Source 1: content items that carry their own claimId (home.protects.items and
 * friends). Authoritative, because that is the id the renderer uses.
 *
 * Source 2: containment in the rendered markup. For every `data-claim="CLM-xxx"`
 * element in the PRE-STRIP Arabic HTML, find the element's extent by matching
 * its tags, then attribute every Arabic string that falls inside it.
 *
 * Source 2 is what catches a heading or lede that sits inside a claim-anchored
 * card without naming the claim in the content table -- exactly the omission
 * that produced the understated review list in PUBLIC-14.
 */
function claimIdsFromContent(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v && typeof v === 'object' && v.claimId).map((v) => v.claimId);
}

/** Extent of the element whose opening tag starts at `tagStart`. */
function elementExtent(html, tagStart) {
  const nameMatch = /^<([a-zA-Z][\w-]*)/.exec(html.slice(tagStart));
  if (!nameMatch) return null;
  const tag = nameMatch[1];
  const openEnd = html.indexOf('>', tagStart);
  if (openEnd === -1) return null;
  if (html[openEnd - 1] === '/') return { start: tagStart, end: openEnd + 1 };

  const scanner = new RegExp(`</?${tag}\\b`, 'gi');
  scanner.lastIndex = openEnd + 1;
  let depth = 1;
  let m;
  while ((m = scanner.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return { start: tagStart, end: html.indexOf('>', m.index) + 1 };
  }
  return null;
}

function claimRegionsIn(html) {
  const regions = [];
  const re = /<[a-zA-Z][^>]*?\sdata-claim="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const extent = elementExtent(html, m.index);
    if (extent) regions.push({ claimId: m[1], text: html.slice(extent.start, extent.end) });
  }
  return regions;
}

/** Flatten a content value into the plain strings a reviewer must read. */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      for (const [field, v] of Object.entries(item)) {
        if (field !== 'claimId' && typeof v === 'string') out.push(v);
      }
    }
  }
  return out;
}

/** Readable serialisation of a content value for a single CSV cell. */
function serialise(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return JSON.stringify(value);
  return value
    .map((item, i) => {
      if (typeof item === 'string') return `[${i + 1}] ${item}`;
      return Object.entries(item)
        .filter(([field]) => field !== 'claimId')
        .map(([field, v]) => `[${i + 1}] ${field}: ${v}`)
        .join('\n');
    })
    .join('\n');
}

function shapeOf(value) {
  if (Array.isArray(value)) {
    const inner = value.length === 0 ? 'empty' : typeof value[0] === 'object' ? 'object' : typeof value[0];
    return `array<${inner}>[${value.length}]`;
  }
  return typeof value;
}

// ---------------------------------------------------------------------------
// Category and risk — derived from concrete signals, documented in the guide
// ---------------------------------------------------------------------------

const LEGAL_ROUTES = new Set(['privacyPolicy', 'terms']);
const PRIVACY_ROUTES = new Set(['privacy']);

function categoryOf(key, tableId) {
  const last = key.split('.').pop();
  if (key.includes('.seo.')) return 'SEO_METADATA';
  if (key.startsWith('status.')) return 'FEATURE_STATUS';
  if (key.startsWith('cta.') || key.includes('.cta')) return 'CTA';
  if (key.startsWith('nav.') || key.startsWith('brand.') || key.startsWith('a11y.')) return 'NAVIGATION_CHROME';
  if (key.startsWith('footer.')) return 'FOOTER_CHROME';
  if (tableId === 'video') return key.includes('transcript') ? 'VIDEO_TRANSCRIPT' : 'VIDEO_SCRIPT';
  if (LEGAL_ROUTES.has(tableId)) return 'LEGAL_TEXT';
  if (PRIVACY_ROUTES.has(tableId)) return 'PRIVACY_ASSERTION';
  if (key.includes('release') || key.includes('availability') || key.includes('notice')) return 'RELEASE_STATE_NOTICE';
  if (last === 'title' || key.endsWith('.heading')) return 'HEADING';
  if (key.includes('faq')) return 'FAQ';
  return 'BODY_COPY';
}

/**
 * RISK_LEVEL answers one question: what happens if the Arabic says something
 * the English does not? Anything that could assert a capability PCA has not
 * shipped, or a privacy guarantee PCA cannot keep, is CRITICAL.
 */
function riskOf({ category, tableId, claimStatuses }) {
  const weakClaim = claimStatuses.some((s) => s !== 'VERIFIED_AVAILABLE');
  if (category === 'PRIVACY_ASSERTION' || category === 'LEGAL_TEXT') return 'CRITICAL';
  if (category === 'FEATURE_STATUS') return 'CRITICAL';
  if (weakClaim) return 'CRITICAL';
  if (category === 'RELEASE_STATE_NOTICE') return 'CRITICAL';
  if (claimStatuses.length) return 'HIGH';
  if (category === 'CTA') return 'HIGH';
  if (category === 'VIDEO_SCRIPT' || category === 'VIDEO_TRANSCRIPT') return 'HIGH';
  if (tableId === 'home' || tableId === 'howItWorks') return 'MEDIUM';
  if (category === 'SEO_METADATA') return 'MEDIUM';
  if (category === 'NAVIGATION_CHROME' || category === 'FOOTER_CHROME') return 'LOW';
  return 'MEDIUM';
}

function legalReviewRequired({ category, tableId }) {
  if (LEGAL_ROUTES.has(tableId)) return 'YES';
  if (category === 'PRIVACY_ASSERTION') return 'YES';
  if (category === 'LEGAL_TEXT') return 'YES';
  return 'NO';
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const COLUMNS = [
  'KEY',
  'ROUTE',
  'PAGE_NAME',
  'SECTION_OR_COMPONENT',
  'ENGLISH_SOURCE',
  'CURRENT_ARABIC',
  'CLAIM_ID',
  'CLAIM_STATUS',
  'CONTENT_CATEGORY',
  'RISK_LEVEL',
  'REVIEW_DECISION',
  'PROPOSED_ARABIC',
  'REVIEWER_NOTE',
  'LEGAL_REVIEW_REQUIRED',
];

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvFrom(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  // BOM: the reviewer opens this in Excel/Sheets, which renders UTF-8 Arabic as
  // mojibake without one. Every parser used here strips it.
  return '﻿' + lines.join('\n') + '\n';
}

/** Minimal RFC4180 reader, for validating what was actually written. */
function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const enKeys = Object.keys(CONTENT.en).sort();
  const arKeys = Object.keys(CONTENT.ar).sort();

  // --- key parity -----------------------------------------------------------
  for (const k of arKeys) if (!(k in CONTENT.en)) fail('parity', `Arabic key "${k}" has no English counterpart.`);
  for (const k of enKeys) if (!(k in CONTENT.ar)) fail('parity', `English key "${k}" has no Arabic counterpart.`);

  const owner = ownerOfKey();

  // --- claim register, for the id cross-check -------------------------------
  const registerRows = parseCsv(await readFile(REGISTER_CSV, 'utf8'));
  const registerHeader = registerRows[0];
  const idCol = registerHeader.findIndex((h) => /claim.?id/i.test(h));
  const registeredIds = new Set(registerRows.slice(1).map((r) => r[idCol]).filter(Boolean));

  /**
   * Keys and claim ids are validated BEFORE rendering.
   *
   * renderPages() throws on a missing content key or an unregistered claim id,
   * and an uncaught throw is a stack trace, not a review finding. Proving this
   * generator by deleting an Arabic key showed exactly that: the pack was
   * correctly not written, but the operator was told only "PACK ERROR" with no
   * indication of which key. Checking first means the failure names the defect.
   */
  for (const [key, value] of Object.entries(CONTENT.ar)) {
    for (const id of claimIdsFromContent(value)) {
      if (!(id in CLAIMS)) fail('unknown-claim', `"${key}" references ${id}, which claims.mjs does not define.`);
      else if (!registeredIds.has(id))
        fail('unknown-claim', `"${key}" references ${id}, which the claim register CSV does not list.`);
    }
  }

  if (problems.length) return abort();

  // --- render, and prove the render is the artifact -------------------------
  let pages;
  try {
    pages = renderPages(siteOrigin());
  } catch (err) {
    fail('render', `the current source does not render: ${err.message}`);
    return abort();
  }
  for (const page of pages) {
    const emitted = await readFile(join(DIST, page.path), 'utf8').catch(() => null);
    if (emitted === null) {
      fail('artifact', `dist/${page.path} is missing. Run "npm run build" before generating the pack.`);
    } else if (emitted !== page.html) {
      fail('artifact', `dist/${page.path} differs from a fresh render. The pack would describe copy that is not shipping.`);
    }
  }

  const arClaimRegions = pages
    .filter((p) => p.locale === 'ar')
    .flatMap((p) => claimRegionsIn(p.htmlWithMetadata));

  // --- rows -----------------------------------------------------------------
  const rows = [];
  const seen = new Set();

  for (const key of arKeys) {
    if (seen.has(key)) { fail('duplicate-row', `"${key}" would appear more than once.`); continue; }
    seen.add(key);

    const tableId = owner.get(key);
    const arValue = CONTENT.ar[key];
    const enValue = CONTENT.en[key];

    if (shapeOf(arValue) !== shapeOf(enValue)) {
      fail('shape', `"${key}": Arabic is ${shapeOf(arValue)} but English is ${shapeOf(enValue)}.`);
    }
    if (stringsIn(enValue).some((s) => !s.trim())) fail('empty', `"${key}" has an empty English string.`);
    if (stringsIn(arValue).some((s) => !s.trim())) fail('empty', `"${key}" has an empty Arabic string.`);

    // Claim attribution: declared ids first, then containment in the markup.
    const claimIds = new Set(claimIdsFromContent(arValue));
    const arStrings = stringsIn(arValue);
    for (const region of arClaimRegions) {
      if (arStrings.some((s) => s.length > 3 && region.text.includes(s))) claimIds.add(region.claimId);
    }

    for (const id of claimIds) {
      if (!(id in CLAIMS)) fail('unknown-claim', `"${key}" references ${id}, which claims.mjs does not define.`);
      else if (!registeredIds.has(id)) fail('unknown-claim', `"${key}" references ${id}, which the claim register CSV does not list.`);
    }

    const claimList = [...claimIds].sort();
    const claimStatuses = claimList.map((id) => CLAIMS[id]?.status).filter(Boolean);
    const routes = arabicRoutesFor(tableId);
    if (!routes.length) fail('unresolved-route', `"${key}" (table ${tableId}) resolves to no route.`);

    const category = categoryOf(key, tableId);
    const risk = riskOf({ category, tableId, claimStatuses });

    rows.push({
      KEY: key,
      ROUTE: routes.join(' '),
      PAGE_NAME: PAGE_NAMES[tableId] ?? tableId,
      SECTION_OR_COMPONENT: sectionOf(key, tableId),
      ENGLISH_SOURCE: serialise(enValue),
      CURRENT_ARABIC: serialise(arValue),
      CLAIM_ID: claimList.length ? claimList.join('; ') : 'NONE',
      CLAIM_STATUS: claimStatuses.length ? claimStatuses.join('; ') : 'NONE',
      CONTENT_CATEGORY: category,
      RISK_LEVEL: risk,
      REVIEW_DECISION: 'PENDING_REVIEW',
      PROPOSED_ARABIC: '',
      REVIEWER_NOTE: '',
      LEGAL_REVIEW_REQUIRED: legalReviewRequired({ category, tableId }),
    });
  }

  if (rows.length !== arKeys.length) fail('row-count', `${rows.length} rows for ${arKeys.length} Arabic keys.`);

  // --- abort before writing anything ----------------------------------------
  if (problems.length) return abort();

  await mkdir(REPORTS, { recursive: true });
  const packCsv = csvFrom(COLUMNS, rows);
  await writeFile(PACK_CSV, packCsv, 'utf8');

  // --- read back what was written and re-validate it -------------------------
  const readBack = parseCsv(await readFile(PACK_CSV, 'utf8'));
  const header = readBack[0];
  const body = readBack.slice(1);
  const keyCol = header.indexOf('KEY');
  const roundTripped = body.map((r) => r[keyCol]);
  const duplicates = roundTripped.filter((k, i) => roundTripped.indexOf(k) !== i);
  const missing = arKeys.filter((k) => !roundTripped.includes(k));

  if (header.join(',') !== COLUMNS.join(',')) fail('readback', 'the written header does not match the required columns.');
  if (body.length !== arKeys.length) fail('readback', `${body.length} rows read back, expected ${arKeys.length}.`);
  if (duplicates.length) fail('readback', `duplicate keys after write: ${duplicates.join(', ')}`);
  if (missing.length) fail('readback', `missing keys after write: ${missing.join(', ')}`);
  for (const r of body) {
    if (r[header.indexOf('REVIEW_DECISION')] !== 'PENDING_REVIEW') fail('readback', `${r[keyCol]} does not ship as PENDING_REVIEW.`);
    if (r[header.indexOf('PROPOSED_ARABIC')] !== '') fail('readback', `${r[keyCol]} ships with a pre-filled correction.`);
    if (r[header.indexOf('CURRENT_ARABIC')].trim() === '') fail('readback', `${r[keyCol]} has no Arabic text.`);
  }

  // --- owner signoff template ------------------------------------------------
  const SIGNOFF_COLUMNS = [
    'KEY',
    'ROUTE',
    'PAGE_NAME',
    'CONTENT_CATEGORY',
    'RISK_LEVEL',
    'CLAIM_ID',
    'CLAIM_STATUS',
    'WHY_OWNER_ATTENTION',
    'CURRENT_ARABIC',
    'ENGLISH_SOURCE',
    'REVIEWER_PROPOSAL',
    'OWNER_DECISION',
    'OWNER_NOTE',
  ];
  const OWNER_ATTENTION = {
    PRIVACY_ASSERTION: 'Privacy assertion — Arabic must not promise more than the English hedge.',
    LEGAL_TEXT: 'Legal text — blocked behind OD-13 legal identity; wording is owner/legal territory.',
    FEATURE_STATUS: 'Feature status label — governs what the site claims is available today.',
    RELEASE_STATE_NOTICE: 'Release-state notice — the honest "not live yet" wording.',
    CTA: 'Call to action — sets the expectation of what happens next.',
  };
  const signoffRows = rows
    .filter(
      (r) =>
        OWNER_ATTENTION[r.CONTENT_CATEGORY] ||
        ((r.RISK_LEVEL === 'CRITICAL' || r.RISK_LEVEL === 'HIGH') && r.CLAIM_ID !== 'NONE')
    )
    .map((r) => ({
      KEY: r.KEY,
      ROUTE: r.ROUTE,
      PAGE_NAME: r.PAGE_NAME,
      CONTENT_CATEGORY: r.CONTENT_CATEGORY,
      RISK_LEVEL: r.RISK_LEVEL,
      CLAIM_ID: r.CLAIM_ID,
      CLAIM_STATUS: r.CLAIM_STATUS,
      WHY_OWNER_ATTENTION:
        OWNER_ATTENTION[r.CONTENT_CATEGORY] ??
        `Claim-bearing ${r.RISK_LEVEL} string — a stronger Arabic phrasing would overstate ${r.CLAIM_ID}.`,
      CURRENT_ARABIC: r.CURRENT_ARABIC,
      ENGLISH_SOURCE: r.ENGLISH_SOURCE,
      REVIEWER_PROPOSAL: '',
      OWNER_DECISION: 'PENDING',
      OWNER_NOTE: '',
    }));

  await writeFile(SIGNOFF_CSV, csvFrom(SIGNOFF_COLUMNS, signoffRows), 'utf8');

  if (problems.length) {
    console.error(`\nPACK VALIDATION FAILED AFTER WRITE — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error('  ' + p);
    process.exitCode = 1;
    return;
  }

  // --- summary ---------------------------------------------------------------
  const byRisk = {};
  const byCategory = {};
  for (const r of rows) {
    byRisk[r.RISK_LEVEL] = (byRisk[r.RISK_LEVEL] ?? 0) + 1;
    byCategory[r.CONTENT_CATEGORY] = (byCategory[r.CONTENT_CATEGORY] ?? 0) + 1;
  }
  const claimed = rows.filter((r) => r.CLAIM_ID !== 'NONE').length;
  const legal = rows.filter((r) => r.LEGAL_REVIEW_REQUIRED === 'YES').length;
  const strings = rows.reduce((n, r) => n + stringsIn(CONTENT.ar[r.KEY]).length, 0);

  console.log('ARABIC REVIEW PACK OK');
  console.log(`  TOTAL_EN_KEYS                     ${enKeys.length}`);
  console.log(`  TOTAL_AR_KEYS                     ${arKeys.length}`);
  console.log(`  ARABIC_REVIEW_PACK_ROWS           ${body.length}`);
  console.log(`  reviewable Arabic strings         ${strings} (rows expand into sub-items)`);
  console.log(`  ARABIC_REVIEW_PACK_DUPLICATES     ${duplicates.length}`);
  console.log(`  ARABIC_REVIEW_PACK_MISSING_KEYS   ${missing.length}`);
  console.log(`  ARABIC_REVIEW_PACK_UNKNOWN_CLAIMS 0`);
  console.log(`  ARABIC_REVIEW_PACK_UNRESOLVED_ROUTES 0`);
  console.log(`  rows carrying a claim id          ${claimed}`);
  console.log(`  rows needing legal review         ${legal}`);
  console.log(`  owner signoff template rows       ${signoffRows.length}`);
  console.log(`  risk        ${Object.entries(byRisk).sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  category    ${Object.entries(byCategory).sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  artifact    ${pages.length} page(s) re-rendered and matched byte-for-byte against dist/`);
  console.log(`  decisions   all ${body.length} rows PENDING_REVIEW, 0 pre-filled corrections`);
}

main().catch((err) => {
  console.error('PACK ERROR:', err.stack || err.message);
  process.exitCode = 1;
});
