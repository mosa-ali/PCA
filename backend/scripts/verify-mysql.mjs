// Disposable-database migration/privacy/environment gate, run as part of
// `npm run test:db`. Applies every migration to a fresh database (the
// Compose test service, or an explicitly-allowed local host) and asserts:
// (1) the server is a supported MySQL environment (exact version, database
// charset/collation, time zone) BEFORE any migration runs, so a wrong
// environment fails fast rather than after 35 migrations; (2) the
// resulting table set is exactly the expected minimal central schema --
// catches an accidental new table (a privacy/scope regression) as fast as
// a broken migration; (3) AFTER migrations, a column-collation spot check
// distinguishing migration 0001's deliberate ascii/ascii_bin UUID/hash
// exception from the utf8mb4/utf8mb4_bin default every other text column
// uses. This mirrors database/live-bootstrap/00_preflight.sql's own
// hardened checks (see that file's comments for the full rationale on each
// one -- in particular why GLOBAL time_zone, not the application pool's
// client-side `timezone: 'Z'` option, is the authoritative UTC signal) so
// that a migration-from-zero run (Database A) and a bootstrap-from-zero
// run (Database B) are held to the identical environment bar.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const REQUIRED_MAJOR_VERSION = 8;
const REQUIRED_MINOR_VERSION = 4;
const REQUIRED_DB_CHARSET = 'utf8mb4';
const REQUIRED_DB_COLLATION = 'utf8mb4_bin';
const REQUIRED_TIME_ZONE = '+00:00';

// A handful of concrete columns known (from migration 0001's own TYPE
// DECISIONS comment, and from reading the migrations that define them) to
// use the deliberate ascii/ascii_bin exception -- application-generated
// UUID primary keys and a fixed-length bookkeeping identifier -- versus
// columns known to use the utf8mb4/utf8mb4_bin default every other text
// column relies on. This is a SPOT check, not exhaustive; the aggregate
// query below it (checkColumnCollations's second half) is what actually
// guarantees no OTHER charset/collation pair exists anywhere in the schema.
const ASCII_EXCEPTION_COLUMNS = [
  ['families', 'family_id'], // CHAR(36) app-generated UUID primary key
  ['service_accounts', 'account_id'], // CHAR(36) app-generated UUID primary key
  ['schema_migrations', 'version'], // VARCHAR(255) migration filename, ascii by design
];
const UTF8MB4_DEFAULT_COLUMNS = [
  ['devices', 'family_id'], // opaque application identifier, not a UUID column
  ['device_public_keys', 'public_key'], // opaque application identifier
];

/**
 * Fails closed (throws) rather than merely warning, matching
 * 00_preflight.sql's SIGNAL-on-failure contract -- an unsupported
 * environment must stop this gate, not just get logged.
 */
async function assertSupportedEnvironment(connection) {
  const [[versionRow]] = await connection.query('SELECT VERSION() AS version');
  const version = versionRow.version;
  const [major, minor] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (major !== REQUIRED_MAJOR_VERSION || minor !== REQUIRED_MINOR_VERSION) {
    throw new Error(`Unsupported MySQL version: must be exactly ${REQUIRED_MAJOR_VERSION}.${REQUIRED_MINOR_VERSION}.x. Found: ${version}`);
  }

  const [[tzRow]] = await connection.query('SELECT @@GLOBAL.time_zone AS globalTz, @@SESSION.time_zone AS sessionTz');
  if (tzRow.globalTz !== REQUIRED_TIME_ZONE || tzRow.sessionTz !== REQUIRED_TIME_ZONE) {
    throw new Error(
      `Unsupported time zone: GLOBAL and SESSION time_zone must both be ${REQUIRED_TIME_ZONE} (UTC). ` +
        `Found GLOBAL=${tzRow.globalTz} SESSION=${tzRow.sessionTz}.`,
    );
  }

  const [[schemaRow]] = await connection.query(
    `SELECT default_character_set_name AS charset, default_collation_name AS collation
     FROM information_schema.schemata WHERE schema_name = DATABASE()`,
  );
  if (schemaRow.charset !== REQUIRED_DB_CHARSET || schemaRow.collation !== REQUIRED_DB_COLLATION) {
    throw new Error(
      `Unsupported database charset/collation: must be ${REQUIRED_DB_CHARSET}/${REQUIRED_DB_COLLATION}. ` +
        `Found: ${schemaRow.charset}/${schemaRow.collation}.`,
    );
  }

  console.log(`Environment OK: MySQL ${version}, db charset ${schemaRow.charset}/${schemaRow.collation}, time_zone ${tzRow.globalTz}.`);
}

/**
 * Column-collation spot check, run AFTER migrations so the columns exist.
 * Confirms the concrete ascii/ascii_bin and utf8mb4/utf8mb4_bin examples
 * above are exactly as documented, then independently confirms via an
 * aggregate query that NO OTHER charset/collation pair exists anywhere in
 * the schema -- so a stray column (e.g. an accidental utf8mb4_general_ci
 * or latin1) cannot slip past the fixed spot-check list unnoticed.
 */
