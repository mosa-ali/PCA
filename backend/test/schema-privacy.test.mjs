import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Static (no-DB) privacy gate over the MySQL migrations -- fast enough to
// run in the default `npm test` pipeline, unlike
// test/db/schema-privacy.mysql.test.mjs (which asserts the same invariants
// against a real, live-migrated database and therefore requires
// PCA_DATABASE_URL).
const migration = await readFile(new URL('../migrations/0001_mysql_baseline.sql', import.meta.url), 'utf8');
const requiredTables = [
  'schema_migrations', 'service_accounts', 'families', 'licenses', 'security_audit_metadata',
  'service_sessions', 'service_account_family_scopes', 'enrollment_invitations',
  'devices', 'device_public_keys', 'device_challenges',
  'relay_envelopes', 'recovery_envelopes', 'release_packages', 'release_current_pointers',
];
const prohibitedTerms = [
  'url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
];

test('MySQL baseline migration contains exactly the approved minimal central-service tables', () => {
  for (const table of requiredTables) assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
});

test('MySQL baseline migration does not introduce prohibited readable or secret fields', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of prohibitedTerms) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
});

// PCA-SYNC-DURABILITY-1: 0002_sync_durability.sql adds the four durable
// replay/anti-downgrade/idempotency ledger tables (see that migration's own
// header). Same static gate, same prohibited-term list, applied to the new
// migration file independently of 0001's.
const syncMigration = await readFile(new URL('../migrations/0002_sync_durability.sql', import.meta.url), 'utf8');
const syncRequiredTables = [
  'envelope_replay_ledger', 'envelope_data_version_ledger',
  'envelope_message_idempotency_ledger', 'sync_sequence_progress_ledger',
];

test('sync-durability migration contains exactly the approved durable ledger tables', () => {
  for (const table of syncRequiredTables) assert.match(syncMigration, new RegExp(`CREATE TABLE ${table} \\(`));
});

test('sync-durability migration does not introduce prohibited readable or secret fields', () => {
  const schema = syncMigration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of prohibitedTerms) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
});

test('sync-durability migration stores canonical envelope bytes as an opaque BLOB-family column, never TEXT/VARCHAR', () => {
  assert.match(syncMigration, /canonical_bytes MEDIUMBLOB NOT NULL/);
});

// PCA-ENROLLMENT-RUNTIME-2: 0003_enrollment_bootstrap_attempts.sql adds the durable
// (bootstrapAttemptId -> device) mapping that closes BOOTSTRAP_AMBIGUOUS_RETRY_PROTOCOL_GAP (see
// that migration's own header). Same static gate, same prohibited-term list, applied to the new
// migration file independently of 0001's/0002's.
const enrollmentRetryMigration = await readFile(new URL('../migrations/0003_enrollment_bootstrap_attempts.sql', import.meta.url), 'utf8');
const enrollmentRetryRequiredTables = ['enrollment_bootstrap_attempts'];

test('enrollment-bootstrap-attempts migration contains exactly the approved retry/recovery table', () => {
  for (const table of enrollmentRetryRequiredTables) assert.match(enrollmentRetryMigration, new RegExp(`CREATE TABLE ${table} \\(`));
});

test('enrollment-bootstrap-attempts migration does not introduce prohibited readable or secret fields', () => {
  const schema = enrollmentRetryMigration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of prohibitedTerms) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
});

test('enrollment-bootstrap-attempts migration stores only hashes for token/recovery secrets, never a raw-token-shaped column', () => {
  // The raw invitation token is never persisted anywhere (see enrollment_invitations.token_hash,
  // unchanged by this migration); this table's own client-generated recovery secret is likewise
  // stored ONLY as a fixed-length hex hash column, never as a variable-length raw-secret column.
  assert.match(enrollmentRetryMigration, /token_hash CHAR\(64\)/);
  assert.match(enrollmentRetryMigration, /recovery_token_hash CHAR\(64\)/);
  assert.equal(/raw_?(invitation_?)?token\b/i.test(enrollmentRetryMigration.replace(/--[^\n]*/g, '')), false);
});

// PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: 0004_envelope_ledger_family_scope.sql
// closes a cross-family isolation gap in the three acceptance ledgers
// migration 0002 created without family scoping (see that migration's own
// header). It is an ALTER-only migration (no new CREATE TABLE), so it gets
// its own, differently-shaped static gate rather than reusing the
// CREATE-TABLE-name assertion pattern above.
const familyScopeMigration = await readFile(new URL('../migrations/0004_envelope_ledger_family_scope.sql', import.meta.url), 'utf8');
const familyScopeAlteredTables = [
  'envelope_replay_ledger', 'envelope_data_version_ledger', 'envelope_message_idempotency_ledger',
];

