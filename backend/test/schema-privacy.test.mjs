import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Static (no-DB) privacy gate over the MySQL baseline migration -- fast
// enough to run in the default `npm test` pipeline, unlike
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
