/**
 * ARABIC REVIEW INTAKE VALIDATOR
 *
 * Validates the independent reviewer's returned package against the CURRENT
 * source before one character of it is trusted.
 *
 * The reviewer package is REVIEW INPUT, not source code. It arrived as four
 * files produced outside this repository, and the failure mode that matters is
 * not a bad translation -- it is a STALE one. A correction proposed against an
 * English sentence that has since changed, or against an Arabic string that no
 * longer exists, would be applied on top of different content and silently
 * change meaning. So every row is re-anchored to the live corpus:
 *
 *   - the KEY still exists;
 *   - ENGLISH_SOURCE matches the current English EXACTLY;
 *   - CURRENT_ARABIC matches the current Arabic EXACTLY;
 *   - ROUTE and CLAIM_ID/CLAIM_STATUS match what the corpus says today.
 *
 * Any mismatch is a stale row and is reported, never adapted. Silently
 * reconciling a stale row is how a reviewer's judgement about one sentence gets
 * applied to a different one.
 *
 * It also checks the package's internal consistency: the corrections file must
 * be exactly the non-PASS rows of the 189-row file, no more and no fewer. A
 * corrections file that omits a non-PASS row hides a finding; one that adds a
 * row smuggles in an unreviewed change.
 *
 * Usage:  node scripts/arabic-review-intake.mjs
 * Writes: reports/arabic-review-intake.json  (outside the deploy root)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const REPORTS = join(REPO, 'docs/public/reports');
const PACKAGE = join(REPORTS, 'PCA_Release_A_Arabic_Native_Review_Package');

const PACK = join(REPORTS, 'RELEASE_A_ARABIC_REVIEW_PACK.csv');
const ALL_189 = join(PACKAGE, 'PCA_ARABIC_NATIVE_REVIEW_ALL_189.csv');
const CORRECTIONS = join(PACKAGE, 'PCA_ARABIC_NATIVE_CORRECTIONS.csv');
const SIGNOFF = join(PACKAGE, 'OWNER_ARABIC_SIGNOFF_SHEET.csv');

/** Counts the reviewer reported in their own report, checked rather than assumed. */
const REVIEWER_CLAIMED = {
  TOTAL_ARABIC_KEYS: 189,
  PASS: 127,
  REVISE_LOW: 31,
  REVISE_MEDIUM: 21,
  REVISE_HIGH: 5,
  LEGAL_REVIEW_REQUIRED: 5,
  OWNER_DECISION_REQUIRED: 0,
};

const problems = [];
const notes = [];
const fail = (check, message) => problems.push(`[${check}] ${message}`);

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