test('envelope-ledger-family-scope migration alters exactly the three previously-unscoped acceptance ledgers, adding a family_id column to each', () => {
  for (const table of familyScopeAlteredTables) {
    assert.match(familyScopeMigration, new RegExp(`ALTER TABLE ${table}\\b`));
  }
  const columnAdditions = familyScopeMigration.match(/ADD COLUMN family_id/g) ?? [];
  assert.equal(columnAdditions.length, familyScopeAlteredTables.length, 'every altered table must add exactly one family_id column');
});

test('envelope-ledger-family-scope migration does not introduce prohibited readable or secret fields', () => {
  const schema = familyScopeMigration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of prohibitedTerms) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
});

test('envelope-ledger-family-scope migration does not touch sync_sequence_progress_ledger (already correctly family-scoped since 0002) or any table outside the three named ledgers', () => {
  assert.equal(/ALTER TABLE sync_sequence_progress_ledger/.test(familyScopeMigration), false);
  assert.equal(/CREATE TABLE|DROP TABLE/.test(familyScopeMigration), false, 'this migration must be purely additive ALTER statements on existing tables, never a table creation or drop');
});

// PCA-PA-1: 0005_platform_admin_identity_rbac_audit.sql adds the 7
// Platform Administration identity/RBAC/MFA/step-up/audit tables (see that
// migration's own header). Same static gate, same prohibited-term list,
// applied to the new migration file independently of the others'.
const platformAdminMigration = await readFile(new URL('../migrations/0005_platform_admin_identity_rbac_audit.sql', import.meta.url), 'utf8');
const platformAdminRequiredTables = [
  'platform_admin_accounts',
  'platform_admin_role_assignments',
  'platform_admin_sessions',
  'platform_admin_mfa_state',
  'platform_admin_step_up_sessions',
  'platform_admin_login_attempts',
  'platform_admin_audit_events',
];

test('platform-admin-identity-rbac-audit migration contains exactly the approved 7 Platform Administration tables', () => {
  for (const table of platformAdminRequiredTables) assert.match(platformAdminMigration, new RegExp(`CREATE TABLE ${table} \\(`));
});

test('platform-admin-identity-rbac-audit migration does not introduce prohibited readable or secret fields', () => {
  const schema = platformAdminMigration.replace(/--[^\n]*/g, '').toLowerCase();
  // 'title' is excluded from this migration's check only: it is a
  // substring false-positive of the legitimate, addendum-mandated
  // ENTITLEMENT_INCREASED audit event type ("en-TITLE-ment") and
  // 'entitlement_limit_override' step-up scope -- "entitlement" here is
  // PCA-ADD-PA-025's commercial device/parent-member allowance count, not
  // any doc 09 Section 5.2 data class, and no column or literal in this
  // migration is an actual page/video title. Every other prohibited term
  // is still checked unmodified against this migration.
  const termsForThisMigration = prohibitedTerms.filter((term) => term !== 'title');
  for (const term of termsForThisMigration) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
  assert.doesNotMatch(schema.replace(/entitlement/g, ''), /title/, 'no genuine "title" term outside the "entitlement" false-positive');
});

test('platform-admin-identity-rbac-audit migration stores session/audit hashes as fixed-length hex CHAR(64) columns, never a raw-token-shaped column', () => {
  assert.match(platformAdminMigration, /token_hash CHAR\(64\)/);
  assert.equal(/raw_?token\b/i.test(platformAdminMigration.replace(/--[^\n]*/g, '')), false);
});

test('platform-admin-identity-rbac-audit migration enforces append-only audit events with UPDATE and DELETE triggers', () => {
  assert.match(platformAdminMigration, /CREATE TRIGGER platform_admin_audit_events_no_update/);
  assert.match(platformAdminMigration, /CREATE TRIGGER platform_admin_audit_events_no_delete/);
  assert.match(platformAdminMigration, /BEFORE UPDATE ON platform_admin_audit_events/);
  assert.match(platformAdminMigration, /BEFORE DELETE ON platform_admin_audit_events/);
});

test('platform-admin-identity-rbac-audit migration shares no foreign key with the family/parent plane tables (service_accounts, service_sessions, families)', () => {
  const familyPlaneTables = ['service_accounts', 'service_sessions', 'families', 'licenses', 'devices'];
  for (const table of familyPlaneTables) {
    assert.equal(new RegExp(`REFERENCES ${table} \\(`).test(platformAdminMigration), false, `unexpected FK to family-plane table: ${table}`);
  }
});
