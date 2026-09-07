import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { computeExpectedCounts } from '../../scripts/generate-disposable-bootstrap.mjs';
import { PCA_CANONICAL_SCHEMA } from '../../dist/db/schema.js';
// The SAME module the generator emits from -- never a second copy of the rows,
// which would only prove the test agrees with itself.
import { PCA_REFERENCE_DATA, renderInsert } from '../../scripts/db/referenceData.mjs';

/**
 * PCA-DW-E2E: the disposable bootstrap artifact must stay derived from the
 * repository, and must never quietly become a second source of truth.
 *
 * A committed .sql file is exactly the kind of artifact that drifts: someone
 * changes schema.ts, the file keeps its old contents, and the next operator
 * pastes a stale schema into a database and gets a green verification for the
 * wrong shape. The generator's --check mode is what prevents that, and this
 * test is what makes --check actually run.
 */

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = join(BACKEND_ROOT, 'scripts', 'generate-disposable-bootstrap.mjs');
const BOOTSTRAP = join(BACKEND_ROOT, '..', 'docs', 'database', 'bootstrap', 'PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql');
const VERIFY = join(BACKEND_ROOT, '..', 'docs', 'database', 'bootstrap', 'PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql');

test('the committed artifacts match what the repository generates today', () => {
  const out = execFileSync(process.execPath, [GENERATOR, '--check'], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /in sync with the repository schema/);
});

test('every expected count is derived from the canonical schema, not typed in', () => {
  // Recomputed here from PCA_CANONICAL_SCHEMA and the real migration filenames,
  // then matched against the numbers actually embedded in the shipped
  // verification SQL. If someone edits either file by hand, this fails.
  const migrationFiles = execFileSync('node', ['-e', "process.stdout.write(require('fs').readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort().join('\\n'))"], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  }).split('\n');

  const expected = computeExpectedCounts(PCA_CANONICAL_SCHEMA, migrationFiles);
  const verifySql = readFileSync(VERIFY, 'utf8');

  const embedded = [
    ['tables', expected.tables],
    ['columns', expected.columns],
    ['primary keys', expected.primaryKeys],
    ['foreign keys', expected.foreignKeys],
    ['unique non-PK indexes', expected.uniqueNonPrimaryIndexes],
    ['non-unique indexes', expected.nonUniqueIndexes],
    ['CHECK constraints', expected.checkConstraints],
    ['schema_migrations rows', expected.migrationRows],
  ];
  for (const [label, value] of embedded) {
    assert.match(
      verifySql,
      new RegExp(`'${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^,]*,\\s*${value}`),
      `${label} must be embedded as ${value}, computed from the repository`,
    );
  }
});

test('the artifact carries schema for every canonical table', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  for (const table of PCA_CANONICAL_SCHEMA) {
    assert.ok(sql.includes(`CREATE TABLE \`${table.name}\``), `missing CREATE TABLE for ${table.name}`);
  }
});

/**
 * THE REGRESSION TEST FOR THE DEFECT THIS FILE EXISTS TO PREVENT.
 *
 * The artifact once shipped schema and the migration journal but NO reference
 * data. It was byte-identical in schema to a migrated database -- the
 * fingerprint check passed -- and completely unusable: 105 of the 532
 * DB-backed tests failed on foreign-key violations into billing_currencies and
 * billing_commercial_markets, and on a missing FREE_STARTER row in
 * entitlement_defaults.
 *
 * A schema fingerprint compares DDL and structurally cannot catch a missing
 * row, so this test compares against scripts/db/referenceData.mjs -- the same
 * single source the generator emits from, never a second copy of the values.
 */
test('REGRESSION: every reference-data row reaches the artifact', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  assert.ok(PCA_REFERENCE_DATA.length > 0, 'there must be reference data to check');

  for (const entry of PCA_REFERENCE_DATA) {
    const insert = renderInsert(entry);
    assert.ok(
      sql.includes(insert),
      `the artifact is missing the reference-data INSERT for ${entry.table}. ` +
        'A database bootstrapped from it would be schema-correct and still unusable.',
    );
    assert.ok(sql.includes(`INSERT INTO \`${entry.table}\``), `no INSERT targets ${entry.table}`);
  }
});

test('REGRESSION: the artifact writes reference data and the journal, and nothing else', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  const inserts = [...new Set(sql.match(/^INSERT INTO `([^`]+)`/gm) ?? [])].sort();
  const permitted = ['schema_migrations', ...PCA_REFERENCE_DATA.map((e) => e.table)]
    .map((t) => `INSERT INTO \`${t}\``)
    .sort();
  assert.deepEqual(
    inserts,
    permitted,
    'the disposable bootstrap must write the migration journal and the reference data -- and no application or business data',
  );
});

test('REGRESSION: reference data is emitted in a foreign-key-safe order', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  const positions = PCA_REFERENCE_DATA.map((e) => ({ table: e.table, at: sql.indexOf(`INSERT INTO \`${e.table}\``) }));
  for (const p of positions) assert.notEqual(p.at, -1, `${p.table} INSERT not found`);
  // billing_commercial_markets references billing_currencies, and
  // billing_country_market_rules references billing_commercial_markets, so a
  // reordering would fail at execution time against real foreign keys.
  const at = (t) => positions.find((p) => p.table === t)?.at ?? Number.POSITIVE_INFINITY;
  assert.ok(at('billing_currencies') < at('billing_commercial_markets'), 'currencies must be inserted before markets');
  assert.ok(
    at('billing_commercial_markets') < at('billing_country_market_rules'),
    'markets must be inserted before country rules',
  );
});

test('the verification script checks reference-data CONTENT, not only counts', () => {
  const verifySql = readFileSync(VERIFY, 'utf8');
  for (const entry of PCA_REFERENCE_DATA) {
    assert.match(
      verifySql,
      new RegExp(`ref rows: ${entry.table}`),
      `${entry.table} must have a reference row-count check`,
    );
    assert.match(
      verifySql,
      new RegExp(`ref content: ${entry.table}`),
      `${entry.table} must have a reference CONTENT check -- a count alone would pass a table full of wrong rows`,
    );
  }
});

test('the artifact refuses to be mistaken for a production path', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  assert.match(sql, /NOT FOR PRODUCTION/);
  assert.match(sql, /MySQL 8\.4\.x exactly/);
  assert.match(readFileSync(VERIFY, 'utf8'), /PCA requires exactly MySQL 8\.4\.x/);
});
