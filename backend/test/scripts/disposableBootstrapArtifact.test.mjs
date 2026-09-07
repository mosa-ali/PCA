import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { computeExpectedCounts } from '../../scripts/generate-disposable-bootstrap.mjs';
import { PCA_CANONICAL_SCHEMA } from '../../dist/db/schema.js';

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

test('the artifact carries schema for every canonical table and no business data', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  for (const table of PCA_CANONICAL_SCHEMA) {
    assert.ok(sql.includes(`CREATE TABLE \`${table.name}\``), `missing CREATE TABLE for ${table.name}`);
  }

  // The ONLY INSERT permitted is the schema_migrations journal. Any other
  // INSERT means application or reference data leaked into a file that
  // promises neither.
  const inserts = sql.match(/^INSERT INTO `([^`]+)`/gm) ?? [];
  assert.deepEqual(
    [...new Set(inserts)],
    ['INSERT INTO `schema_migrations`'],
    'the disposable bootstrap must write no rows other than the migration journal',
  );
});

test('the artifact refuses to be mistaken for a production path', () => {
  const sql = readFileSync(BOOTSTRAP, 'utf8');
  assert.match(sql, /NOT FOR PRODUCTION/);
  assert.match(sql, /MySQL 8\.4\.x exactly/);
  assert.match(readFileSync(VERIFY, 'utf8'), /PCA requires exactly MySQL 8\.4\.x/);
});
