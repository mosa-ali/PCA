/**
 * Generates the single authoritative disposable-database bootstrap artifact:
 *
 *   docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql
 *   docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql
 *
 * WHY THIS EXISTS. Applying 38 migrations one statement at a time over a
 * remote link is slow and fragile, and it needs a client that can drive the
 * migration runner. For a DISPOSABLE database an owner can just paste one file
 * into any MySQL client. This produces that file -- without becoming a second
 * source of truth.
 *
 * WHERE THE SQL COMES FROM. Nothing here is authored, remembered, or inferred
 * from an ORM. The DDL is produced by `generateSqlFromSchema` -- the SAME
 * exported generator that produces database/live-bootstrap/01_create_database_schema.sql
 * -- reading `PCA_CANONICAL_SCHEMA` from backend/src/db/schema.ts, whose
 * equivalence to a from-zero migration run is independently proven by
 * scripts/compare-schema-snapshots.mjs and scripts/schema-fingerprint.mjs.
 * The migration journal rows are read from the actual filenames in
 * backend/migrations/. So this artifact is derived, twice over, from the
 * repository's own sources of truth.
 *
 * WHAT IT DELIBERATELY DOES NOT CONTAIN. No application or business data:
 * no families, parents, children, devices, invitations, entitlements,
 * licenses, or billing reference rows. The ONLY rows it writes are the
 * `schema_migrations` bookkeeping journal, so a bootstrapped database reports
 * the same migration state as a migrated one and the migration runner treats
 * it as already up to date. Reference data (currencies, markets, entitlement
 * defaults) is a separate, deliberate step -- see
 * database/live-bootstrap/02_reference_data.sql. The DB-backed test suite does
 * not need it.
 *
 * WHAT IT IS NOT FOR. Production. Production is bootstrapped through
 * database/live-bootstrap/ and its OWNER_RUNBOOK.md, which carry preflight,
 * post-validation and rollback steps this single-file convenience does not.
 *
 * Usage:  node scripts/generate-disposable-bootstrap.mjs [--check]
 *         --check verifies the committed artifacts match what this would emit
 *         (exit 1 on drift) and writes nothing.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { generateSqlFromSchema } from './generate-bootstrap-sql.mjs';
import { PCA_CANONICAL_SCHEMA } from '../dist/db/schema.js';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
const OUT_DIR = new URL('../../docs/database/bootstrap/', import.meta.url);
const BOOTSTRAP_OUT = new URL('PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql', OUT_DIR);
const VERIFY_OUT = new URL('PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql', OUT_DIR);

/** Every expected count is COMPUTED from the canonical schema, never typed in by hand. */
export function computeExpectedCounts(schema, migrationFiles) {
  let columns = 0;
  let foreignKeys = 0;
  let uniqueNonPrimaryIndexes = 0;
  let nonUniqueIndexes = 0;
  let checkConstraints = 0;
  let primaryKeys = 0;

  for (const table of schema) {
    columns += table.columns.length;
    foreignKeys += table.foreignKeys?.length ?? 0;
    checkConstraints += table.checkConstraints?.length ?? 0;
    if (table.primaryKey?.length) primaryKeys += 1;
    // The canonical schema keeps unique and non-unique indexes in SEPARATE
    // fields (`uniqueIndexes` and `indexes`), so both are walked. `PRIMARY` is
    // skipped in both: information_schema.statistics reports it as a unique
    // index, but the verification query counts it as a primary key, and it
    // must not be counted twice.
    for (const index of table.uniqueIndexes ?? []) {
      if (index.name === 'PRIMARY') continue;
      uniqueNonPrimaryIndexes += 1;
    }
    for (const index of table.indexes ?? []) {
      if (index.name === 'PRIMARY') continue;
      if (index.unique) uniqueNonPrimaryIndexes += 1;
      else nonUniqueIndexes += 1;
    }
  }

  return {
    tables: schema.length,
    columns,
    primaryKeys,
    foreignKeys,
    uniqueNonPrimaryIndexes,
    nonUniqueIndexes,
    checkConstraints,
    migrationRows: migrationFiles.length,
  };
}

function journalSql(migrationFiles) {
  const values = migrationFiles.map((file) => `  ('${file.replace(/'/g, "''")}')`).join(',\n');
  return [
    '-- ---------------------------------------------------------------------',
    '-- Migration journal.',
    '--',
    '-- These are the ONLY rows this file writes, and they are bookkeeping, not',
    '-- application data: one row per file in backend/migrations/. Without them a',
    '-- bootstrapped database would look un-migrated and the migration runner',
    '-- would try to apply migration 0001 on top of an existing schema.',
    '-- ---------------------------------------------------------------------',
    'INSERT INTO `schema_migrations` (`version`) VALUES',
    `${values};`,
    '',
  ].join('\n');
}

