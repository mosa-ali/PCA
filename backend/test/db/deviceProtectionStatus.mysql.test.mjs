// PCA-ADD-ENR-016/PCA-FR-145: real-MySQL proof that MySqlDeviceProtectionStatusRepository
// genuinely persists and reads device-reported protection status, and that
// RealProtectiveAuthorityResolver correctly interprets it against a real
// database (not just the in-memory reference repository).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { MySqlDeviceProtectionStatusRepository } from '../../dist/device/DeviceProtectionStatusRepository.js';
import { RealProtectiveAuthorityResolver } from '../../dist/familyrbac/RealProtectiveAuthorityResolver.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceProtectionStatusRepository();
const deviceRepository = new MySqlDeviceRepository();

async function seedFamily() {
  const familyId = randomUUID();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  return familyId;
}

async function seedDevice(familyId) {
  const deviceId = randomUUID();
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
    [deviceId, familyId],
  );
  return deviceId;
}

test('upsert persists a real row, readable back with the exact protection level and a server-stamped updated_at', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  const before = new Date();

  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: before });
  const record = await repository.findForDevice(familyId, deviceId);

  assert.ok(record);
  assert.equal(record.deviceId, deviceId);
  assert.equal(record.familyId, familyId);
  assert.equal(record.protectionLevel, 'PROTECTED');
});

test('upsert is a true upsert -- reporting a new level overwrites the old one, never appends a second row', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);

  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  await repository.upsert({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() });

  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM device_protection_status WHERE device_id = ?', [deviceId]);
  assert.equal(rows[0].n, 1);
  const record = await repository.findForDevice(familyId, deviceId);
  assert.equal(record.protectionLevel, 'DEGRADED');
});

test('an unknown device/family pair reads back null, never a fabricated default', async () => {
  const record = await repository.findForDevice(randomUUID(), randomUUID());
  assert.equal(record, null);
});

test('the schema CHECK constraint rejects a protection_level outside the documented vocabulary', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at) VALUES (?, ?, 'MADE_UP_LEVEL', NOW(3))`,
      [deviceId, familyId],
    ),
  );
});

test('a device_protection_status row cannot reference a nonexistent device (FK constraint)', async () => {
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at) VALUES (?, ?, 'PROTECTED', NOW(3))`,
      [randomUUID(), randomUUID()],
    ),
  );
});

test('end-to-end against real MySQL: RealProtectiveAuthorityResolver resolves true for a fresh PROTECTED report and false for a different family/device', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });

  const resolver = new RealProtectiveAuthorityResolver(repository);
  assert.equal(await resolver.resolve(familyId, deviceId), true);
  assert.equal(await resolver.resolve(familyId, randomUUID()), false);
  assert.equal(await resolver.resolve(randomUUID(), deviceId), false);
});

test('end-to-end against real MySQL: RealProtectiveAuthorityResolver fails closed once the report is older than the freshness bound', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  const maxStalenessMs = 60_000;
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date(Date.now() - maxStalenessMs - 5_000) });

  const resolver = new RealProtectiveAuthorityResolver(repository, { maxStalenessMs });
  assert.ok(await repository.findForDevice(familyId, deviceId), 'a stale report remains distinguishable from an absent/inactive report');
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test('protective authority immediately fails closed after device revocation despite a fresh PROTECTED report', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  const resolver = new RealProtectiveAuthorityResolver(repository);

  assert.equal(await resolver.resolve(familyId, deviceId), true);
  const revoked = await deviceRepository.revokeDeviceAndKeysAtomically(familyId, deviceId, new Date());
  assert.equal(revoked.outcome, 'REVOKED');
  assert.equal(await repository.findForDevice(familyId, deviceId), null);
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test('protective authority fails closed while the family is suspended or deleted', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  const resolver = new RealProtectiveAuthorityResolver(repository);

  const adminId = randomUUID();
  await getPool().query(
    `INSERT INTO platform_admin_accounts (admin_id, email_hash, display_name, password_credential, status, created_at, disabled_at)
     VALUES (?, ?, 'Device protection test admin', 'test-placeholder', 'ACTIVE', NOW(3), NULL)`,
    [adminId, randomBytes(32)],
  );
  await getPool().query(
    `UPDATE families
        SET status = 'SUSPENDED', suspended_at = NOW(3), suspended_by_admin_id = ?, suspension_reason = 'protection test fixture'
      WHERE family_id = ?`,
    [adminId, familyId],
  );
  assert.equal(await repository.findForDevice(familyId, deviceId), null);
  assert.equal(await resolver.resolve(familyId, deviceId), false);

  await getPool().query(
    `UPDATE families
        SET status = 'ACTIVE', suspended_at = NULL, suspended_by_admin_id = NULL, suspension_reason = NULL, deleted_at = NOW(3)
      WHERE family_id = ?`,
    [familyId],
  );
  assert.equal(await repository.findForDevice(familyId, deviceId), null);
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test('revoke/read interleaving exposes the pre-commit state only until the revocation transaction commits', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() });
  const resolver = new RealProtectiveAuthorityResolver(repository);
  const conn = await getPool().getConnection();

  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3) WHERE device_id = ? AND family_id = ?`, [deviceId, familyId]);

    // The update is still uncommitted: the reader sees the last committed
    // ACTIVE state, then must stop treating the receipt as authoritative
    // immediately after the revocation becomes durable.
    assert.equal(await resolver.resolve(familyId, deviceId), true);
    await conn.commit();
    assert.equal(await resolver.resolve(familyId, deviceId), false);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

test.after(async () => {
  await closePool();
});
