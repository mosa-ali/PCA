import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// PCA-17E MIGRATION_0004_EXISTING_ROW_UPGRADE_SAFETY: proves migration
// 0004_envelope_ledger_family_scope.sql is safe to apply against a
// deployment that has already run 0002/0003 and taken REAL traffic --
// i.e. the three acceptance ledgers are NON-EMPTY at the moment 0004 runs
// -- not merely against the always-empty fresh database every other
// db-test-suite run exercises (scripts/verify-mysql.mjs's zero-to-latest
// gate, run as part of `npm run test:db` before this file). Before this
// lane, 0004's ALTER TABLE ... ADD COLUMN family_id ... NOT NULL had no
// answer for existing rows with no trustworthy family attribution; this
// test seeds representative non-empty rows in the PRE-0004 (0002) schema
// shape, applies the corrected 0004 migration, and asserts it succeeds
// deterministically with no fabricated family_id anywhere.
//
// This file manages its own raw connection and schema state (dropping and
// recreating only the three legacy ledger tables in their pre-0004 shape)
// rather than using the shared application pool -- see the host-safety
// check below, matching scripts/verify-mysql.mjs's identical guard against
// ever running this against a non-disposable database.

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');
const connectionString = process.env.PCA_DATABASE_URL;
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL must point to the disposable local/Compose database.');
}

const MIGRATION_0004_PATH = fileURLToPath(new URL('../../migrations/0004_envelope_ledger_family_scope.sql', import.meta.url));

// Exact pre-0004 (0002_sync_durability.sql) DDL for the three tables this
// migration re-keys -- what a real deployment's schema looks like the
// moment before 0004 is applied.
const PRE_0004_REPLAY_LEDGER_DDL = `
CREATE TABLE envelope_replay_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_key_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  sequence_or_nonce VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY envelope_replay_ledger_sender_sequence_key (sender_key_id, sequence_or_nonce),
  KEY envelope_replay_ledger_sender_id_idx (sender_key_id, id),
  CONSTRAINT envelope_replay_ledger_sender_key_id_check CHECK (CHAR_LENGTH(sender_key_id) BETWEEN 1 AND 128),
  CONSTRAINT envelope_replay_ledger_sequence_or_nonce_check CHECK (CHAR_LENGTH(sequence_or_nonce) BETWEEN 1 AND 128)
) ENGINE=InnoDB`;

const PRE_0004_VERSION_LEDGER_DDL = `
CREATE TABLE envelope_data_version_ledger (
  sender_key_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  last_accepted_version VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (sender_key_id),
  CONSTRAINT envelope_data_version_ledger_sender_key_id_check CHECK (CHAR_LENGTH(sender_key_id) BETWEEN 1 AND 128),
  CONSTRAINT envelope_data_version_ledger_version_check
    CHECK (last_accepted_version REGEXP '^(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)$')
) ENGINE=InnoDB`;

const PRE_0004_IDEMPOTENCY_LEDGER_DDL = `
CREATE TABLE envelope_message_idempotency_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  canonical_bytes MEDIUMBLOB NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY envelope_message_idempotency_ledger_message_id_key (message_id),
  CONSTRAINT envelope_message_idempotency_ledger_message_id_check CHECK (CHAR_LENGTH(message_id) BETWEEN 1 AND 128)
) ENGINE=InnoDB`;

