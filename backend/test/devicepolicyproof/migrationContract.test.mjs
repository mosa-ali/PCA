import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../migrations/0066_device_policy_application_proofs.sql', import.meta.url), 'utf8');

test('0066 is additive and creates only activation target and short-lived proof ledgers', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS device_policy_activation_targets/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS device_policy_application_proofs/);
  assert.match(migration, /PRIMARY KEY \(device_id\)/);
  assert.match(migration, /PRIMARY KEY \(challenge_id\)/);
  assert.match(migration, /FOREIGN KEY \(device_id\) REFERENCES devices \(device_id\)/);
  assert.match(migration, /FOREIGN KEY \(family_id\) REFERENCES families \(family_id\)/);
  assert.match(migration, /retention_expires_at DATETIME\(3\) NOT NULL/);
  assert.match(migration, /CHECK \(application_result IN \('APPLIED', 'DEGRADED', 'REJECTED'\)\)/);
  assert.doesNotMatch(migration, /INSERT\s+INTO/i, 'migration must not seed or backfill application data');
});

test('0066 retains no policy plaintext and prunes only bounded expired tombstones', () => {
  const proofLedger = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS device_policy_application_proofs'));
  assert.doesNotMatch(proofLedger, /policy_plaintext|rule_contents|safe_zone|coordinates|activity_data|url_domain/i);
  assert.match(migration, /requested_batch_size > 500/);
  assert.match(migration, /retention_expires_at <= UTC_TIMESTAMP\(3\)/);
  assert.match(migration, /DELETE FROM device_policy_application_proofs[\s\S]*?LIMIT requested_batch_size/);
  assert.match(migration, /SQL SECURITY DEFINER/);
});

test('0066 preserves an activated lifecycle fact when proof tombstones are pruned', () => {
  assert.match(migration, /ADD COLUMN activated_at DATETIME\(3\) NULL AFTER paired_at/);
  assert.match(migration, /target_state = 'ACTIVATED'[\s\S]*?canonical_envelope_bytes IS NULL/);
});
