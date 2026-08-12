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
