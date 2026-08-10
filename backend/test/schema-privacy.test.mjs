import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../migrations/0001_service_privacy_foundation.sql', import.meta.url), 'utf8');
const requiredTables = ['service_accounts', 'families', 'devices', 'device_public_keys', 'licenses', 'release_metadata', 'security_audit_metadata'];
const prohibitedTerms = ['url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face'];

test('foundation migration contains only the approved minimal service tables', () => {
  for (const table of requiredTables) assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
  assert.doesNotMatch(migration, /CREATE TABLE (enrollment|relay|recovery)_/);
});

test('foundation migration does not introduce prohibited readable or secret fields', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of prohibitedTerms) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
});