function asObjects(rows) {
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Line endings and trailing whitespace are not a reviewer's meaning. */
const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim();

// ---------------------------------------------------------------------------

const pack = asObjects(parseCsv(await readFile(PACK, 'utf8')));
const all189 = asObjects(parseCsv(await readFile(ALL_189, 'utf8')));
const corrections = asObjects(parseCsv(await readFile(CORRECTIONS, 'utf8')));
const signoff = asObjects(parseCsv(await readFile(SIGNOFF, 'utf8')));

const packByKey = new Map(pack.map((r) => [r.KEY, r]));

// --- 1. shape of the 189-row file ------------------------------------------
const keys = all189.map((r) => r.KEY);
const uniqueKeys = new Set(keys);
if (all189.length !== 189) fail('row-count', `ALL_189 has ${all189.length} rows, expected 189.`);
if (uniqueKeys.size !== all189.length) {
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  fail('duplicate', `ALL_189 repeats ${[...new Set(dupes)].length} key(s): ${[...new Set(dupes)].slice(0, 5).join(', ')}`);
}
for (const key of packByKey.keys()) {
  if (!uniqueKeys.has(key)) fail('missing', `ALL_189 does not review "${key}", which the corpus contains.`);
}
for (const key of uniqueKeys) {
  if (!packByKey.has(key)) fail('unknown-key', `ALL_189 reviews "${key}", which the corpus does not contain.`);
}

// --- 2. decisions match what the reviewer reported --------------------------
const decisions = {};
for (const r of all189) decisions[r.REVIEW_DECISION] = (decisions[r.REVIEW_DECISION] ?? 0) + 1;
for (const [name, expected] of Object.entries(REVIEWER_CLAIMED)) {
  if (name === 'TOTAL_ARABIC_KEYS') continue;
  const actual = decisions[name] ?? 0;
  if (actual !== expected) {
    fail('decision-count', `the report claims ${name} = ${expected} but ALL_189 contains ${actual}.`);
  }
}

// --- 3. corrections file is EXACTLY the non-PASS rows -----------------------
const nonPass = all189.filter((r) => r.REVIEW_DECISION !== 'PASS');
const correctionKeys = new Set(corrections.map((r) => r.KEY));
if (corrections.length !== nonPass.length) {
  fail('corrections-count', `CORRECTIONS has ${corrections.length} rows but ALL_189 has ${nonPass.length} non-PASS rows.`);
}
for (const r of nonPass) {
  if (!correctionKeys.has(r.KEY)) fail('corrections-missing', `"${r.KEY}" is ${r.REVIEW_DECISION} in ALL_189 but absent from CORRECTIONS.`);
}
for (const r of corrections) {
  const source = all189.find((x) => x.KEY === r.KEY);
  if (!source) { fail('corrections-extra', `CORRECTIONS contains "${r.KEY}", which ALL_189 does not.`); continue; }
  if (source.REVIEW_DECISION === 'PASS') fail('corrections-extra', `"${r.KEY}" is PASS in ALL_189 but appears in CORRECTIONS.`);
  if (norm(source.REVIEW_DECISION) !== norm(r.DECISION)) {
    fail('corrections-disagree', `"${r.KEY}": ALL_189 says ${source.REVIEW_DECISION}, CORRECTIONS says ${r.DECISION}.`);
  }
  if (norm(source.PROPOSED_ARABIC) !== norm(r.PROPOSED_ARABIC)) {
    fail('corrections-disagree', `"${r.KEY}": the proposed Arabic differs between ALL_189 and CORRECTIONS.`);
  }
}

// --- 4. STALENESS: re-anchor every row to the live corpus -------------------
const stale = [];
for (const r of all189) {
  const live = packByKey.get(r.KEY);
  if (!live) continue;
  const mismatches = [];
  if (norm(r.ENGLISH_SOURCE) !== norm(live.ENGLISH_SOURCE)) mismatches.push('ENGLISH_SOURCE');
  if (norm(r.CURRENT_ARABIC) !== norm(live.CURRENT_ARABIC)) mismatches.push('CURRENT_ARABIC');
  if (norm(r.ROUTE) !== norm(live.ROUTE)) mismatches.push('ROUTE');
  if (norm(r.CLAIM_ID) !== norm(live.CLAIM_ID)) mismatches.push('CLAIM_ID');
  if (norm(r.CLAIM_STATUS) !== norm(live.CLAIM_STATUS)) mismatches.push('CLAIM_STATUS');
  if (mismatches.length) {
    stale.push({ key: r.KEY, fields: mismatches });
    fail('stale', `"${r.KEY}" was reviewed against different ${mismatches.join(' + ')} than the corpus holds today.`);
  }
}

// --- 5. every non-PASS row must actually propose something ------------------
for (const r of nonPass) {
  if (!norm(r.PROPOSED_ARABIC)) {
    // LEGAL_REVIEW_REQUIRED is a referral, not necessarily a rewrite.
    if (r.REVIEW_DECISION === 'LEGAL_REVIEW_REQUIRED') {
      notes.push(`"${r.KEY}" is referred for legal review with no proposed rewrite.`);
    } else {
      fail('empty-proposal', `"${r.KEY}" is ${r.REVIEW_DECISION} but proposes no Arabic.`);
    }
  } else if (norm(r.PROPOSED_ARABIC) === norm(r.CURRENT_ARABIC)) {
    fail('null-proposal', `"${r.KEY}" is ${r.REVIEW_DECISION} but the proposal is identical to the current Arabic.`);
  }
}

// --- 6. the legal boundary --------------------------------------------------
const legalFlagged = all189.filter(
  (r) => norm(r.LEGAL_REVIEW_REQUIRED).toUpperCase() === 'YES' || r.REVIEW_DECISION === 'LEGAL_REVIEW_REQUIRED'
);
const legalNonPass = legalFlagged.filter((r) => r.REVIEW_DECISION !== 'PASS');

// Cross-check the reviewer's legal flag against OUR OWN classification. A row we
// classified as legal-sensitive must not lose that flag on the way back.
const ourLegal = new Set(pack.filter((r) => r.LEGAL_REVIEW_REQUIRED === 'YES').map((r) => r.KEY));
for (const r of all189) {
  const theirs = norm(r.LEGAL_REVIEW_REQUIRED).toUpperCase() === 'YES';
  if (ourLegal.has(r.KEY) && !theirs) {
    fail('legal-flag-lost', `"${r.KEY}" is LEGAL_REVIEW_REQUIRED in our pack but not in the returned review.`);
  }
}

// --- report -----------------------------------------------------------------
const byDecision = (d) => nonPass.filter((r) => r.REVIEW_DECISION === d);
const legalDeferred = nonPass.filter(
  (r) => ourLegal.has(r.KEY) || norm(r.LEGAL_REVIEW_REQUIRED).toUpperCase() === 'YES' || r.REVIEW_DECISION === 'LEGAL_REVIEW_REQUIRED'
);
const applicable = nonPass.filter((r) => !legalDeferred.includes(r));

const intake = {
  generatedFrom: 'public-web/scripts/arabic-review-intake.mjs',
  reviewerPackage: 'docs/public/reports/PCA_Release_A_Arabic_Native_Review_Package/',
  reviewedRows: all189.length,
  uniqueKeys: uniqueKeys.size,
  decisions,
  correctionRows: corrections.length,
  signoffRows: signoff.length,
  staleRows: stale.length,
  stale,
  legalDeferred: legalDeferred.map((r) => ({ key: r.KEY, decision: r.REVIEW_DECISION, route: r.ROUTE })),
  applicable: applicable.map((r) => ({
    key: r.KEY,
    decision: r.REVIEW_DECISION,
    severity: r.SEVERITY ?? '',
    route: r.ROUTE,
    claimId: r.CLAIM_ID,
    claimStatus: r.CLAIM_STATUS,
    category: r.CONTENT_CATEGORY,
    english: r.ENGLISH_SOURCE,
    currentArabic: r.CURRENT_ARABIC,
    proposedArabic: r.PROPOSED_ARABIC,
    note: r.REVIEWER_NOTE,
  })),
  notes,
};

await mkdir(join(ROOT, 'reports'), { recursive: true });
await writeFile(join(ROOT, 'reports/arabic-review-intake.json'), JSON.stringify(intake, null, 2), 'utf8');

console.log('ARABIC REVIEW INTAKE');
console.log(`  ARABIC_REVIEW_ROWS                 ${all189.length}`);
console.log(`  unique keys                        ${uniqueKeys.size}`);
console.log(`  PASS                               ${decisions.PASS ?? 0}`);
console.log(`  REVISE_LOW                         ${decisions.REVISE_LOW ?? 0}`);
console.log(`  REVISE_MEDIUM                      ${decisions.REVISE_MEDIUM ?? 0}`);
console.log(`  REVISE_HIGH                        ${decisions.REVISE_HIGH ?? 0}`);
console.log(`  LEGAL_REVIEW_REQUIRED (decision)   ${decisions.LEGAL_REVIEW_REQUIRED ?? 0}`);
console.log(`  REVIEWER_CORRECTIONS               ${corrections.length}`);
console.log(`  owner signoff sheet rows           ${signoff.length}`);
console.log(`  ARABIC_REVIEW_PACKAGE_STALE_ROWS   ${stale.length}`);
console.log(`  legal-flagged non-PASS (defer)     ${legalDeferred.length}`);
console.log(`  non-legal, eligible for review     ${applicable.length}`);
for (const n of notes) console.log(`  note: ${n}`);

if (problems.length) {
  console.error(`\nINTAKE FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('');
  process.exitCode = 1;
} else {
  console.log('\nARABIC_REVIEW_PACKAGE_STALE_ROWS = 0 — every row re-anchored to the current corpus.');
  console.log('Nothing has been applied. Each correction still needs its semantic safety check.');
}
