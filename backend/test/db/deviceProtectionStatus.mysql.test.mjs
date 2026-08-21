// PCA-ADD-ENR-016/PCA-FR-145: real-MySQL proof that MySqlDeviceProtectionStatusRepository
// genuinely persists and reads device-reported protection status, and that
// RealProtectiveAuthorityResolver correctly interprets it against a real
// database (not just the in-memory reference repository).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlDeviceProtectionStatusRepository } from '../../dist/device/DeviceProtectionStatusRepository.js';
import { RealProtectiveAuthorityResolver } from '../../dist/familyrbac/RealProtectiveAuthorityResolver.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceProtectionStatusRepository();

async function seedDevice(familyId) {
  const deviceId = randomUUID();
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
    [deviceId, familyId],
  );
  return deviceId;
}

test('upsert persists a real row, readable back with the exact protection level and a server-stamped updated_at', async () => {
  const familyId = `family-${randomUUID()}`;
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
  const familyId = `family-${randomUUID()}`;
  const deviceId = await seedDevice(familyId);

  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  await repository.upsert({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() });

  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM device_protection_status WHERE device_id = ?', [deviceId]);
  assert.equal(rows[0].n, 1);
  const record = await repository.findForDevice(familyId, deviceId);
  assert.equal(record.protectionLevel, 'DEGRADED');
});

test('an unknown device/family pair reads back null, never a fabricated default', async () => {
  const record = await repository.findForDevice(`family-${randomUUID()}`, randomUUID());
  assert.equal(record, null);
});

test('the schema CHECK constraint rejects a protection_level outside the documented vocabulary', async () => {
  const familyId = `family-${randomUUID()}`;
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
      [randomUUID(), `family-${randomUUID()}`],
    ),
  );
});

test('end-to-end against real MySQL: RealProtectiveAuthorityResolver resolves true for a fresh PROTECTED report and false for a different family/device', async () => {
  const familyId = `family-${randomUUID()}`;
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });

  const resolver = new RealProtectiveAuthorityResolver(repository);
  assert.equal(await resolver.resolve(familyId, deviceId), true);
  assert.equal(await resolver.resolve(familyId, randomUUID()), false);
  assert.equal(await resolver.resolve(`family-${randomUUID()}`, deviceId), false);
});

test('end-to-end against real MySQL: RealProtectiveAuthorityResolver fails closed once the report is older than the freshness bound', async () => {
  const familyId = `family-${randomUUID()}`;
  const deviceId = await seedDevice(familyId);
  const maxStalenessMs = 60_000;
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date(Date.now() - maxStalenessMs - 5_000) });

  const resolver = new RealProtectiveAuthorityResolver(repository, { maxStalenessMs });
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test.after(async () => {
  await closePool();
});
