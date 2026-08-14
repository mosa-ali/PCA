// Live-database counterpart to backend/test/billing/schemaPrivacy.test.mjs,
// mirroring backend/test/db/schema-privacy.mysql.test.mjs's pattern
// (constraint 27) but scoped to the billing_* tables this migration
// introduces.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const PROHIBITED_TERMS = [
  'url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation', 'screen_time', 'app_name', 'bundle_id',
  'package_name', 'keyword', 'ip_address',
  // payment-security specific:
  'pan', 'cvv', 'cvc', 'card_verification', 'magnetic', 'track_data', 'chip_data', 'account_number', 'routing_number',
  'api_key', 'api_secret', 'client_secret',
];

// 'entitlement_treatment' legitimately contains "title" ("en-TITLE-ment") and none of the prohibited terms above are true substrings of any other approved billing column -- checked directly below.
const ALLOWED_FALSE_POSITIVE_COLUMNS = new Set(['entitlement_treatment']);

test('MySQL SCHEMA PRIVACY (billing): no billing_* table or column name matches a prohibited privacy/payment-security term', async () => {
  const [[tables], [columns]] = await Promise.all([
    getPool().query(`SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'billing\\_%'`),
    getPool().query(
      `SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name LIKE 'billing\\_%' ORDER BY table_name, column_name`,
    ),
  ]);
  assert.ok(tables.length >= 15, `expected at least 15 billing_* tables, found ${tables.length}`);

  const violations = [];
  for (const { table_name: table } of tables) {
    const lower = table.toLowerCase();
    for (const term of PROHIBITED_TERMS) if (lower.includes(term)) violations.push(`table ${table} matches "${term}"`);
  }
  for (const { table_name: table, column_name: column } of columns) {
    if (ALLOWED_FALSE_POSITIVE_COLUMNS.has(column)) continue;
    const lower = column.toLowerCase();
    for (const term of PROHIBITED_TERMS) if (lower.includes(term)) violations.push(`${table}.${column} matches "${term}"`);
  }
  assert.deepEqual(violations, [], violations.join('; '));
});

test('MySQL SCHEMA PRIVACY (billing): billing_payment_methods has no column capable of holding a PAN/CVV/raw card credential', async () => {
  const [rows] = await getPool().query(
    `SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'billing_payment_methods' ORDER BY column_name`,
  );
  const approved = new Set(['payment_method_id', 'account_ref', 'provider', 'provider_payment_method_ref', 'brand', 'display_label', 'last4', 'expiry_month', 'expiry_year', 'status', 'created_at']);
  const actual = rows.map((r) => r.column_name).sort();
  assert.deepEqual(actual, [...approved].sort());
});

test('MySQL SCHEMA PRIVACY (billing): every billing_* currency_code column foreign-keys into the centralized billing_currencies table', async () => {
  const [rows] = await getPool().query(
    `SELECT table_name AS table_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name LIKE 'billing\\_%' AND column_name = 'currency_code' AND table_name != 'billing_currencies'`,
  );
  const [fkRows] = await getPool().query(
    `SELECT table_name AS table_name FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE() AND referenced_table_name = 'billing_currencies' AND column_name = 'currency_code'`,
  );
  const tablesWithCurrencyColumn = new Set(rows.map((r) => r.table_name));
  const tablesWithFk = new Set(fkRows.map((r) => r.table_name));
  for (const table of tablesWithCurrencyColumn) {
    assert.ok(tablesWithFk.has(table), `${table}.currency_code must FK into billing_currencies`);
  }
});

test.after(async () => {
  await closePool();
});
