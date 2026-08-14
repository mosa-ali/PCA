// Live-database counterpart to test/commercialnotifications/schemaPrivacy.test.mjs,
// mirroring test/db/billingCoreSchemaPrivacy.mysql.test.mjs's pattern but
// scoped to migration 0012's single commercial_notifications table.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const PROHIBITED_TERMS = [
  'url', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation', 'screen_time', 'app_name', 'bundle_id',
  'package_name', 'keyword', 'ip_address',
  'pan', 'cvv', 'cvc', 'card_verification', 'magnetic', 'track_data', 'chip_data', 'account_number', 'routing_number',
  'api_key', 'api_secret', 'client_secret',
];

test('MySQL SCHEMA PRIVACY (commercial notifications): commercial_notifications carries no column matching a prohibited privacy/payment-security term', async () => {
  const [columns] = await getPool().query(
    `SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'commercial_notifications' ORDER BY column_name`,
  );
  assert.ok(columns.length > 0, 'commercial_notifications table not found');
  const violations = [];
  for (const { column_name: column } of columns) {
    const lower = column.toLowerCase();
    for (const term of PROHIBITED_TERMS) if (lower.includes(term)) violations.push(`commercial_notifications.${column} matches "${term}"`);
  }
  assert.deepEqual(violations, [], violations.join('; '));
});

test('MySQL SCHEMA PRIVACY (commercial notifications): exactly the approved column set, nothing more', async () => {
  const [rows] = await getPool().query(
    `SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'commercial_notifications' ORDER BY column_name`,
  );
  const approved = new Set([
    'notification_id', 'account_ref', 'event_type', 'dedupe_key', 'resource_ref', 'message_key', 'params_json',
    'created_at', 'read_at', 'acknowledged_at',
  ]);
  assert.deepEqual(rows.map((r) => r.column_name).sort(), [...approved].sort());
});

test('MySQL SCHEMA PRIVACY (commercial notifications): dedupe_key carries a real UNIQUE index at the DB level', async () => {
  const [rows] = await getPool().query(
    `SELECT DISTINCT index_name AS index_name FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'commercial_notifications' AND column_name = 'dedupe_key' AND non_unique = 0`,
  );
  assert.ok(rows.length > 0, 'no UNIQUE index found on commercial_notifications.dedupe_key');
});

test('MySQL SCHEMA PRIVACY (commercial notifications): shares no foreign key with any other table', async () => {
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND table_name = 'commercial_notifications' AND referenced_table_name IS NOT NULL`,
  );
  assert.equal(Number(rows[0].n), 0, 'commercial_notifications must not carry any FOREIGN KEY');
});

test.after(async () => {
  await closePool();
});
