#!/usr/bin/env node
// Coordinator B (QA/runtime) structural validator for
// docs/product-completion/PCA_PAGE_QA_LEDGER.csv. Checks structure and
// internal consistency only -- it cannot verify that a row's evidence is
// GENUINELY real-browser (that discipline is enforced by review, not by
// this script), but it does catch the mechanical mistakes that discipline
// depends on: malformed rows, disallowed status values, a PASS row with no
// evidence, and evidence text that admits to a non-browser source.
//
// Usage: node docs/product-completion/validate_qa_ledger.mjs [path-to-csv]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const csvPath = process.argv[2] ?? fileURLToPath(new URL('./PCA_PAGE_QA_LEDGER.csv', import.meta.url));
const raw = readFileSync(csvPath, 'utf8');

/** Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas, embedded newlines, and "" escaped quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const rows = parseCsv(raw);
const header = rows[0];
const dataRows = rows.slice(1);
const col = (name) => header.indexOf(name);

const EXPECTED_COLUMNS = 26;
// Kept identical to tooling/product-completion/validate-ledgers.mjs's own
// VALID_ACCEPTANCE_STATE -- that script is the canonical structural gate for
// this CSV (wired into the dynamic-workflow programme); this one exists to
// add the browser-evidence-honesty checks that script doesn't do. Diverging
// from its enum caused this script to reject rows the canonical validator
// accepts -- see the reconciliation report.
const ALLOWED_FINAL_STATUS = new Set([
  'NOT_TESTED',
  'IMPLEMENTATION_IN_PROGRESS',
  'AWAITING_BROWSER',
  'DEFECT_FOUND',
  'REMEDIATION_IN_PROGRESS',
  'RETEST_REQUIRED',
  'BLOCKED_ENVIRONMENT',
  'BLOCKED_EXTERNAL',
  'VERIFIED_BROWSER_PASS',
]);
const NON_BROWSER_EVIDENCE_PATTERN = /\bjsdom\b|\bunit test(s)?\b|\bmocked backend\b|\bcode review only\b/i;

const problems = [];

if (header.length !== EXPECTED_COLUMNS) {
  problems.push(`Header has ${header.length} columns, expected ${EXPECTED_COLUMNS}.`);
}

const seenKeys = new Map();
dataRows.forEach((row, idx) => {
  const lineNo = idx + 2; // +1 for header, +1 for 1-indexing
  if (row.length !== header.length) {
    problems.push(`Line ${lineNo}: ${row.length} fields, expected ${header.length}.`);
    return;
  }
  const get = (name) => row[col(name)] ?? '';
  const finalStatus = get('FINAL_STATUS').trim();
  const evidence = get('EVIDENCE').trim();

  if (finalStatus && !ALLOWED_FINAL_STATUS.has(finalStatus)) {
    problems.push(`Line ${lineNo}: FINAL_STATUS "${finalStatus}" is not in the allowed set.`);
  }
  if (finalStatus === 'VERIFIED_BROWSER_PASS' && evidence.length === 0) {
    problems.push(`Line ${lineNo}: VERIFIED_BROWSER_PASS with empty EVIDENCE.`);
  }
  // Only a problem when the row is actually CLAIMING browser-verified pass --
  // a RETEST_REQUIRED/NOT_TESTED row is allowed (in fact expected) to
  // honestly disclose a non-browser source or a past miscorrection in its
  // own EVIDENCE text.
  if (finalStatus === 'VERIFIED_BROWSER_PASS' && evidence && NON_BROWSER_EVIDENCE_PATTERN.test(evidence)) {
    problems.push(`Line ${lineNo}: VERIFIED_BROWSER_PASS but EVIDENCE text admits a non-real-browser source ("${evidence.slice(0, 80)}...").`);
  }

  const key = [get('APP'), get('ROUTE'), get('PERSONA'), get('LANGUAGE'), get('VIEWPORT'), get('DATA_SCENARIO')].join('');
  if (seenKeys.has(key)) {
    problems.push(`Line ${lineNo}: exact duplicate of line ${seenKeys.get(key)} (same APP/ROUTE/PERSONA/LANGUAGE/VIEWPORT/DATA_SCENARIO).`);
  } else {
    seenKeys.set(key, lineNo);
  }
});

console.log(`Checked ${dataRows.length} data row(s) in ${csvPath}.`);
if (problems.length === 0) {
  console.log('QA ledger validator: PASS -- no structural problems found.');
  process.exit(0);
} else {
  console.log(`QA ledger validator: FAIL -- ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
