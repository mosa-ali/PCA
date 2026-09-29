import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// WAVE-5A FAMILY_TRUST_SET_EPOCH_MIGRATION_SAFETY: proves migration
// 0060_family_trust_set_epoch_persistence.sql is safe to apply against a
// deployment already migrated through 0059 -- i.e. the two tables it owns
// simply do not exist yet -- is replay-safe (CREATE TABLE IF NOT EXISTS),
// enforces its CHECK backstops at the database level, and never rewrites or
// loses an existing signed-epoch row when it is applied again.
//
// This file manages its own raw connection and schema state (dropping and
// recreating ONLY the two tables migration 0060 owns, via the REAL migration
// file content -- never a fixture) rather than using the shared application
// pool. See the host-safety check below, matching scripts/verify-mysql.mjs's
// identical guard against ever running this against a non-disposable
// database. There is deliberately NO end-of-suite DROP: replay leaves the two
// tables in the real migrated schema shape (the same "restore, don't remove"
// pattern migrationUpgradeSafety.mysql.test.mjs uses), which later tests in
// the same disposable DB -- familyTrustSetEpochPersistence.mysql.test.mjs --
// depend on.

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');
const connectionString = process.env.PCA_DATABASE_URL;
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL must point to the disposable local/Compose database.');
}

const MIGRATION_0060_PATH = fileURLToPath(new URL('../../migrations/0060_family_trust_set_epoch_persistence.sql', import.meta.url));

const INSERT_COLUMNS =
  '(family_id, trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id, issued_at, received_at)';

async function readMigration0060() {
  return readFile(MIGRATION_0060_PATH, 'utf8');
}

