/**
 * Regression tests for scripts/arabic-owner-signoff.mjs (OD-12 owner sheet).
 *
 * The defect these cover: the generator read CONTENT.ar[key] blindly, so a
 * reviewed key DELETED from the corpus since the review (the four-page IA
 * rebalance e7f1206 landed after the review package 87f1f83 and removed six
 * selected rows) was misread in two opposite ways at once --
 *
 *   - an UNCHANGED/REJECTED row was accused of having "changed anyway", and
 *     because ANY problem aborts the run, the OD-12 sheet could not be
 *     produced at all; and
 *   - an APPLIED row passed the cross-check vacuously and would have written
 *     the literal string "undefined" into FINAL_PROPOSED_ARABIC, presenting it
 *     to the owner as the remediated Arabic they are signing off.
 *
 * These tests run the REAL script as a child process against the REAL corpus
 * and ledger -- no reimplementation of its logic, which would only re-assert
 * the bug. Every fixture mutation is restored byte-identical and verified.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/arabic-owner-signoff.mjs');
const SHEET = join(ROOT, '../docs/public/reports/RELEASE_A_ARABIC_OWNER_SIGNOFF.csv');
const GLOBAL_AR = join(ROOT, 'src/content/global.ar.mjs');

/** The six reviewer-selected keys the IA rebalance deleted from both locales. */
const REMOVED_KEYS = [
  'home.affordability.body',
  'home.availability.items',
  'home.availability.label',
  'home.availability.title',
  'home.faq.items',
  'home.faq.title',
];

/** Selected, still-shipping, ledger-disposition UNCHANGED -- the drift control. */
const CONTROL_KEY = 'cta.childSafety';

function runSignoff() {
  try {
    return { ok: true, out: execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

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

/**
 * Regenerate the sheet and read it back.
 *
 * The regeneration MUST be asserted here rather than left implicit: a failing
 * run writes nothing, so a test that merely read the sheet off disk would
 * happily assert against whatever a previous successful run left behind and
 * report green while the generator was broken. Reading is only meaningful
 * once this run produced the file.
 */
function regenerateAndReadSheet() {
  const { ok, out } = runSignoff();
  assert.ok(ok, `generator failed, so the sheet on disk is stale and proves nothing:\n${out}`);
  const rows = parseCsv(readFileSync(SHEET, 'utf8'));
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

let pristineSheet;
let pristineGlobalAr;

before(() => {
  pristineSheet = readFileSync(SHEET);
  pristineGlobalAr = readFileSync(GLOBAL_AR);
});

after(() => {
  writeFileSync(SHEET, pristineSheet);
  writeFileSync(GLOBAL_AR, pristineGlobalAr);
});

test('the OD-12 sheet is producible at all (the removed keys no longer abort the run)', () => {
  const { ok, out } = runSignoff();
  assert.ok(ok, `generator failed; it must succeed on the real corpus:\n${out}`);
  assert.match(out, /OD_12 = AWAITING_OWNER_SIGNOFF/);
});

test('every key deleted from the corpus is reported as REMOVED_FROM_CORPUS, not as drift', () => {
  const byKey = new Map(regenerateAndReadSheet().map((r) => [r.KEY, r]));
  for (const key of REMOVED_KEYS) {
    const row = byKey.get(key);
    assert.ok(row, `${key} must still appear in the sheet -- silently dropping it hides a row the owner was asked to decide on`);
    assert.equal(row.REMEDIATION_DISPOSITION, 'REMOVED_FROM_CORPUS', `${key} disposition`);
    assert.equal(row.CHANGED, 'REMOVED', `${key} CHANGED column`);
    assert.equal(row.FINAL_PROPOSED_ARABIC, '', `${key} must have no final Arabic -- it ships nowhere`);
    assert.match(row.WHY_IN_SIGNOFF, /REMOVED FROM THE SITE/, `${key} must tell the owner why it is here`);
  }
});

test('no cell anywhere renders the literal string "undefined" to the owner', () => {
  for (const row of regenerateAndReadSheet()) {
    for (const [column, value] of Object.entries(row)) {
      assert.notEqual(value, 'undefined', `${row.KEY}.${column} leaked a JS undefined into the owner sheet`);
    }
  }
});

test('nothing in the sheet arrives pre-approved', () => {
  const rows = regenerateAndReadSheet();
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.OWNER_DECISION, 'PENDING', `${row.KEY} must not be pre-signed`);
});

test('NEGATIVE CONTROL: a still-shipping key whose Arabic drifts still fails the run', () => {
  const original = readFileSync(GLOBAL_AR, 'utf8');
  assert.ok(original.includes(`"${CONTROL_KEY}"`), `fixture is stale: ${CONTROL_KEY} is no longer in global.ar.mjs`);

  const mutated = original.replace(
    new RegExp(`("${CONTROL_KEY}":\\s*")([^"]*)(")`),
    (_m, a, value, c) => `${a}${value}ـ${c}`,
  );
  assert.notEqual(mutated, original, 'fixture sanity: the mutation must actually change the file');
  writeFileSync(GLOBAL_AR, mutated);

  try {
    const { ok, out } = runSignoff();
    assert.equal(ok, false, 'drift on a still-shipping key must still abort the run -- the removal exemption must not swallow real drift');
    assert.match(out, /SIGN-OFF SHEET FAILED/);
    assert.match(out, new RegExp(`"${CONTROL_KEY}" is UNCHANGED but the Arabic changed anyway`));
    assert.match(out, /No file was written/);
  } finally {
    writeFileSync(GLOBAL_AR, original);
  }

  assert.equal(readFileSync(GLOBAL_AR, 'utf8'), original, 'global.ar.mjs must be restored byte-identical');
});

test('the real sheet is regenerated cleanly after the negative control', () => {
  const { ok } = runSignoff();
  assert.ok(ok, 'the generator must pass again once the fixture is restored');
  const byKey = new Map(regenerateAndReadSheet().map((r) => [r.KEY, r]));
  assert.equal(byKey.get(CONTROL_KEY).CHANGED, 'NO', 'the control key must be back to unchanged');
});
