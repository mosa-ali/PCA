import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// WAVE 6B FIRST_DEVICE_BOOTSTRAP_MIGRATION_SAFETY: proves migration
// 0062_first_device_trust_root_bootstrap.sql is safe to apply against a
// deployment already migrated through 0061 -- i.e. the ceremony table does
// not exist yet, family_authority_genesis_anchors has no signature_scheme
// column, and parent_mfa_step_up_grants still carries the pre-0062
// 17-operation CHECK -- and that applying it there (a) creates the table,
// (b) adds the discriminator column with the PCA_FAMILY_AUTHORITY_GENESIS_V1
// default for EVERY pre-existing anchor row (no rewrite, no loss), (c)
// widens the operation CHECK without touching existing grants, and (d) is
// replay-safe: applying the same real file content again is a no-op.
//
// This file manages its own raw connection and schema state (simulating the
// pre-0062 shape of exactly the three objects 0062 touches, via the REAL
// migration file content -- never a fixture) rather than using the shared
// application pool. See the host-safety check below, matching
// scripts/verify-mysql.mjs's identical guard against ever running this
// against a non-disposable database. There is deliberately NO end-of-suite
// reshape back: the replay leaves all three objects in the real migrated
// shape that the sibling ceremony suite shares (this file leaves every
// object in the real migrated shape whatever order the lane runs it in).

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');
const connectionString = process.env.PCA_DATABASE_URL;
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL must point to the disposable local/Compose database.');
}

const MIGRATION_0062_PATH = fileURLToPath(
  new URL('../../migrations/0062_first_device_trust_root_bootstrap.sql', import.meta.url),
);

// The EXACT pre-0062 operation list (0055's widening): 0062's list minus the
// new first-device marker. Restoring this list is how the pre-0062 state is
// simulated; nothing here is invented.
const PRE_0062_OPERATIONS = [
  'BILLING_CHECKOUT_CREATE',
  'FAMILY_COMMERCIAL_REQUEST_CREATE',
  'FAMILY_COMMERCIAL_REQUEST_CANCEL',
  'FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL',
  'FAMILY_COMMERCIAL_AUTO_RENEW_RESUME',
  'family.member.add',
  'family.member.remove',
  'family.member.role_change',
  'family.member.invitation.revoke',
  'family.device.enrollment.create',
  'family.device.enrollment.revoke',
  'family.retention.update',
  'family.history.export',
  'family.history.delete',
  'family.ownership.transfer',
  'family.recovery.material.reveal',
  'family.security.settings.change',
];

async function readMigration0062() {
  return readFile(MIGRATION_0062_PATH, 'utf8');
}

function openConnection() {
  return mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
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

async function ceremonyTableExists(conn) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'`,
  );
  return Number(rows[0].n) > 0;
}

async function countCeremonyColumns(conn) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'family_first_device_bootstrap_ceremonies'`,
  );
  return Number(rows[0].n);
}

async function signatureSchemeColumn(conn) {
  const [rows] = await conn.query(
    `SELECT is_nullable AS is_nullable, column_default AS column_default
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'family_authority_genesis_anchors'
        AND column_name = 'signature_scheme'`,
  );
  return rows[0] ?? null;
}

/** Simulate "migrated through 0061": 0062's three objects in their pre-0062 shape. */
async function dropToPre0062Shape(conn) {
  await conn.query('DROP TABLE IF EXISTS family_first_device_bootstrap_ceremonies');
  if ((await signatureSchemeColumn(conn)) !== null) {
    await conn.query('ALTER TABLE family_authority_genesis_anchors DROP COLUMN signature_scheme');
  }
  const [checkRows] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.table_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'parent_mfa_step_up_grants'
        AND constraint_name = 'parent_mfa_step_up_grants_operation_check'`,
  );
  if (Number(checkRows[0].n) > 0) {
    await conn.query('ALTER TABLE parent_mfa_step_up_grants DROP CHECK parent_mfa_step_up_grants_operation_check');
  }
  // Sibling suites legitimately leave post-0062-marker fixture rows in this
  // disposable database; the pre-0062 snapshot cannot contain them, so clear
  // them before restoring the pre-0062 CHECK (re-adding the CHECK validates
  // existing rows and would otherwise reject itself). Fixture rows only.
  await conn.query("DELETE FROM parent_mfa_step_up_grants WHERE operation = 'family.device.bootstrap.root'");
  await conn.query(
    `ALTER TABLE parent_mfa_step_up_grants
       ADD CONSTRAINT parent_mfa_step_up_grants_operation_check
       CHECK (operation IN (${PRE_0062_OPERATIONS.map((op) => `'${op}'`).join(', ')}))`,
  );
}

