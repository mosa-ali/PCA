// Authoritative post-bootstrap validation. Complements
// database/live-bootstrap/03_post_validation.sql (which checks everything
// cheaply expressible as static SQL: exact table/column/FK/index counts,
// engine/charset, reference-data row counts) with three checks that need a
// dynamic per-table loop or the Node-side canonical schema:
//
//   1. Every table OTHER than the 5 reference-data tables is completely
//      empty (no test/demo data anywhere).
//   2. No column name in the live database matches a prohibited
//      central-child-data term outside the reviewed allowlist (same
//      allowlist as backend/test/canonicalSchemaChildFieldsRegression.test.mjs).
//   3. The live database's schema fingerprint exactly matches the expected
//      canonical fingerprint recorded in
//      docs/database/PCA_CANONICAL_SCHEMA_REPORT.md.
//
// Usage: PCA_DATABASE_URL=... node post-validate.mjs
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import { normalizedFingerprint } from './schema-fingerprint.mjs';

const execFileP = promisify(execFile);

const EXPECTED_FINGERPRINT = 'a7a31c6fb1e3f89d9a44bb885ac76550cd41964b48ddb287f5939e041658a495';
const REFERENCE_TABLES = new Set(['billing_currencies', 'billing_commercial_markets', 'billing_country_market_rules', 'entitlement_defaults', 'schema_migrations']);

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required.');

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`PASS: ${message}`);
  }
}

const connection = await mysql.createConnection({ uri: connectionString, timezone: 'Z' });
try {
  const [dbRows] = await connection.query('SELECT DATABASE() AS db');
  const dbName = dbRows[0].db;

  // 1. Non-reference tables must be completely empty.
  const [tableRows] = await connection.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
    [dbName],
  );
  for (const row of tableRows) {
    const table = row.table_name ?? row.TABLE_NAME;
    if (REFERENCE_TABLES.has(table)) continue;
    const [[{ n }]] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    assert(n === 0, `${table} is empty (no test/demo data) -- found ${n} row(s)`);
  }

  // 2. Prohibited child-data column name scan (same allowlist as the
  // committed regression test, kept in sync by hand -- see that test's own
  // header for the standard of evidence required to add an entry).
  const PROHIBITED_TERMS = [
    'display_name', 'nickname', 'dob', 'birth_date', 'birthdate', 'age', 'gender', 'school',
    'photo', 'avatar', 'message', 'browsing_history', 'app_usage_history', 'usage_history',
    'precise_location', 'camera_frame', 'camera', 'face', 'url', 'title', 'search', 'location',
    'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret',
  ];
  const ALLOWED = new Set([
    'account_entitlements.managed_device_limit', 'account_entitlements.managed_device_active_count',
    'account_entitlements.managed_device_reserved_count', 'account_entitlements.over_limit_managed_device',
    'billing_plans.default_managed_device_limit', 'entitlement_activation_idempotency.applied_managed_device_limit',
    'entitlement_defaults.managed_device_limit', 'parent_accounts.default_managed_device_limit',
    'parent_account_preferences.language_code', 'family_rbac_policy_config.administrator_can_manage_viewers',
    'release_current_pointers.package_type', 'release_packages.package_type',
    'billing_refunds.entitlement_treatment', 'complimentary_entitlement_grants.entitlement_type',
    'commercial_notifications.message_key', 'envelope_message_idempotency_ledger.message_id', 'relay_envelopes.message_id',
    'enrollment_invitations.initial_policy_profile', 'enrollment_invitations.age_ux_tier',
    'platform_admin_accounts.display_name',
  ]);
  const [colRows] = await connection.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ?`, [dbName]);
  let offenders = 0;
  for (const row of colRows) {
    const table = row.table_name ?? row.TABLE_NAME;
    const column = row.column_name ?? row.COLUMN_NAME;
    const key = `${table}.${column}`;
    const lower = column.toLowerCase();
    for (const term of PROHIBITED_TERMS) {
      if (lower.includes(term) && !ALLOWED.has(key)) {
        console.error(`FAIL: unreviewed prohibited-term column: ${key} (matched "${term}")`);
        offenders++;
      }
    }
  }
  assert(offenders === 0, `no unreviewed prohibited-term column names (${colRows.length} columns scanned)`);

  // 3. Schema fingerprint match.
  const scratchDir = await mkdtemp(path.join(tmpdir(), 'pca-postvalidate-'));
  const scratchJson = path.join(scratchDir, 'live.json');
  await execFileP('node', [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')), 'introspect-schema.mjs'), connectionString, scratchJson]);
  const { readFile } = await import('node:fs/promises');
  const liveIntrospection = JSON.parse(await readFile(scratchJson, 'utf8'));
  const { hash } = normalizedFingerprint(liveIntrospection);
  assert(hash === EXPECTED_FINGERPRINT, `schema fingerprint matches expected sha256:${EXPECTED_FINGERPRINT} (got sha256:${hash})`);
  await rm(scratchDir, { recursive: true, force: true });

  console.log(failures === 0 ? '\nPCA-LIVE-DB-0 POST-VALIDATION (dynamic checks): ALL PASSED' : `\nPCA-LIVE-DB-0 POST-VALIDATION: ${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await connection.end();
}
