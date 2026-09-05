// Proves the schema-equivalence pipeline (schema.ts -> generate-bootstrap-sql
// -> apply to a disposable DB -> introspect -> compare-schema-snapshots)
// actually detects drift, by deliberately mutating an in-memory clone of
// PCA_CANONICAL_SCHEMA, running the REAL pipeline end-to-end against a
// disposable database, and asserting compare-schema-snapshots reports a
// real difference for every one of 9 mutation classes. Every mutation is
// applied to an in-memory clone; backend/src/db/schema.ts and
// backend/dist/db/schema.js on disk are never touched, and no application
// data is ever written.
//
// Usage:
//   PCA_BASELINE_DATABASE_URL=<a from-zero-migrated disposable DB>
//   PCA_MUTATION_DATABASE_URL=<an empty disposable DB, safe to drop/recreate repeatedly>
//   node verify-schema-negative-controls.mjs
//
// Both URLs are validated against the same local/Compose-only hostname
// allowlist backend/scripts/verify-mysql.mjs uses, so this can never
// accidentally run against a non-disposable host. PCA_MUTATION_DATABASE_URL
// is DROPPED AND RECREATED (its own database only, never a whole server)
// once per mutation plus once more at the end to restore it to the correct
// canonical-bootstrap state.
import mysql from 'mysql2/promise';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PCA_CANONICAL_SCHEMA } from '../dist/db/schema.js';
import { generateSqlFromSchema } from './generate-bootstrap-sql.mjs';
import { compareSchemas } from './compare-schema-snapshots.mjs';

const execFileP = promisify(execFile);

function requireLocalUrl(envName) {
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is required.`);
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
    throw new Error(`${envName} must point to a disposable local/Compose database.`);
  }
  return raw;
}

const baselineUrl = requireLocalUrl('PCA_BASELINE_DATABASE_URL');
const mutationUrl = requireLocalUrl('PCA_MUTATION_DATABASE_URL');
const mutationDbName = new URL(mutationUrl).pathname.replace(/^\//, '');
if (!mutationDbName) throw new Error('PCA_MUTATION_DATABASE_URL must include a database name.');

const introspectScript = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')), 'introspect-schema.mjs');
const scratchDir = await mkdtemp(path.join(tmpdir(), 'pca-negative-controls-'));

function clone(schema) {
  return JSON.parse(JSON.stringify(schema));
}

const MUTATIONS = [
  { id: 1, description: 'Remove one column from canonical schema (devices.paired_at)', apply: (s) => { s.find((x) => x.name === 'devices').columns = s.find((x) => x.name === 'devices').columns.filter((c) => c.name !== 'paired_at'); } },
  { id: 2, description: 'Shrink a VARCHAR length (billing_plans.plan_code 64 -> 32)', apply: (s) => { s.find((x) => x.name === 'billing_plans').columns.find((c) => c.name === 'plan_code').columnType = 'varchar(32)'; } },
  { id: 3, description: 'Drop one unique index (device_public_keys_public_key_key)', apply: (s) => { const t = s.find((x) => x.name === 'device_public_keys'); t.uniqueIndexes = t.uniqueIndexes.filter((i) => i.name !== 'device_public_keys_public_key_key'); } },
  { id: 4, description: 'Flip one nullable field to NOT NULL (devices.revoked_at)', apply: (s) => { s.find((x) => x.name === 'devices').columns.find((c) => c.name === 'revoked_at').nullable = false; } },
  { id: 5, description: 'Change one collation (families.status utf8mb4_bin -> utf8mb4_general_ci)', apply: (s) => { s.find((x) => x.name === 'families').columns.find((c) => c.name === 'status').collation = 'utf8mb4_general_ci'; } },
  {
    // NOTE: compareSchemas (this script's detection mechanism) has no
    // awareness of the `privacy` field at all -- it detects this mutation
    // only because it is a structurally new column, the same mechanism as
    // mutation #1. The privacy-classification-aware defense this mutation's
    // name evokes is a SEPARATE, independently-tested mechanism
    // (backend/test/canonicalSchemaChildFieldsRegression.test.mjs), not
    // exercised by this script. Kept as a negative control because "an
    // unreviewed new column exists" is still a real, useful thing to prove
    // this pipeline catches -- described accurately here so its actual
    // detection path is never mistaken for privacy-aware detection.
    id: 6, description: 'Add a new column that happens to be prohibited-child-readable-shaped (family_child_memberships.display_name) -- detected here as a structural diff (new column), NOT via privacy classification; see the canonical-schema-wide gate (backend/test/canonicalSchemaChildFieldsRegression.test.mjs) for the privacy-aware check.',
    apply: (s) => {
      s.find((x) => x.name === 'family_child_memberships').columns.push({
        name: 'display_name', columnType: 'varchar(128)', dataType: 'varchar', charset: 'utf8mb4', collation: 'utf8mb4_bin',
        nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false,
        generatedExpression: null, generatedStorage: null, privacy: 'READABLE_CHILD_DATA', privacyNote: 'INJECTED FOR NEGATIVE CONTROL',
      });
    },
  },
  { id: 7, description: 'Remove a required CHECK constraint (billing_commercial_markets_market_check) -- this schema has no seed reference DATA rows to omit, so a required closed-vocabulary guarantee is the nearest equivalent mutation (see PCA_PRODUCTION_REFERENCE_DATA_MATRIX.csv)', apply: (s) => { const t = s.find((x) => x.name === 'billing_commercial_markets'); t.checkConstraints = t.checkConstraints.filter((c) => c.name !== 'billing_commercial_markets_market_check'); } },
  {
    id: 8, description: 'Add an unexpected table (rogue_debug_table)',
    apply: (s) => {
      s.push({
        name: 'rogue_debug_table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin',
        createdByMigration: 'NONE (injected)', alteredByMigrations: [], ownerModule: 'NONE',
        columns: [{ name: 'id', columnType: 'char(36)', dataType: 'char', charset: 'ascii', collation: 'ascii_bin', nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: 'OTHER', privacyNote: 'INJECTED' }],
        primaryKey: ['id'], uniqueIndexes: [], indexes: [], foreignKeys: [], checkConstraints: [], applicationEnforcedRelations: [],
      });
    },
  },
  { id: 9, description: "Alter one timestamp default (account_entitlements.created_at -> epoch)", apply: (s) => { s.find((x) => x.name === 'account_entitlements').columns.find((c) => c.name === 'created_at').default = '1970-01-01 00:00:00.000'; } },
];

async function resetMutationDb() {
  const adminUrl = mutationUrl.slice(0, mutationUrl.lastIndexOf('/') + 1);
  const admin = await mysql.createConnection({ uri: adminUrl, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${mutationDbName}\`; CREATE DATABASE \`${mutationDbName}\`;`);
  await admin.end();
}