/**
 * Seed representative pre-0062 rows: one anchor (created by the 0011-era
 * shape, no signature_scheme) and one live step-up grant bound to a real
 * family/account pair (the grant table has real foreign keys).
 */
async function seedPre0062Rows(conn, label) {
  const anchorFamilyId = `migration-0062-anchor-${label}-${randomUUID()}`;
  const anchorSignature = 'ab'.repeat(16);
  await conn.query(
    `INSERT INTO family_authority_genesis_anchors
       (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, created_at, signature)
     VALUES (?, ?, ?, ?, 1, NOW(3), ?)`,
    [anchorFamilyId, 'd'.repeat(36), 'k'.repeat(36), 'p'.repeat(87), anchorSignature],
  );

  const serviceAccountId = randomUUID();
  const accountId = randomUUID();
  const familyId = randomUUID();
  const grantTokenHash = randomBytes(32).toString('hex');
  await conn.query(
    `INSERT INTO service_accounts (account_id, account_reference_hash, created_at, disabled_at) VALUES (?, ?, NOW(3), NULL)`,
    [serviceAccountId, randomBytes(32)],
  );
  await conn.query(
    `INSERT INTO families (family_id, family_reference_hash, created_at, status, provisioned_for_account_id)
     VALUES (?, ?, NOW(3), 'ACTIVE', ?)`,
    [familyId, randomBytes(32), accountId],
  );
  await conn.query(
    `INSERT INTO parent_accounts
       (account_id, email_hash, password_hash, status, family_id, service_account_id, free_access_mode, created_at, verified_at, disabled_at)
     VALUES (?, ?, 'migration-0062-probe-placeholder', 'VERIFIED', ?, ?, 'PERPETUAL', NOW(3), NOW(3), NULL)`,
    [accountId, randomBytes(32), familyId, serviceAccountId],
  );
  await conn.query(
    `INSERT INTO parent_mfa_step_up_grants (grant_id, account_id, family_id, operation, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, 'family.device.enrollment.create', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
    [randomUUID(), accountId, familyId, grantTokenHash],
  );

  return { anchorFamilyId, anchorSignature, familyId, accountId, grantTokenHash };
}

/** Direct ceremony-table insert with overridable fields, for CHECK backstop probes. */
function insertCeremonyProbe(conn, overrides = {}) {
  const familyId = overrides.familyId ?? `migration-0062-probe-${randomUUID()}`;
  const values = {
    ceremonyId: randomUUID(),
    familyId,
    deviceId: randomUUID(),
    dskKeyId: randomUUID(),
    dskPublicKey: 'p'.repeat(87),
    dskAlgorithm: 'ECDSA_P256_SHA256',
    purpose: 'PCA_FIRST_DEVICE_BOOTSTRAP_V1',
    challengeId: randomUUID(),
    nonce: 'n'.repeat(43),
    status: 'PENDING',
    outcome: null,
    payloadDigest: null,
    ...overrides,
  };
  return {
    familyId,
    run: () =>
      conn.query(
        `INSERT INTO family_first_device_bootstrap_ceremonies
           (ceremony_id, family_id, device_id, dsk_key_id, dsk_public_key, dsk_algorithm, purpose,
            challenge_id, nonce, expires_at, status, payload_digest, outcome, consumed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 5 MINUTE), ?, ?, ?, NULL, NOW(3), NOW(3))`,
        [
          randomUUID(),
          values.familyId,
          values.deviceId,
          values.dskKeyId,
          values.dskPublicKey,
          values.dskAlgorithm,
          values.purpose,
          values.challengeId,
          values.nonce,
          values.status,
          values.payloadDigest,
          values.outcome,
        ],
      ),
  };
}

test('WAVE 6B MIGRATION_0062_UPGRADE_FROM_0061_SAFETY: applying the real 0062 file to the pre-0062 shape creates the table, backfills the scheme default and widens the operation CHECK', async () => {
  const conn = await openConnection();
  try {
    await dropToPre0062Shape(conn);

    // Pre-state proven, not assumed: no ceremony table, no scheme column,
    // and the new operation is genuinely refused by the old CHECK.
    assert.equal(await ceremonyTableExists(conn), false);
    assert.equal(await signatureSchemeColumn(conn), null);
    const {
      anchorFamilyId,
      anchorSignature,
      familyId: seededFamilyId,
      accountId: seededAccountId,
    } = await seedPre0062Rows(conn, 'upgrade');
    await assert.rejects(
      () =>
        conn.query(
          `INSERT INTO parent_mfa_step_up_grants (grant_id, account_id, family_id, operation, token_hash, created_at, expires_at)
           VALUES (?, ?, ?, 'family.device.bootstrap.root', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
          [randomUUID(), seededAccountId, seededFamilyId, randomBytes(32).toString('hex')],
        ),
      isBackstopRejection,
      "the pre-0062 CHECK must refuse 'family.device.bootstrap.root'",
    );

    // The REAL migration file, applied from the pre-0062 shape.
    await conn.query(await readMigration0062());

    assert.equal(await ceremonyTableExists(conn), true);
    assert.equal(await countCeremonyColumns(conn), 18);
    const schemeColumn = await signatureSchemeColumn(conn);
    assert.ok(schemeColumn, '0062 must add family_authority_genesis_anchors.signature_scheme');
    assert.equal(schemeColumn.is_nullable, 'NO');
    assert.ok(
      String(schemeColumn.column_default).includes('PCA_FAMILY_AUTHORITY_GENESIS_V1'),
      `the scheme default must preserve 0011 semantics, got ${schemeColumn.column_default}`,
    );

    // The pre-existing anchor row is preserved with the documented default.
    const [anchorRows] = await conn.query(
      `SELECT genesis_dsk_public_key AS dsk_public_key, signature AS signature, signature_scheme AS signature_scheme
         FROM family_authority_genesis_anchors WHERE family_id = ?`,
      [anchorFamilyId],
    );
    assert.equal(anchorRows.length, 1, 'no anchor row may be lost by the upgrade');
    assert.equal(anchorRows[0].signature, anchorSignature, 'the signature bytes must be untouched');
    assert.equal(anchorRows[0].dsk_public_key, 'p'.repeat(87));
    assert.equal(anchorRows[0].signature_scheme, 'PCA_FAMILY_AUTHORITY_GENESIS_V1');

    // Existing grants survive the widening, and the new marker is now legal.
    const [grantRows] = await conn.query(
      `SELECT COUNT(*) AS n FROM parent_mfa_step_up_grants WHERE family_id = ? AND operation = 'family.device.enrollment.create'`,
      [seededFamilyId],
    );
    assert.equal(Number(grantRows[0].n), 1, 'the pre-existing grant must survive the widening');
  } finally {
    await conn.end();
  }
});

