import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0020_parent_preferences_safe_zones.sql', import.meta.url), 'utf8');

test('0020 creates only parent preference and safe-zone policy tables', () => {
  assert.match(migration, /CREATE TABLE parent_account_preferences/);
  assert.match(migration, /CREATE TABLE safe_zones/);
  assert.doesNotMatch(migration, /message_payload|movement_history|location_history|gps_trace|raw_token|password|private_key|child_content/i);
});

test('0020 keeps safe-zone metadata bounded and delivery state explicit', () => {
  assert.match(migration, /child_profile_id VARCHAR\(128\) NOT NULL/);
  assert.match(migration, /radius_meters INT UNSIGNED NOT NULL/);
  assert.match(migration, /delivery_state VARCHAR\(24\) NOT NULL DEFAULT 'PENDING_OFFLINE'/);
  assert.match(migration, /CHECK \(delivery_state IN \('PENDING_OFFLINE', 'READY'\)\)/);
  assert.match(migration, /KEY safe_zones_family_child_idx \(family_id, child_profile_id\)/);
});