function verificationSql(expected, migrationFiles) {
  const first = migrationFiles[0];
  const last = migrationFiles[migrationFiles.length - 1];
  return `-- docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql
-- GENERATED by backend/scripts/generate-disposable-bootstrap.mjs. Do not hand-edit.
--
-- Run this AFTER executing PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql, against the
-- same database, to confirm what actually landed.
--
-- WHERE THE EXPECTED NUMBERS COME FROM. Every one is COMPUTED from
-- backend/src/db/schema.ts (PCA_CANONICAL_SCHEMA) and from the actual
-- filenames in backend/migrations/, at generation time -- not typed in by
-- hand and not copied from a previous report. Regenerating this file after a
-- schema change updates them automatically; if they ever disagree with the
-- repository, the generator's own --check mode fails.
--
-- Every row of the RESULT column must read PASS.

SELECT 'PCA MySQL 8.4 disposable bootstrap verification' AS report, DATABASE() AS \`database\`, VERSION() AS server_version;

SELECT
  check_name,
  expected,
  actual,
  CASE WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'tables'                   AS check_name, ${expected.tables} AS expected,
         (SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE') AS actual
  UNION ALL SELECT 'columns', ${expected.columns},
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE())
  UNION ALL SELECT 'primary keys', ${expected.primaryKeys},
         (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE table_schema = DATABASE() AND constraint_type = 'PRIMARY KEY')
  UNION ALL SELECT 'foreign keys', ${expected.foreignKeys},
         (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE table_schema = DATABASE() AND constraint_type = 'FOREIGN KEY')
  UNION ALL SELECT 'unique non-PK indexes', ${expected.uniqueNonPrimaryIndexes},
         (SELECT COUNT(*) FROM (SELECT DISTINCT table_name, index_name
            FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND non_unique = 0 AND index_name <> 'PRIMARY') u)
  UNION ALL SELECT 'non-unique indexes', ${expected.nonUniqueIndexes},
         (SELECT COUNT(*) FROM (SELECT DISTINCT table_name, index_name
            FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND non_unique = 1) n)
  UNION ALL SELECT 'CHECK constraints', ${expected.checkConstraints},
         (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE table_schema = DATABASE() AND constraint_type = 'CHECK')
  UNION ALL SELECT 'schema_migrations rows', ${expected.migrationRows},
         (SELECT COUNT(*) FROM \`schema_migrations\`)
  UNION ALL SELECT 'views (must be 0)', 0,
         (SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_type = 'VIEW')
  UNION ALL SELECT 'triggers (must be 0)', 0,
         (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE())
  UNION ALL SELECT 'routines (must be 0)', 0,
         (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = DATABASE())
) AS checks;

-- Journal endpoints, so a truncated paste is visible rather than silent.
SELECT
  '${first}' AS expected_first, MIN(version) AS actual_first,
  '${last}' AS expected_last,  MAX(version) AS actual_last,
  CASE WHEN MIN(version) = '${first}' AND MAX(version) = '${last}' THEN 'PASS' ELSE 'FAIL' END AS result
FROM \`schema_migrations\`;

-- Environment, which PCA pins independently of the schema. MySQL must be
-- exactly 8.4.x (backend/scripts/verify-mysql.mjs enforces the same bar).
SELECT
  VERSION() AS server_version,
  @@global.time_zone AS global_time_zone,
  (SELECT default_character_set_name FROM information_schema.schemata WHERE schema_name = DATABASE()) AS \`charset\`,
  (SELECT default_collation_name    FROM information_schema.schemata WHERE schema_name = DATABASE()) AS collation,
  CASE
    WHEN VERSION() NOT LIKE '8.4.%' THEN 'FAIL: PCA requires exactly MySQL 8.4.x'
    WHEN (SELECT default_collation_name FROM information_schema.schemata WHERE schema_name = DATABASE()) <> 'utf8mb4_bin'
      THEN 'FAIL: database collation must be utf8mb4_bin'
    ELSE 'PASS'
  END AS result;

-- No application or business data may exist in a freshly bootstrapped
-- database. A non-zero count here means something seeded it.
SELECT 'no application data' AS check_name, 0 AS expected,
  (SELECT COUNT(*) FROM \`families\`)
  + (SELECT COUNT(*) FROM \`parent_accounts\`)
  + (SELECT COUNT(*) FROM \`devices\`)
  + (SELECT COUNT(*) FROM \`enrollment_invitations\`)
  + (SELECT COUNT(*) FROM \`licenses\`) AS actual,
  CASE WHEN (SELECT COUNT(*) FROM \`families\`)
          + (SELECT COUNT(*) FROM \`parent_accounts\`)
          + (SELECT COUNT(*) FROM \`devices\`)
          + (SELECT COUNT(*) FROM \`enrollment_invitations\`)
          + (SELECT COUNT(*) FROM \`licenses\`) = 0 THEN 'PASS' ELSE 'FAIL' END AS result;
`;
}

