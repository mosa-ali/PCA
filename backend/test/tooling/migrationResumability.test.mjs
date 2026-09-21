// PCA full read-only assessment finding P1-07 ("non-idempotent multi-statement
// migrations can wedge the chain") plus the migration-chain integrity items in
// that report's §6.3.
//
// DELIBERATELY DB-FREE. The property under test is structural -- "if this file
// is interrupted part-way, can a retry complete it?" -- so it is asserted from
// the SQL text alone. That lets it run in the plain `npm test` pipeline, where
// no MySQL is available (the DB-backed suites that actually apply the chain to
// a disposable MySQL run separately via `npm run test:db`).
//
// WHY THIS EXISTS RATHER THAN A ONE-OFF FIX: scripts/migrate.mjs records a file
// as applied only AFTER it succeeds, and MySQL auto-commits each DDL statement
// independently (never as one transaction across a file -- see migrate.mjs's own
// header). So an interruption can leave a migration's effect partially present
// but unrecorded, and the retry must be able to resume rather than die on
// "table already exists" before reaching the remainder. That is a property of
// every FUTURE migration, so it is enforced here rather than fixed once.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * Production is at 0040 -- see
 * docs/supervision/PCA_PRODUCTION_MIGRATION_0041_0042_RECONCILIATION_2026-09-16.md.
 *
 * Every migration ABOVE this watermark has never been applied to production, so
 * it is exactly the set where an interrupted FIRST application can leave a
 * half-applied file a retry cannot resume -- and where making the file
 * resumable is safe, because nothing has observed its effect yet.
 *
 * Migrations at or below the watermark are already applied and are deliberately
 * NOT retrofitted. backend/migrations/ is the HISTORICAL_CHANGE_LOG that the
 * canonical-schema authority model in backend/src/db/schema.ts explicitly
 * describes as "never edited retroactively"; rewriting eighteen already-applied
 * files would add review risk without adding safety, because "a retry of an
 * already-applied migration" is not a scenario that occurs.
 */
const PRODUCTION_APPLIED_THROUGH = 40;

const TOP_LEVEL_DDL = /^(CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE|DROP INDEX)\b/;
const GUARDED_CREATE = /^CREATE TABLE IF NOT EXISTS\b/;

/**
 * Drops full-line `--` comments before any token analysis. The migration
 * headers discuss the PREPARE/EXECUTE idiom in prose, so counting tokens over
 * raw file text would count the word "PREPARE" in a comment as a statement --
 * which is exactly the kind of false signal that would make this gate either
 * vacuous or permanently red. Only whole-line comments are removed, so a `--`
 * inside a string literal is preserved.
 */
function codeText(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

/**
 * Pure text analysis, so the detector can be proven NON-VACUOUS against
 * synthetic fixtures (the negative control below) instead of only ever being
 * compared against the real files, where a broken detector would silently
 * "pass" forever.
 *
 * "Top-level" means a statement the runner actually executes: it begins at
 * column 0. The conditional PREPARE/EXECUTE idiom on purpose places the ALTER
 * text inside an indented, quoted string literal, so a correctly guarded ALTER
 * never registers as a top-level statement -- which is what makes this check
 * meaningful rather than a keyword grep.
 */
function assessResumability(text) {
  const topLevelAlters = [];
  const unguardedCreates = [];
  let topLevelDdlCount = 0;
  for (const line of codeText(text).split('\n')) {
    if (!TOP_LEVEL_DDL.test(line)) continue;
    topLevelDdlCount += 1;
    if (line.startsWith('ALTER TABLE')) topLevelAlters.push(line.trim());
    if (line.startsWith('CREATE TABLE') && !GUARDED_CREATE.test(line)) unguardedCreates.push(line.trim());
  }
  return { topLevelDdlCount, topLevelAlters, unguardedCreates };
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({
      name,
      id: Number.parseInt(name.slice(0, 4), 10),
      text: readFileSync(join(MIGRATIONS_DIR, name), 'utf8'),
    }))
    .filter((file) => Number.isInteger(file.id))
    .sort((a, b) => a.id - b.id);
}

test('NEGATIVE CONTROL: the resumability detector really does flag a non-resumable migration', () => {
  const unguarded = assessResumability('CREATE TABLE t (id INT);\nALTER TABLE t ADD COLUMN c INT;\n');
  assert.equal(unguarded.topLevelDdlCount, 2, 'both statements must be seen as top-level');
  assert.deepEqual(unguarded.topLevelAlters, ['ALTER TABLE t ADD COLUMN c INT;']);
  assert.deepEqual(unguarded.unguardedCreates, ['CREATE TABLE t (id INT);']);

  const guarded = assessResumability(
    "CREATE TABLE IF NOT EXISTS t (id INT);\n" +
      "SET @s = IF(1 = 0, 'ALTER TABLE t ADD COLUMN c INT', 'SELECT 1');\n" +
      'PREPARE st FROM @s;\n' +
      'EXECUTE st;\n' +
      'DEALLOCATE PREPARE st;\n',
  );
  assert.equal(guarded.topLevelDdlCount, 1, 'a guarded ALTER must NOT count as a top-level statement');
  assert.deepEqual(guarded.topLevelAlters, []);
  assert.deepEqual(guarded.unguardedCreates, []);
});

test('migration chain: ids are unique, strictly ascending, and the only gaps are the documented 0009/0010', () => {
  const files = migrationFiles();
  assert.ok(files.length >= 44, `expected the real migration set to be read; found only ${files.length} files`);

  const ids = files.map((file) => file.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate migration ids: ${ids.join(', ')}`);

  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(ids[i] > ids[i - 1], `migration ids must be strictly ascending: ${ids[i - 1]} then ${ids[i]}`);
  }

  const missing = [];
  for (let id = ids[0]; id <= ids[ids.length - 1]; id += 1) {
    if (!ids.includes(id)) missing.push(id);
  }
  assert.deepEqual(missing, [9, 10], 'the only permitted gaps are 0009/0010, which never existed');
});

test('PCA-P1-07: every migration not yet applied in production is resumable after an interrupted apply', () => {
  const pending = migrationFiles().filter((file) => file.id > PRODUCTION_APPLIED_THROUGH);
  assert.ok(pending.length > 0, 'expected at least one pending migration above the production watermark');

  const offenders = [];
  for (const file of pending) {
    const { topLevelAlters, unguardedCreates } = assessResumability(file.text);
    for (const statement of topLevelAlters) {
      offenders.push(`${file.name}: unguarded top-level "${statement}"`);
    }
    for (const statement of unguardedCreates) {
      offenders.push(`${file.name}: "${statement}" must be CREATE TABLE IF NOT EXISTS`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `pending migrations must survive a retry after an interrupted apply:\n${offenders.join('\n')}`,
  );
});

test('every migration that prepares a statement also deallocates it', () => {
  const offenders = [];
  for (const file of migrationFiles()) {
    const code = codeText(file.text);
    const deallocates = (code.match(/DEALLOCATE\s+PREPARE/g) ?? []).length;
    const allPrepareTokens = (code.match(/\bPREPARE\b/g) ?? []).length;
    // "DEALLOCATE PREPARE x" contains the token PREPARE too, so the number of
    // opened statements is the total minus the deallocations.
    const opens = allPrepareTokens - deallocates;
    if (opens !== deallocates) {
      offenders.push(`${file.name}: ${opens} PREPARE vs ${deallocates} DEALLOCATE PREPARE`);
    }
  }
  assert.deepEqual(offenders, [], `unbalanced prepared statements leak session state:\n${offenders.join('\n')}`);
});