test('WAVE 6B MIGRATION_0062_REPLAY_SAFETY: applying the same migration file content again is a no-op for all three objects', async () => {
  const conn = await openConnection();
  try {
    const before = await seedPre0062Rows(conn, 'replay');
    const anchorBefore = await conn.query(
      `SELECT signature AS signature, signature_scheme AS signature_scheme FROM family_authority_genesis_anchors WHERE family_id = ?`,
      [before.anchorFamilyId],
    );

    await conn.query(await readMigration0062());
    await conn.query(await readMigration0062());

    assert.equal(await ceremonyTableExists(conn), true);
    assert.equal(await countCeremonyColumns(conn), 18);
    assert.ok((await signatureSchemeColumn(conn)) !== null);

    const anchorAfter = await conn.query(
      `SELECT signature AS signature, signature_scheme AS signature_scheme FROM family_authority_genesis_anchors WHERE family_id = ?`,
      [before.anchorFamilyId],
    );
    assert.deepEqual(
      {
        signature: anchorAfter[0][0].signature,
        signature_scheme: anchorAfter[0][0].signature_scheme,
      },
      {
        signature: anchorBefore[0][0].signature,
        signature_scheme: anchorBefore[0][0].signature_scheme,
      },
      'replaying must not rewrite the scheme discriminator or the signature',
    );

    const [grants] = await conn.query(
      `SELECT COUNT(*) AS n FROM parent_mfa_step_up_grants WHERE family_id = ?`,
      [before.familyId],
    );
    assert.equal(Number(grants[0].n), 1, 'replaying must not lose or duplicate the seeded grant');

    // Post-replay, the widened CHECK still accepts the new marker exactly once.
    await conn.query(
      `INSERT INTO parent_mfa_step_up_grants (grant_id, account_id, family_id, operation, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, 'family.device.bootstrap.root', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
      [randomUUID(), before.accountId, before.familyId, randomBytes(32).toString('hex')],
    );
    const [widened] = await conn.query(
      `SELECT COUNT(*) AS n FROM parent_mfa_step_up_grants WHERE family_id = ? AND operation = 'family.device.bootstrap.root'`,
      [before.familyId],
    );
    assert.equal(Number(widened[0].n), 1);
  } finally {
    await conn.end();
  }
});

test('WAVE 6B MIGRATION_0062_CONSTRAINT_BACKSTOP: the ceremony table rejects every malformed row at the database level and keeps a valid PENDING row', async () => {
  const conn = await openConnection();
  try {
    // A valid PENDING row commits.
    const valid = insertCeremonyProbe(conn, { familyId: `migration-0062-valid-${randomUUID()}` });
    await valid.run();
    const [kept] = await conn.query(
      `SELECT COUNT(*) AS n FROM family_first_device_bootstrap_ceremonies WHERE family_id = ?`,
      [valid.familyId],
    );
    assert.equal(Number(kept[0].n), 1);

    // Each backstop probe uses its own family id; none may leave a row.
    const probes = [
      ['unsupported algorithm', { dskAlgorithm: 'RSA_PSS_SHA256' }],
      ['wrong purpose domain', { purpose: 'PCA_FAMILY_TRUST_ROOT_V1' }],
      ['short nonce', { nonce: 'n'.repeat(42) }],
      ['unknown status', { status: 'BOGUS' }],
      ['non-canonical outcome', { outcome: 'REJECTED' }],
      ['non-hex payload digest', { payloadDigest: 'g'.repeat(64) }],
      ['oversize dsk public key', { dskPublicKey: 'p'.repeat(129) }],
    ];
    for (const [label, overrides] of probes) {
      const probe = insertCeremonyProbe(conn, overrides);
      await assert.rejects(probe.run(), isBackstopRejection, `${label} must be rejected by the database`);
      const [residue] = await conn.query(
        `SELECT COUNT(*) AS n FROM family_first_device_bootstrap_ceremonies WHERE family_id = ?`,
        [probe.familyId],
      );
      assert.equal(Number(residue[0].n), 0, `${label}: a rejected probe may not leave a row behind`);
    }
  } finally {
    await conn.end();
  }
});