async function assertColumnCollations(connection) {
  for (const [table, column] of ASCII_EXCEPTION_COLUMNS) {
    const [[row]] = await connection.query(
      `SELECT character_set_name AS charset, collation_name AS collation
       FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    if (!row) throw new Error(`Column-collation spot check: ${table}.${column} not found.`);
    if (row.charset !== 'ascii' || row.collation !== 'ascii_bin') {
      throw new Error(`Column-collation spot check FAILED: ${table}.${column} expected ascii/ascii_bin, found ${row.charset}/${row.collation}.`);
    }
  }
  for (const [table, column] of UTF8MB4_DEFAULT_COLUMNS) {
    const [[row]] = await connection.query(
      `SELECT character_set_name AS charset, collation_name AS collation
       FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    if (!row) throw new Error(`Column-collation spot check: ${table}.${column} not found.`);
    if (row.charset !== 'utf8mb4' || row.collation !== 'utf8mb4_bin') {
      throw new Error(`Column-collation spot check FAILED: ${table}.${column} expected utf8mb4/utf8mb4_bin, found ${row.charset}/${row.collation}.`);
    }
  }

  const [pairs] = await connection.query(
    `SELECT DISTINCT character_set_name AS charset, collation_name AS collation
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND character_set_name IS NOT NULL`,
  );
  const allowed = new Set([`${REQUIRED_DB_CHARSET}/${REQUIRED_DB_COLLATION}`, 'ascii/ascii_bin']);
  const unexpected = pairs.filter((row) => !allowed.has(`${row.charset}/${row.collation}`));
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected column charset/collation combination(s) found: ${unexpected.map((row) => `${row.charset}/${row.collation}`).join(', ')}.`,
    );
  }

  console.log(`Column-collation spot check OK (${ASCII_EXCEPTION_COLUMNS.length + UTF8MB4_DEFAULT_COLUMNS.length} column(s) verified, no unexpected charset/collation pairs).`);
}

// PCA_MIGRATION_DATABASE_URL, if set, is a distinct, more-privileged
// migration/provisioning credential, separate from the least-privilege
// runtime credential the application itself uses (PCA_DATABASE_URL, read
// by backend/src/db/pool.ts, which this script never touches). Production
// SHOULD set this to a dedicated credential; local/dev/CI MAY simply not
// set it and collapse both roles onto PCA_DATABASE_URL -- this fallback
// keeps every existing workflow that only sets PCA_DATABASE_URL working
// completely unchanged. The hostname allowlist below is validated against
// whichever URL is actually used, so this disposable-database gate can
// never accidentally run against a non-local/non-Compose host either way.
const connectionString = process.env.PCA_MIGRATION_DATABASE_URL ?? process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL (or PCA_MIGRATION_DATABASE_URL) is required for the disposable database test.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL/PCA_MIGRATION_DATABASE_URL must point to the disposable local/Compose database.');
}

const root = new URL('../migrations/', import.meta.url);
const files = (await readdir(root)).filter((file) => file.endsWith('.sql')).sort();
const connection = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
try {
  await assertSupportedEnvironment(connection);

  for (const file of files) {
    const migration = await readFile(fileURLToPath(new URL(file, root)), 'utf8');
    await connection.query(migration);
    await connection.query('INSERT INTO schema_migrations(version) VALUES (?)', [file]);
  }
  const [rows] = await connection.query(
    `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
  );
  const actual = rows.map((row) => row.table_name).join(',');
  const expected =
    'account_entitlements,billing_commercial_markets,billing_country_market_rules,billing_currencies,billing_disputes,billing_invoice_lines,billing_invoices,billing_payment_attempts,billing_payment_methods,billing_payment_transactions,billing_plans,billing_price_books,billing_provider_events,billing_quotes,billing_refund_operations,billing_refunds,billing_subscriptions,commercial_notifications,complimentary_entitlement_grants,device_challenges,device_protection_status,device_public_keys,devices,enrollment_administration_verifiers,enrollment_bootstrap_attempts,enrollment_invitation_transitions,enrollment_invitations,enrollment_protection_approval_requests,entitlement_activation_idempotency,entitlement_change_request_transitions,entitlement_change_requests,entitlement_defaults,envelope_data_version_ledger,envelope_message_idempotency_ledger,envelope_replay_ledger,eye_protection_settings,families,family_audit_events,family_authority_attestations,family_authority_chain_heads,family_authority_genesis_anchors,family_child_memberships,family_member_invitations,family_rbac_policy_config,licenses,managed_device_slot_reservations,parent_account_preferences,parent_accounts,parent_email_verification_codes,parent_password_reset_codes,platform_admin_accounts,platform_admin_audit_events,platform_admin_login_attempts,platform_admin_mfa_state,platform_admin_role_assignments,platform_admin_security_alerts,platform_admin_sessions,platform_admin_settings,platform_admin_step_up_sessions,protection_alerts,recovery_envelopes,relay_envelopes,release_current_pointers,release_packages,safe_zones,schema_migrations,security_audit_metadata,service_account_family_scopes,service_accounts,service_sessions,settlement_accounts,settlement_batch_items,settlement_batches,settlement_fx_snapshots,sync_sequence_progress_ledger';
  if (actual !== expected) throw new Error(`Unexpected schema: ${actual}`);

  await assertColumnCollations(connection);

  console.log(`MySQL migration/privacy/environment gate passed (${files.length} migration(s)).`);
} finally {
  await connection.end();
}