test('PCA-17E MIGRATION_0004_EXISTING_ROW_UPGRADE_SAFETY: migration 0004 succeeds deterministically against a live-populated pre-0004 (0002) schema, with no fabricated family_id', async () => {
  const conn = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
  try {
    // 1. Recreate the three legacy tables in their EXACT pre-0004 shape --
    // simulates "migrated through 0003, never yet run 0004."
    await conn.query('DROP TABLE IF EXISTS envelope_replay_ledger');
    await conn.query('DROP TABLE IF EXISTS envelope_data_version_ledger');
    await conn.query('DROP TABLE IF EXISTS envelope_message_idempotency_ledger');
    await conn.query(PRE_0004_REPLAY_LEDGER_DDL);
    await conn.query(PRE_0004_VERSION_LEDGER_DDL);
    await conn.query(PRE_0004_IDEMPOTENCY_LEDGER_DDL);
    await conn.query(`DELETE FROM schema_migrations WHERE version = '0004_envelope_ledger_family_scope.sql'`);

    // 2. Insert REPRESENTATIVE, NON-EMPTY rows -- real pre-0004 traffic,
    // with no family_id column to draw from.
    const senderA = `sender-legacy-${randomUUID()}`;
    const senderB = `sender-legacy-${randomUUID()}`;
    await conn.query(
      `INSERT INTO envelope_replay_ledger (sender_key_id, sequence_or_nonce, recorded_at) VALUES (?, ?, NOW(3)), (?, ?, NOW(3)), (?, ?, NOW(3))`,
      [senderA, 'seq-1', senderA, 'seq-2', senderB, 'nonce-xyz'],
    );
    await conn.query(
      `INSERT INTO envelope_data_version_ledger (sender_key_id, last_accepted_version, updated_at) VALUES (?, ?, NOW(3)), (?, ?, NOW(3))`,
      [senderA, '4.2.0', senderB, '1.0.0'],
    );
    await conn.query(
      `INSERT INTO envelope_message_idempotency_ledger (message_id, canonical_bytes, recorded_at) VALUES (?, ?, NOW(3)), (?, ?, NOW(3))`,
      [`msg-legacy-${randomUUID()}`, Buffer.from('legacy-canonical-bytes-1'), `msg-legacy-${randomUUID()}`, Buffer.from('legacy-canonical-bytes-2')],
    );

    const preCounts = await Promise.all(
      ['envelope_replay_ledger', 'envelope_data_version_ledger', 'envelope_message_idempotency_ledger'].map(async (table) => {
        const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
        return rows[0].n;
      }),
    );
    assert.deepEqual(preCounts, [3, 2, 2], 'setup sanity: the pre-0004 tables must genuinely be non-empty before the migration runs');

    // 3. Run the REAL, corrected migration 0004 file content -- must
    // succeed deterministically, never throw, never require a fabricated
    // family_id.
    const migrationSql = await readFile(MIGRATION_0004_PATH, 'utf8');
    await conn.query(migrationSql);
    await conn.query(`INSERT INTO schema_migrations (version) VALUES ('0004_envelope_ledger_family_scope.sql')`);

    // 4. Verify: the documented, controlled reset actually happened (no
    // fabricated family_id was ever written for the pre-existing rows --
    // they are gone, not mis-attributed), and the new schema shape is
    // exactly what migration 0004 declares.
    const postCounts = await Promise.all(
      ['envelope_replay_ledger', 'envelope_data_version_ledger', 'envelope_message_idempotency_ledger'].map(async (table) => {
        const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
        return rows[0].n;
      }),
    );
    assert.deepEqual(postCounts, [0, 0, 0], 'the three legacy ledger tables must be genuinely empty after migration 0004 -- no fabricated family_id was ever assigned to a pre-existing row');

    const [replayColumns] = await conn.query(
      `SELECT column_name AS column_name, is_nullable AS is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'envelope_replay_ledger' AND column_name = 'family_id'`,
    );
    assert.equal(replayColumns.length, 1);
    assert.equal(replayColumns[0].is_nullable, 'NO');

    const [versionPk] = await conn.query(
      `SELECT column_name AS column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = 'envelope_data_version_ledger' AND constraint_name = 'PRIMARY' ORDER BY ordinal_position`,
    );
    assert.deepEqual(versionPk.map((r) => r.column_name), ['family_id', 'sender_key_id']);

    const [idempotencyKey] = await conn.query(
      `SELECT column_name AS column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = 'envelope_message_idempotency_ledger' AND constraint_name = 'envelope_message_idempotency_ledger_family_message_key' ORDER BY ordinal_position`,
    );
    assert.deepEqual(idempotencyKey.map((r) => r.column_name), ['family_id', 'message_id']);
  } finally {
    await conn.end();
  }
});

test('PCA-17E MIGRATION_0004_EXISTING_ROW_UPGRADE_SAFETY: after the populated-upgrade, fresh application traffic through the real acceptance pipeline works normally against the newly re-keyed tables', async () => {
  // Re-import AFTER the previous test has run the real migration file, so
  // this exercises the exact live-migrated schema, not a fixture.
  const { SyncCoordinator } = await import('../../dist/familysync/SyncCoordinator.js');
  const { InMemoryPendingQueueStore } = await import('../../dist/familysync/InMemoryPendingQueueStore.js');
  const { MySqlSequenceProgressLedger } = await import('../../dist/familysync/MySqlSequenceProgressLedger.js');
  const { canonicalizeEnvelope } = await import('../../dist/familyenvelope/canonicalize.js');
  const { MySqlReplayLedger } = await import('../../dist/familyenvelope/MySqlReplayLedger.js');
  const { MySqlDataVersionLedger } = await import('../../dist/familyenvelope/MySqlDataVersionLedger.js');
  const { MySqlMessageIdempotencyLedger } = await import('../../dist/familyenvelope/MySqlMessageIdempotencyLedger.js');
  const { closePool } = await import('../../dist/db/pool.js');
  const { createTestOnlyEnvelopeSignatureVerifier, signTestOnlyEnvelope } = await import('../support/testOnlyEnvelopeSignatureVerifier.mjs');

  const SENDER_PUBLIC_KEY = 'sender-public-key-1';
  const familyId = `family-post-upgrade-${randomUUID()}`;
  const unsigned = {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: `msg-${randomUUID()}`,
    familyId,
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: `sender-${randomUUID()}`,
    messageType: 'POLICY_UPDATE',
    sequenceOrNonce: `nonce-${randomUUID()}`,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
    payload: Buffer.from('post-upgrade-payload'),
  };
  const envelope = { ...unsigned, signature: signTestOnlyEnvelope(SENDER_PUBLIC_KEY, canonicalizeEnvelope(unsigned)) };

  const coordinator = new SyncCoordinator(
    new InMemoryPendingQueueStore(),
    new MySqlSequenceProgressLedger(),
    new MySqlReplayLedger(),
    new MySqlDataVersionLedger(),
    new MySqlMessageIdempotencyLedger(),
    createTestOnlyEnvelopeSignatureVerifier(),
    { isNumericSequenceSender: () => false },
  );

  const result = await coordinator.submit(envelope, {
    senderPublicKey: SENDER_PUBLIC_KEY,
    minimumAcceptedTrustSetEpoch: 0,
    minimumAcceptedKeyEpoch: 0,
    familyId,
    now: new Date('2026-01-01T00:30:00.000Z'),
  });
  assert.deepEqual(result.decision, { kind: 'APPLY_NOW', idempotent: false });

  await closePool();
});
