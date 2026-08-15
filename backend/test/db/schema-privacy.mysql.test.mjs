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
// signing_key_id/encryption_key_id/signing_public_key/encryption_public_key
// (enrollment_bootstrap_attempts, PCA-ENROLLMENT-RUNTIME-2) are
// denormalized copies of the same device_public_keys.key_id/public_key
// values already approved here -- opaque references to PUBLIC key rows,
// never private key material.
// idempotency_key (entitlement_activation_idempotency, PCA-PA-2 /
// PCA-ADD-BILL-046) is a durable dedup key DERIVED FROM a payment/provider
// event id -- an opaque request-shaping string, never a cryptographic
// private key or secret.
// open_active_key (billing_price_books, PCA-BILL-1) and active_account_key
// (billing_subscriptions, PCA-BILL-1) are STORED GENERATED columns that
// concatenate non-secret scoping fields (market/currency/device-limit or
// account id) only when the row is the single open/active one -- pure
// DB-enforced uniqueness-invariant strings (via UNIQUE KEY), never
// cryptographic key material.
// genesis_dsk_key_id/genesis_dsk_public_key/owner_dsk_key_id/
// owner_dsk_public_key/signer_dsk_key_id/signer_dsk_public_key
// (family_authority_genesis_anchors/family_authority_attestations,
// PCA-FAMILY-AUTH-1-R1) are the SAME device_public_keys-class PUBLIC
// signing-key id/value pair already approved above, only under the
// genesis/owner/signer role names this package's canonicalize.ts uses --
// no private key material, same review basis as signing_key_id/
// signing_public_key. head_attestation_id (family_authority_chain_heads)
// is a content-addressed lookup id (sha256 of an attestation's canonical
// bytes + signature, see canonicalize.ts computeAttestationId), never key
// material at all. key_epoch (family_authority_attestations) is the
// FamilyTrustSetEpoch.keyEpoch integer lineage counter this attestation
// was issued against (same field/meaning as familytrustset's own
// keyEpoch, already an accepted non-secret integer there) -- a counter,
// not key material.
const ALLOWED_KEY_COLUMNS = new Set([
  'public_key', 'key_id', 'signing_key_id', 'encryption_key_id', 'key_purpose', 'sender_key_id',
  'signing_public_key', 'encryption_public_key', 'idempotency_key',
  'open_active_key', 'active_account_key', 'key_epoch',
  'genesis_dsk_key_id', 'genesis_dsk_public_key', 'owner_dsk_key_id', 'owner_dsk_public_key',
  'signer_dsk_key_id', 'signer_dsk_public_key', 'head_attestation_id',
  // dedupe_key (commercial_notifications, PCA-COMMERCIAL-NOTIFY-1) is a
  // UNIQUE-constrained idempotency key derived from the source commercial
  // event (e.g. PAYMENT_CONFIRMED:<provider_event_row_id>) -- same class as
  // idempotency_key above, never cryptographic key material.
  // message_key (commercial_notifications) is a bounded localization
  // identifier (e.g. "commercial_notification.payment_confirmed") paired
  // with structured params_json -- a lookup key for client-side i18n
  // rendering, never key material of any kind.
  'dedupe_key', 'message_key',
  // setting_key (platform_admin_settings, PCA-ADD-PA-043/044, Writer65) is
  // a bounded, admin-authored logical settings identifier (e.g.
  // "branding.support_email", "payment_provider.stripe_main") -- a lookup
  // key for the generic settings row, never cryptographic key material.
  // Sensitive VALUES stored under a sensitive setting_key are themselves
  // opaque references (never a raw secret, PCA-ADD-BILL-025), masked on
  // every read by PlatformAdminSettingsService -- see that file's header.
  'setting_key',
]);

test('MySQL SCHEMA PRIVACY: no table or column name matches a prohibited family-monitoring term', async () => {
  const [[tables], [columns]] = await Promise.all([
    getPool().query(`SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE()`),
    getPool().query(
      `SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, column_name`,
    ),
  ]);
  assert.ok(columns.length > 0, 'sanity check: schema must have columns to inspect');

  // PCA-PA-2: "title" is dropped from the substring scan below and
  // re-checked separately with the "entitlement" false-positive stripped
  // out first -- the same precedent test/schema-privacy.test.mjs already
  // established for migration 0005 ("en-TITLE-ment" is a substring
  // collision with the addendum-mandated word "entitlement", never an
  // actual page/video title column).
  const scannedTerms = PROHIBITED_TERMS.filter((term) => term !== 'title');

  const violations = [];
  for (const { table_name: table } of tables) {
    const lower = table.toLowerCase();
    for (const term of scannedTerms) {
      if (lower.includes(term)) violations.push(`table ${table} matches prohibited term "${term}"`);
    }
    if (lower.replace(/entitlement/g, '').includes('title')) violations.push(`table ${table} matches prohibited term "title" outside the "entitlement" false-positive`);
  }
  for (const { table_name: table, column_name: column } of columns) {
    const lower = column.toLowerCase();
    for (const term of scannedTerms) {
      if (lower.includes(term)) violations.push(`${table}.${column} matches prohibited term "${term}"`);
    }
    if (lower.replace(/entitlement/g, '').includes('title')) violations.push(`${table}.${column} matches prohibited term "title" outside the "entitlement" false-positive`);
  }
  assert.deepEqual(violations, [], violations.join('; '));
});

test('MySQL SCHEMA PRIVACY: any column literally named "*key*" is an allowlisted opaque/public reference, never a private key', async () => {
  const [rows] = await getPool().query(
    `SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND column_name LIKE '%key%'`,
  );
  for (const { table_name: table, column_name: column } of rows) {
    assert.ok(
      ALLOWED_KEY_COLUMNS.has(column),
      `${table}.${column} contains "key" but is not on the reviewed allowlist ${[...ALLOWED_KEY_COLUMNS].join(', ')}`,
    );
  }
});

test('MySQL SCHEMA PRIVACY: ciphertext/opaque-blob columns are a BLOB family type, never TEXT/VARCHAR (no accidental readable storage)', async () => {
  const opaqueColumns = [
    ['relay_envelopes', 'ciphertext'],
    ['recovery_envelopes', 'ciphertext'],
    ['release_packages', 'signed_metadata'],
    ['envelope_message_idempotency_ledger', 'canonical_bytes'],
  ];
  for (const [table, column] of opaqueColumns) {
    const [rows] = await getPool().query(
      `SELECT data_type AS data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    assert.equal(rows[0]?.data_type, 'mediumblob', `${table}.${column} must be MEDIUMBLOB`);
  }
});

test('MySQL SCHEMA PRIVACY: no index is built over ciphertext/opaque-blob column content', async () => {
  const [rows] = await getPool().query(`
    SELECT DISTINCT table_name, index_name, column_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND column_name IN ('ciphertext', 'signed_metadata', 'canonical_bytes')
  `);
  assert.deepEqual(rows, [], 'no index may be built over ciphertext or opaque signed-metadata content');
});

test.after(async () => {
  await closePool();
});