async function existingTrustSetTables(conn) {
  const [rows] = await conn.query(
    `SELECT table_name AS table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN ('family_trust_set_epochs', 'family_epoch_floors')
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

function insertTrustSetEpochRow(
  conn,
  {
    familyId,
    trustSetEpoch = 1,
    keyEpoch = 1,
    supersedesEpoch = null,
    bytes = Buffer.from('probe-bytes'),
    signature = 'ab'.repeat(8),
    signerKeyId = `key-${randomUUID()}`,
    signerDeviceId = `device-${randomUUID()}`,
  },
) {
  return conn.query(
    `INSERT INTO family_trust_set_epochs ${INSERT_COLUMNS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [familyId, trustSetEpoch, keyEpoch, supersedesEpoch, bytes, signature, signerKeyId, signerDeviceId],
  );
}

function isBackstopRejection(error) {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');
  assert.ok(
    ['ER_CHECK_CONSTRAINT_VIOLATED', 'ER_DATA_TOO_LONG'].includes(code) || /Check constraint|Data too long/i.test(message),
    `expected a CHECK-constraint or data-too-long rejection, got ${code || '(no error code)'}: ${message}`,
  );
  return true;
}

test('WAVE-5A MIGRATION_0060_UPGRADE_FROM_0059_SAFETY: dropping to a pre-0060 shape and applying the real migration file creates both tables with exactly 10 + 4 columns', async () => {
  const conn = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
  try {
    // 1. Simulate "migrated through 0059, never yet run 0060": the two
    // tables 0060 owns must simply not exist.
    await conn.query('DROP TABLE IF EXISTS family_trust_set_epochs');
    await conn.query('DROP TABLE IF EXISTS family_epoch_floors');

    // 2. Apply the REAL migration file content -- must succeed from 0059.
    await conn.query(await readMigration0060());

    assert.deepEqual(await existingTrustSetTables(conn), ['family_epoch_floors', 'family_trust_set_epochs']);

    const [columns] = await conn.query(
      `SELECT table_name AS table_name, COUNT(*) AS column_count
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name IN ('family_trust_set_epochs', 'family_epoch_floors')
        GROUP BY table_name
        ORDER BY table_name`,
    );
    assert.deepEqual(
      columns.map((row) => ({ table: row.table_name, columns: Number(row.column_count) })),
      [
        { table: 'family_epoch_floors', columns: 4 },
        { table: 'family_trust_set_epochs', columns: 10 },
      ],
    );
  } finally {
    await conn.end();
  }
});

test('WAVE-5A MIGRATION_0060_REPLAY_SAFETY: applying the same migration file content again is a no-op and both tables still exist', async () => {
  const conn = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
  try {
    assert.deepEqual(
      await existingTrustSetTables(conn),
      ['family_epoch_floors', 'family_trust_set_epochs'],
      'the upgrade test must have created both tables first',
    );
    await conn.query(await readMigration0060());
    assert.deepEqual(await existingTrustSetTables(conn), ['family_epoch_floors', 'family_trust_set_epochs']);
  } finally {
    await conn.end();
  }
});

test('WAVE-5A MIGRATION_0060_CONSTRAINT_BACKSTOP: invalid epochs, a bad supersedes pairing, and an oversize signature are all rejected by the database', async () => {
  const conn = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
  try {
    const familyId = `migration-0060-probe-${randomUUID()}`;

    await assert.rejects(
      () => insertTrustSetEpochRow(conn, { familyId, trustSetEpoch: 0 }),
      isBackstopRejection,
      'trust_set_epoch = 0 must violate family_trust_set_epochs_trust_set_epoch_check',
    );
    await assert.rejects(
      () => insertTrustSetEpochRow(conn, { familyId, keyEpoch: 0 }),
      isBackstopRejection,
      'key_epoch = 0 must violate family_trust_set_epochs_key_epoch_check',
    );
    await assert.rejects(
      () => insertTrustSetEpochRow(conn, { familyId, trustSetEpoch: 5, supersedesEpoch: 5 }),
      isBackstopRejection,
      'supersedes_epoch = trust_set_epoch must violate family_trust_set_epochs_supersedes_check',
    );
    await assert.rejects(
      () => insertTrustSetEpochRow(conn, { familyId, signature: 'a'.repeat(513) }),
      isBackstopRejection,
      'a 513-char signature must be rejected (data-too-long or the 1..512 CHECK)',
    );

    const [[probe]] = await conn.query(
      `SELECT COUNT(*) AS row_count FROM family_trust_set_epochs WHERE family_id = ?`,
      [familyId],
    );
    assert.equal(probe.row_count, 0, 'none of the rejected probes may leave a row behind');
  } finally {
    await conn.end();
  }
});

test('WAVE-5A MIGRATION_0060_ROW_PRESERVATION: replaying the migration preserves an existing signed-epoch row unchanged', async () => {
  const conn = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
  try {
    const familyId = `migration-0060-preserve-${randomUUID()}`;
    const signature = 'ab'.repeat(32);
    const bytes = Buffer.from('signed-epoch-representative-bytes');
    const signerKeyId = `key-${randomUUID()}`;
    const signerDeviceId = `device-${randomUUID()}`;

    await conn.query(
      `INSERT INTO family_trust_set_epochs ${INSERT_COLUMNS} VALUES (?, 1, 1, NULL, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [familyId, bytes, signature, signerKeyId, signerDeviceId],
    );

    await conn.query(await readMigration0060());

    const [rows] = await conn.query(
      `SELECT family_id AS family_id, trust_set_epoch AS trust_set_epoch, key_epoch AS key_epoch,
              supersedes_epoch AS supersedes_epoch, OCTET_LENGTH(signed_epoch_bytes) AS byte_length,
              signature AS signature, signer_key_id AS signer_key_id, signer_device_id AS signer_device_id,
              signed_epoch_bytes AS signed_epoch_bytes
         FROM family_trust_set_epochs
        WHERE family_id = ?`,
      [familyId],
    );
    assert.equal(rows.length, 1, 'replaying the migration must not lose or duplicate the signed-epoch row');

    const row = rows[0];
    assert.equal(row.family_id, familyId);
    assert.equal(Number(row.trust_set_epoch), 1);
    assert.equal(Number(row.key_epoch), 1);
    assert.equal(row.supersedes_epoch, null);
    assert.equal(Number(row.byte_length), bytes.length);
    assert.equal(row.signature, signature);
    assert.equal(row.signer_key_id, signerKeyId);
    assert.equal(row.signer_device_id, signerDeviceId);
    assert.ok(Buffer.from(row.signed_epoch_bytes).equals(bytes), 'signed_epoch_bytes must be byte-for-byte unchanged');
  } finally {
    await conn.end();
  }
});
