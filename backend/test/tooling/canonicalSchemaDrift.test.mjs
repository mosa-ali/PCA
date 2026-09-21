// PCA full read-only assessment finding P1-06 / architecture finding ARCH-011:
// backend/src/db/schema.ts described itself as "all 83 tables ... 0001 through
// 0044; 42 files" while its own BODY already declared the 0045/0046 objects and
// backend/migrations/ already held 44 files. The data was right; the
// self-description had silently rotted -- and because that header is the first
// thing a reviewer or the next migration author reads, a stale count sends them
// to the wrong baseline.
//
// DELIBERATELY DB-FREE, so it runs in the plain `npm test` pipeline. It closes
// the half of the drift problem that needs no database: schema.ts vs
// backend/migrations/. The other half -- backend/schema/current_schema.sql and
// schema_manifest.json being a genuine introspection of a migrated database --
// needs MySQL and is tracked separately.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCHEMA_PATH = fileURLToPath(new URL('../../src/db/schema.ts', import.meta.url));
const VERIFY_MYSQL_PATH = fileURLToPath(new URL('../../scripts/verify-mysql.mjs', import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const schemaText = readFileSync(SCHEMA_PATH, 'utf8');

/** The real table count. Matching the quoted string value counts table entries only -- the `TableDefinition` interface's own `createdByMigration: string;` field declaration carries no quote and is correctly excluded. */
function countDeclaredTables(text) {
  return (text.match(/createdByMigration: "/g) ?? []).length;
}

function migrationIds() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 4))
    .filter((id) => /^\d{4}$/.test(id))
    .sort();
}

/** Parses the header's self-description: "all N tables", "through NNNN", "NN files". */
function parseHeaderClaims(text) {
  const header = text.slice(0, text.indexOf('export type PrivacyClass'));
  const tables = /all (\d+) tables/.exec(header);
  const through = /through (\d{4})/.exec(header);
  const files = /(\d+) files/.exec(header);
  assert.ok(tables, 'the header must state its table count as "all <n> tables"');
  assert.ok(through, 'the header must state its migration range as "through <nnnn>"');
  assert.ok(files, 'the header must state its migration file count as "<nn> files"');
  return { tables: Number(tables[1]), through: Number(through[1]), files: Number(files[1]) };
}

test('NEGATIVE CONTROL: the header parser really does read the declared counts', () => {
  const parsed = parseHeaderClaims(schemaText);
  // Sanity-check the parser against a synthetic header whose values differ from
  // the real ones, so a silently-broken regex cannot make the checks below pass.
  assert.deepEqual(
    parseHeaderClaims('// all 7 tables, derived from migrations through 0099; 8 files, 0001/0002 never existed.\nexport type PrivacyClass =\n'),
    { tables: 7, through: 99, files: 8 },
  );
  assert.ok(parsed.tables > 0 && parsed.through > 0 && parsed.files > 0, 'real header counts must parse as positive integers');
});

test('PCA-P1-06: the canonical-schema header counts match schema.ts and backend/migrations/ exactly', () => {
  const declared = parseHeaderClaims(schemaText);
  const actualTables = countDeclaredTables(schemaText);
  const ids = migrationIds();
  const actualThrough = Number(ids[ids.length - 1]);

  assert.equal(
    declared.tables,
    actualTables,
    `the header says "${declared.tables} tables" but this file declares ${actualTables} table entries`,
  );
  assert.equal(
    declared.files,
    ids.length,
    `the header says "${declared.files} files" but backend/migrations/ holds ${ids.length} .sql files`,
  );
  assert.equal(
    declared.through,
    actualThrough,
    `the header says "through ${declared.through}" but the highest migration present is ${actualThrough}`,
  );
});

test('every migration is traceable from the canonical schema (createdByMigration or alteredByMigrations)', () => {
  const referenced = new Set();
  for (const match of schemaText.matchAll(/createdByMigration:\s*"(\d{4})_/g)) referenced.add(match[1]);
  for (const match of schemaText.matchAll(/alteredByMigrations:\s*\[([^\]]*)\]/g)) {
    for (const id of match[1].matchAll(/(\d{4})_/g)) referenced.add(id[1]);
  }

  const untraceable = migrationIds().filter((id) => !referenced.has(id));
  assert.deepEqual(
    untraceable,
    [],
    'a migration with no createdByMigration/alteredByMigrations trace is invisible to the canonical-schema audit: ' + untraceable.join(', '),
  );
});

test('the canonical schema declares no duplicate table names', () => {
  const names = [...schemaText.matchAll(/^    name: "([^"]+)",$/gm)].map((match) => match[1]);
  assert.ok(names.length > 0, 'expected to find table names');
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual([...new Set(duplicates)], [], 'duplicate table entries in the canonical schema');
});

// CI-03, reproduced and fixed 2026-09-21. scripts/verify-mysql.mjs asserts that a
// migrated disposable database's table set EQUALS an explicit, hand-maintained
// comma-joined list. That list is the right design -- it catches drift rather than
// blessing whatever exists -- but nothing kept it current with the migrations, and
// it had fallen two tables behind (parent_daily_login_grants from 0045/0046 and
// parent_genesis_step_up_authorizations). Every disposable-MySQL certification job
// therefore failed with "Unexpected schema: ..." even though the migrations were
// correct, which is a gate failing for the wrong reason.
//
// This is the SECOND artefact found stale in the same way (the schema.ts header was
// the first, PCA-P1-06): an explicit list that must track the migration chain but is
// only updated by remembering to. So the invariant is enforced here rather than
// fixed once -- it is DB-free, runs in the plain `npm test` pipeline, and fails the
// moment a new migration reaches the canonical authority without reaching the list.
test('CI-03: verify-mysql.mjs\'s expected table set stays in sync with the canonical schema authority', () => {
  const script = readFileSync(VERIFY_MYSQL_PATH, 'utf8');
  const match = script.match(/const expected =\s*'([^']+)'/);
  assert.ok(match, 'could not locate the "const expected = ..." table list in scripts/verify-mysql.mjs');

  const listed = match[1].split(',').map((name) => name.trim()).filter(Boolean);
  const declared = [...schemaText.matchAll(/^    name: "([^"]+)",$/gm)].map((entry) => entry[1]);

  assert.deepEqual(
    [...listed].sort(),
    [...declared].sort(),
    'scripts/verify-mysql.mjs compares a migrated database against this explicit list, so the list must be updated\n' +
      'whenever a migration adds or removes a table. Keep it equal to backend/src/db/schema.ts (the canonical\n' +
      'authority). Do NOT "fix" a mismatch by deriving the list from the live database -- that would turn a real\n' +
      'drift detector into a rubber stamp.',
  );
});
