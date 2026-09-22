// PCA-COMMERCIAL-LIVENESS-2 -- the SOURCE PROOF behind the one terminal state.
//
// commercialmaintenance/CommercialMaintenanceRunner moves an unattributable
// expired quote to TERMINAL_UNATTRIBUTABLE only for the reason code
// REFERENCE_ABSENT (the quote carries no increase_request_ref at all). That is
// only sound if a NULL reference can never later become non-NULL, and the claim
// is easy to state and easy to break: one future `UPDATE billing_quotes SET
// increase_request_ref = ...` anywhere in the codebase silently turns a terminal
// state into a lost notification.
//
// So the invariant is ENFORCED here rather than asserted in a comment. This file
// is DB-free and runs in the plain `npm test` pipeline, so the proof is checked
// on every push.
//
// It also pins the other half: the decision must depend ONLY on the reason code.
// Terminalising on age or on retry count is explicitly not authorized, and the
// cheapest way for that to creep in is one extra `||` inside isProvablyTerminal.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_DIR = join(BACKEND_ROOT, 'src');
const MIGRATIONS_DIR = join(BACKEND_ROOT, 'migrations');
const RETRY_MODULE = join(BACKEND_ROOT, 'src', 'commercialmaintenance', 'attributionRetry.ts');
const SCHEMA_PATH = join(BACKEND_ROOT, 'src', 'db', 'schema.ts');

function filesUnder(dir, extensions) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some((extension) => entry.endsWith(extension))) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/**
 * Statements that ASSIGN the reference column, in either of the two shapes SQL
 * uses: a `SET` clause, or an `ON DUPLICATE KEY UPDATE` clause. A comparison
 * (`WHERE increase_request_ref = ?`) is deliberately NOT matched -- treating it
 * as a write would make this guard fire on correct code, and a guard that cries
 * wolf gets disabled.
 */
function assignmentOffenders(text) {
  const offenders = [];
  for (const match of text.matchAll(/\bSET\b([^;]*?)increase_request_ref\s*=/gis)) {
    offenders.push(match[0].slice(0, 120).replace(/\s+/g, ' '));
  }
  for (const match of text.matchAll(/\bON DUPLICATE KEY UPDATE\b([^;]*?)increase_request_ref\s*=/gis)) {
    offenders.push(match[0].slice(0, 120).replace(/\s+/g, ' '));
  }
  // INSERT column lists are fine -- the INSERT establishes the initial value and
  // is the ONE writer the invariant is built on -- so they are not matched here.
  return offenders;
}

test('NEGATIVE CONTROL: the assignment detector really fires on a write to the reference column', () => {
  // Without this, the guard below could pass because it matches nothing at all.
  assert.equal(assignmentOffenders('SELECT 1').length, 0, 'a statement with no write must produce no offenders');
  assert.equal(assignmentOffenders('SELECT * FROM billing_quotes WHERE increase_request_ref = ?').length, 0, 'a COMPARISON must not be mistaken for a write');
  assert.equal(assignmentOffenders('UPDATE billing_quotes SET status = ?, increase_request_ref = ? WHERE quote_id = ?').length, 1, 'a SET assignment must be caught');
  assert.equal(assignmentOffenders('INSERT INTO x (a) VALUES (1) ON DUPLICATE KEY UPDATE increase_request_ref = VALUES(a)').length, 1, 'an ON DUPLICATE KEY UPDATE assignment must be caught');
});

test('PCA-COMMERCIAL-LIVENESS-2: nothing in src/** or migrations/** ever REASSIGNS billing_quotes.increase_request_ref', () => {
  const files = [...filesUnder(SRC_DIR, ['.ts']), ...filesUnder(MIGRATIONS_DIR, ['.sql'])];
  assert.ok(files.length > 100, `expected to scan a real codebase, found ${files.length} file(s)`);

  const offenders = [];
  for (const file of files) {
    // This file and the runner's own comments are allowed to NAME the column.
    for (const offender of assignmentOffenders(readFileSync(file, 'utf8'))) {
      offenders.push(`${file.replace(BACKEND_ROOT, '')}: ${offender}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a statement reassigns billing_quotes.increase_request_ref. That column is the ONE reference the quote-expiry\n' +
      'notification is attributed through, and it is written exactly once, at INSERT. Reassigning it would invalidate the\n' +
      'proof that a quote with no reference is permanently unattributable (and therefore that\n' +
      'TERMINAL_UNATTRIBUTABLE is safe). If a repair path is genuinely intended, it must come with a re-derived\n' +
      'attribution model and a re-covered notification guarantee -- not a silent UPDATE:\n' +
      offenders.join('\n'),
  );
});

test('PCA-COMMERCIAL-LIVENESS-2: the reference column is still NULLABLE, so REFERENCE_ABSENT is reachable at all', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const table = /name: "billing_quotes",[\s\S]*?\n  \},/.exec(schema);
  assert.ok(table, 'could not locate the billing_quotes table entry in the canonical schema');
  const column = /\{ name: "increase_request_ref",[^}]*\}/.exec(table[0]);
  assert.ok(column, 'could not locate billing_quotes.increase_request_ref in the canonical schema');
  assert.match(column[0], /nullable: true/, 'if this column became NOT NULL the REFERENCE_ABSENT branch would be dead code and this module\'s terminal reason would be unreachable');
});

test('PCA-COMMERCIAL-LIVENESS-2: terminality is decided by the reason code ALONE -- never by age and never by retry count', () => {
  const source = readFileSync(RETRY_MODULE, 'utf8');
  const body = /export function isProvablyTerminal\([\s\S]*?\n\}/.exec(source);
  assert.ok(body, 'could not locate isProvablyTerminal in attributionRetry.ts');
  assert.match(body[0], /reasonCode/, 'isProvablyTerminal must decide from the reason code');
  for (const forbidden of ['attemptCount', 'now', 'Date', 'age', 'attempt_count']) {
    assert.doesNotMatch(
      body[0],
      new RegExp(forbidden),
      `isProvablyTerminal references "${forbidden}". Terminality may not depend on age or on retry count -- both were\n` +
        'explicitly ruled out, because neither is evidence that attribution can never become valid. Only a source-level\n' +
        'proof (the reference column is write-once) may terminalise a row.',
    );
  }
  // And the reason vocabulary must stay exactly two -- a third code added here
  // without a permanence proof is the failure mode this pair of assertions exists
  // to make visible.
  const reasonType = /export type AttributionReasonCode =([^;]+);/.exec(source);
  assert.ok(reasonType, 'could not locate AttributionReasonCode');
  const codes = [...reasonType[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(codes, ['REFERENCE_ABSENT', 'REFERENCE_UNRESOLVED'], 'the reason vocabulary changed: a new code needs its own permanence proof and its own coverage before it may be added');
});
