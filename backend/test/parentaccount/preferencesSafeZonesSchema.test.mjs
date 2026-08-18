import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0020_parent_preferences_safe_zones.sql', import.meta.url), 'utf8');

test('0020 creates only parent preference and safe-zone policy tables', () => {
  assert.match(migration, /CREATE TABLE parent_account_preferences/);
  assert.match(migration, /CREATE TABLE safe_zones/);
  assert.doesNotMatch(migration, /message_payload|movement_history|location_history|gps_trace|raw_token|password|private_key|child_content/i);
});

test('0020 keeps parent email destination fail-closed and safe-zone policy opaque', () => {
  assert.match(migration, /email_destination VARCHAR\(320\) NULL/);
  assert.match(migration, /email_destination_state VARCHAR\(16\) NOT NULL DEFAULT 'UNVERIFIED'/);
  assert.match(migration, /email_destination_state IN \('UNVERIFIED', 'VERIFIED'\)/);
  assert.match(migration, /recipient_endpoint_id VARCHAR\(128\) NOT NULL/);
  assert.match(migration, /ciphertext MEDIUMBLOB NOT NULL/);
  assert.match(migration, /nonce VARBINARY\(64\) NOT NULL/);
  assert.match(migration, /key_epoch INT UNSIGNED NOT NULL/);
  assert.doesNotMatch(migration, /safe_zones[\s\S]*enabled TINYINT|safe_zones_enabled_check/);
  assert.match(migration, /delivery_state VARCHAR\(24\) NOT NULL DEFAULT 'PENDING_OFFLINE'/);
  assert.match(migration, /CHECK \(delivery_state IN \('PENDING_OFFLINE', 'READY'\)\)/);
  assert.match(migration, /KEY safe_zones_family_recipient_idx \(family_id, recipient_endpoint_id\)/);
  assert.doesNotMatch(migration, /child_profile_id|label VARCHAR|latitude|longitude|radius_meters/i);
});
