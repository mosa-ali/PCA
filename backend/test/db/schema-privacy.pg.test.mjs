import assert from 'node:assert/strict';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

// Name substrings that would indicate a readable family-monitoring surface
// has crept into the central schema. Checked against every TABLE name and
// every COLUMN name in the schema, not just the ones this persistence slice
// added -- a schema-wide regression guard. Deliberately excludes bare
// fragments like "lat"/"lng" that collide with legitimate words (e.g.
// "platform" contains "lat") -- prefer the fuller, unambiguous form.
const PROHIBITED_TERMS = [
  'url', 'title', 'search', 'location', 'usage', 'policy',
  'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'message_plaintext', 'admin_pin',
  'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation',
  'screen_time', 'app_name', 'bundle_id', 'package_name', 'keyword',
  'content', 'ip_address',
];

// Columns that are allowed to contain the substring "key" only in these
// specific, reviewed, non-secret contexts (opaque public keys / key labels).
const ALLOWED_KEY_COLUMNS = new Set(['public_key', 'key_id', 'signing_key_id', 'key_purpose']);

test('PG SCHEMA PRIVACY: no table or column name matches a prohibited family-monitoring term', async () => {
  const [tables, columns] = await Promise.all([
    getPool().query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`),
    getPool().query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`,
    ),
  ]);
  assert.ok(columns.rows.length > 0, 'sanity check: schema must have columns to inspect');

  const violations = [];
  for (const { table_name: table } of tables.rows) {
    const lower = table.toLowerCase();
    for (const term of PROHIBITED_TERMS) {
      if (lower.includes(term)) violations.push(`table ${table} matches prohibited term "${term}"`);
    }
  }
  for (const { table_name: table, column_name: column } of columns.rows) {
    const lower = column.toLowerCase();
    for (const term of PROHIBITED_TERMS) {
      if (lower.includes(term)) violations.push(`${table}.${column} matches prohibited term "${term}"`);
    }
  }
  assert.deepEqual(violations, [], violations.join('; '));
});

test('PG SCHEMA PRIVACY: any column literally named "*key*" is an allowlisted opaque/public reference, never a private key', async () => {
  const { rows } = await getPool().query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name ILIKE '%key%'`,
  );
  for (const { table_name: table, column_name: column } of rows) {
    assert.ok(
      ALLOWED_KEY_COLUMNS.has(column),
      `${table}.${column} contains "key" but is not on the reviewed allowlist ${[...ALLOWED_KEY_COLUMNS].join(', ')}`,
    );
  }
});

test('PG SCHEMA PRIVACY: ciphertext/opaque-blob columns are BYTEA, never TEXT (no accidental readable storage)', async () => {
  const opaqueColumns = [
    ['relay_envelopes', 'ciphertext'],
    ['recovery_envelopes', 'ciphertext'],
    ['release_packages', 'signed_metadata'],
  ];
  for (const [table, column] of opaqueColumns) {
    const { rows } = await getPool().query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, column],
    );
    assert.equal(rows[0]?.data_type, 'bytea', `${table}.${column} must be BYTEA`);
  }
});

test('PG SCHEMA PRIVACY: no index is built over ciphertext/opaque-blob column content', async () => {
  const { rows } = await getPool().query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public'
      AND (indexdef ILIKE '%ciphertext%' OR indexdef ILIKE '%signed_metadata%')
  `);
  assert.deepEqual(rows, [], 'no index may be built over ciphertext or opaque signed-metadata content');
});

test.after(async () => {
  await closePool();
});