function bootstrapSql(schema, migrationFiles, expected) {
  const header = `-- docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql
--
-- GENERATED by backend/scripts/generate-disposable-bootstrap.mjs. Do not
-- hand-edit: change backend/src/db/schema.ts (and the migration that justifies
-- it) and regenerate. CI fails if this file drifts from the repository.
--
-- PURPOSE: create the complete current PCA schema in ONE file, for a
-- DISPOSABLE / integration database only.
--
-- NOT FOR PRODUCTION. Production is bootstrapped through
-- database/live-bootstrap/ and its OWNER_RUNBOOK.md, which carry the preflight,
-- post-validation, backup and rollback steps this convenience file does not.
--
-- TARGET: MySQL 8.4.x exactly. PCA does not support 8.0.x or 9.x; the
-- companion verification script re-checks the server version.
--
-- CONTENTS
--   ${String(expected.tables).padStart(3)} tables
--   ${String(expected.columns).padStart(3)} columns
--   ${String(expected.primaryKeys).padStart(3)} primary keys
--   ${String(expected.foreignKeys).padStart(3)} foreign keys
--   ${String(expected.uniqueNonPrimaryIndexes).padStart(3)} unique non-primary-key indexes
--   ${String(expected.nonUniqueIndexes).padStart(3)} non-unique indexes
--   ${String(expected.checkConstraints).padStart(3)} CHECK constraints
--   ${String(expected.migrationRows).padStart(3)} schema_migrations journal rows
--     0 views, 0 triggers, 0 stored routines
--
-- NO APPLICATION OR BUSINESS DATA. The only rows written are the
-- schema_migrations journal (bookkeeping). Reference data such as currencies
-- and commercial markets is a separate, deliberate step --
-- database/live-bootstrap/02_reference_data.sql. The DB-backed test suite does
-- not require it.
--
-- PREREQUISITE: an EMPTY database whose default collation is utf8mb4_bin, e.g.
--   CREATE DATABASE \`disposable\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
--
-- AFTERWARDS: run PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql against the same
-- database. Every RESULT column must read PASS.

`;

  const ddl = generateSqlFromSchema(schema);
  // generateSqlFromSchema emits its own live-bootstrap header; drop it so this
  // artifact carries exactly one, accurate provenance header of its own.
  const ddlBody = ddl.slice(ddl.indexOf('SET NAMES utf8mb4;'));

  // The generator re-enables FOREIGN_KEY_CHECKS at the very end; the journal
  // rows are appended after that, so they are inserted with constraints on.
  return `${header}${ddlBody}\n${journalSql(migrationFiles)}`;
}

// --- entrypoint -------------------------------------------------------------
//
// Guarded so that IMPORTING this module (the artifact-drift test imports
// computeExpectedCounts from it) never regenerates the artifacts. Without this
// guard the drift test silently rewrote the very files it was about to check
// and therefore passed against a deliberately corrupted artifact -- a gate that
// asserted nothing. Mirrors generate-bootstrap-sql.mjs's own CLI guard.
if (process.argv[1] && process.argv[1].includes('generate-disposable-bootstrap')) {
  await main();
}

async function main() {
const migrationFiles = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
if (migrationFiles.length === 0) throw new Error('No migration files found in backend/migrations/.');

const expected = computeExpectedCounts(PCA_CANONICAL_SCHEMA, migrationFiles);
const bootstrap = bootstrapSql(PCA_CANONICAL_SCHEMA, migrationFiles, expected);
const verify = verificationSql(expected, migrationFiles);

const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const problems = [];
  for (const [label, url, want] of [
    ['PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql', BOOTSTRAP_OUT, bootstrap],
    ['PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql', VERIFY_OUT, verify],
  ]) {
    let actual = null;
    try {
      actual = await readFile(fileURLToPath(url), 'utf8');
    } catch {
      problems.push(`${label} is missing`);
      continue;
    }
    if (actual !== want) problems.push(`${label} does not match what the repository would generate`);
  }
  if (problems.length > 0) {
    console.error('\nDISPOSABLE BOOTSTRAP ARTIFACT DRIFT:\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('\nRegenerate with: node scripts/generate-disposable-bootstrap.mjs\n');
    process.exitCode = 1;
  } else {
    console.log('Disposable bootstrap artifacts are in sync with the repository schema.');
  }
} else {
  await writeFile(fileURLToPath(BOOTSTRAP_OUT), bootstrap, 'utf8');
  await writeFile(fileURLToPath(VERIFY_OUT), verify, 'utf8');
  console.log('Wrote docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql');
  console.log('Wrote docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_VERIFY.sql');
  console.log('\nExpected counts, computed from the repository:');
  for (const [key, value] of Object.entries(expected)) console.log(`  ${key.padEnd(24)} ${value}`);
}
}
