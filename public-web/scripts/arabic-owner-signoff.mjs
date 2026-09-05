/**
 * FINAL OWNER ARABIC SIGN-OFF SHEET
 *
 * Builds the sheet the owner signs OD-12 against, showing for every selected
 * row what the Arabic said before the independent review, what it says now, and
 * why the row needs the owner's own decision.
 *
 * ORIGINAL_ARABIC comes from the reviewer's own 189-row export, which is the
 * authoritative snapshot of the corpus as reviewed. FINAL_PROPOSED_ARABIC is
 * read live from the current source. So the two columns are independently
 * sourced: if remediation had gone wrong, the sheet would show it rather than
 * hide it behind a single value quoted twice.
 *
 * Row selection is the union of four sets, and each row says which it came from:
 *   - the reviewer's own owner-attention selection;
 *   - every correction deferred to legal review;
 *   - every reviewer proposal that was rejected, with its reason;
 *   - every applied correction that touches a claim or a feature status.
 * Nothing is marked approved. OWNER_DECISION ships as PENDING on every row,
 * because a sign-off sheet that arrives pre-signed is not a sign-off.
 *
 * Usage:  node scripts/arabic-owner-signoff.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT } from '../src/content/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '..');
const REPORTS = join(REPO, 'docs/public/reports');
const PACKAGE = join(REPORTS, 'PCA_Release_A_Arabic_Native_Review_Package');
const OUT = join(REPORTS, 'RELEASE_A_ARABIC_OWNER_SIGNOFF.csv');

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

const asObjects = (rows) => {
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
};

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Mirrors serialise() in arabic-review-pack.mjs. */
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

// ---------------------------------------------------------------------------

const reviewed = asObjects(parseCsv(await readFile(join(PACKAGE, 'PCA_ARABIC_NATIVE_REVIEW_ALL_189.csv'), 'utf8')));
const reviewerSelection = asObjects(parseCsv(await readFile(join(PACKAGE, 'OWNER_ARABIC_SIGNOFF_SHEET.csv'), 'utf8')));
const ledger = JSON.parse(await readFile(join(ROOT, 'reports/arabic-corrections-ledger.json'), 'utf8'));

const reviewedByKey = new Map(reviewed.map((r) => [r.KEY, r]));
const appliedByKey = new Map(ledger.applied.map((a) => [a.key, a]));
const rejectedByKey = new Map(ledger.rejected.map((a) => [a.key, a]));
const deferredByKey = new Map(ledger.deferredLegal.map((d) => [d.key, d]));

const selected = new Map();
const select = (key, reason) => {
  if (!reviewedByKey.has(key)) throw new Error(`selected key "${key}" is not in the reviewed export`);
  if (!selected.has(key)) selected.set(key, []);
  selected.get(key).push(reason);
};

for (const r of reviewerSelection) {
  select(r.KEY, `Reviewer selected this row for owner attention${r.SIGNOFF_REASON ? ': ' + r.SIGNOFF_REASON : '.'}`);
}
for (const [key, d] of deferredByKey) {
  const proposal = reviewedByKey.get(key).PROPOSED_ARABIC;
  select(
    key,
    `DEFERRED TO LEGAL (${d.decision}). Not applied: this row is legal-sensitive and is blocked behind OD-13. ` +
      (proposal ? `Reviewer proposes: ${proposal}` : 'Reviewer referred it for legal review without proposing a rewrite.')
  );
}
for (const [key, r] of rejectedByKey) {
  select(key, `REJECTED (${r.decision}). ${r.rejectedReason} Reviewer proposal, for the record: ${r.reviewerProposal}`);
}
for (const [key, a] of appliedByKey) {
  if (a.claimId && a.claimId !== 'NONE') {
    select(key, `APPLIED and claim-bearing (${a.claimId}). ${a.note}`);
  }
}

const COLUMNS = [
  'KEY',
  'ROUTE',
  'PAGE_NAME',
  'ENGLISH_SOURCE',
  'ORIGINAL_ARABIC',
  'FINAL_PROPOSED_ARABIC',
  'CHANGED',
  'REVIEWER_DECISION',
  'CLAIM_ID',
  'CLAIM_STATUS',
  'REMEDIATION_DISPOSITION',
  'WHY_IN_SIGNOFF',
  'LEGAL_REVIEW_REQUIRED',
  'OWNER_DECISION',
  'OWNER_NOTE',
];

const problems = [];
const rows = [];

for (const [key, reasons] of [...selected].sort((a, b) => a[0].localeCompare(b[0]))) {
  const r = reviewedByKey.get(key);
  const before = r.CURRENT_ARABIC;
  const after = serialise(CONTENT.ar[key]);

  const status = appliedByKey.has(key)
    ? 'APPLIED'
    : rejectedByKey.has(key)
      ? 'REJECTED_PROPOSAL_CURRENT_ARABIC_RETAINED'
      : deferredByKey.has(key)
        ? 'DEFERRED_LEGAL'
        : 'UNCHANGED';

  // Cross-check the ledger against the live corpus, per row.
  if (status === 'APPLIED' && before === after) {
    problems.push(`"${key}" is recorded as APPLIED but the Arabic is unchanged.`);
  }
  if (status !== 'APPLIED' && before !== after) {
    problems.push(`"${key}" is ${status} but the Arabic changed anyway.`);
  }

  rows.push({
    KEY: key,
    ROUTE: r.ROUTE,
    PAGE_NAME: r.PAGE_NAME,
    ENGLISH_SOURCE: r.ENGLISH_SOURCE,
    ORIGINAL_ARABIC: before,
    FINAL_PROPOSED_ARABIC: after,
    CHANGED: before === after ? 'NO' : 'YES',
    REVIEWER_DECISION: r.REVIEW_DECISION,
    CLAIM_ID: r.CLAIM_ID,
    CLAIM_STATUS: r.CLAIM_STATUS,
    REMEDIATION_DISPOSITION: status,
    WHY_IN_SIGNOFF: reasons.join(' | '),
    LEGAL_REVIEW_REQUIRED: r.LEGAL_REVIEW_REQUIRED,
    OWNER_DECISION: 'PENDING',
    OWNER_NOTE: '',
  });
}

if (problems.length) {
  console.error(`\nSIGN-OFF SHEET FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nNo file was written.\n');
  process.exitCode = 1;
} else {
  const body =
    '﻿' + [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => csvCell(row[c])).join(','))].join('\n') + '\n';
  await writeFile(OUT, body, 'utf8');

  const byStatus = {};
  for (const r of rows) byStatus[r.REMEDIATION_DISPOSITION] = (byStatus[r.REMEDIATION_DISPOSITION] ?? 0) + 1;

  console.log('OWNER ARABIC SIGN-OFF SHEET');
  console.log(`  rows                       ${rows.length}`);
  console.log(`  changed by remediation     ${rows.filter((r) => r.CHANGED === 'YES').length}`);
  for (const [s, n] of Object.entries(byStatus).sort()) console.log(`  ${s.padEnd(42)} ${n}`);
  console.log(`  OWNER_DECISION = PENDING   ${rows.filter((r) => r.OWNER_DECISION === 'PENDING').length}/${rows.length}`);
  console.log(`\nwritten: docs/public/reports/RELEASE_A_ARABIC_OWNER_SIGNOFF.csv`);
  console.log('OD_12 = AWAITING_OWNER_SIGNOFF — nothing in this sheet is approved.');
}