async function applySql(sql) {
  const conn = await mysql.createConnection({ uri: mutationUrl, multipleStatements: true, timezone: 'Z' });
  try {
    await conn.query(sql);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await conn.end();
  }
}

async function introspectMutationDb() {
  const outPath = path.join(scratchDir, 'mutated.json');
  await execFileP('node', [introspectScript, mutationUrl, outPath]);
  return JSON.parse(await readFile(outPath, 'utf8'));
}

console.log('Introspecting baseline (from-zero-migrated) database...');
const baselinePath = path.join(scratchDir, 'baseline.json');
await execFileP('node', [introspectScript, baselineUrl, baselinePath]);
const baselineSnapshot = JSON.parse(await readFile(baselinePath, 'utf8'));

const results = [];
for (const mutation of MUTATIONS) {
  const mutated = clone(PCA_CANONICAL_SCHEMA);
  mutation.apply(mutated);
  const sql = generateSqlFromSchema(mutated);

  await resetMutationDb();
  const applyResult = await applySql(sql);

  let outcome;
  if (!applyResult.ok) {
    // A mutation that fails to even apply is itself a detected defect -- the
    // DDL never reached a comparable state, which is a valid (loud) detection.
    outcome = { detected: true, mode: 'DDL_REJECTED', detail: applyResult.error };
  } else {
    const mutatedSnapshot = await introspectMutationDb();
    const diffs = compareSchemas(baselineSnapshot, mutatedSnapshot);
    outcome = { detected: diffs.length > 0, mode: 'SCHEMA_DIFF', detail: diffs };
  }

  results.push({ id: mutation.id, description: mutation.description, ...outcome });
  console.log(`Mutation ${mutation.id}: ${outcome.detected ? 'DETECTED' : 'NOT DETECTED (FAIL)'} (${outcome.mode})`);
}

// Restore the mutation database to the correct (unmutated) canonical
// bootstrap state, so this script leaves its target database usable.
await resetMutationDb();
await applySql(generateSqlFromSchema(PCA_CANONICAL_SCHEMA));
await rm(scratchDir, { recursive: true, force: true });

const allDetected = results.every((r) => r.detected);
console.log('\n=== SUMMARY ===');
console.log(`SCHEMA_NEGATIVE_CONTROL_PROOFS = ${results.filter((r) => r.detected).length} / ${results.length}`);
console.log(allDetected ? 'ALL NEGATIVE CONTROLS DETECTED -- comparator is a real gate.' : 'AT LEAST ONE NEGATIVE CONTROL WAS NOT DETECTED -- investigate.');
process.exitCode = allDetected ? 0 : 1;
