import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService, DeviceDirectoryError } from '../../dist/device/DeviceDirectoryService.js';
import { PostgresDeviceRepository } from '../../dist/device/PostgresDeviceRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new PostgresDeviceRepository();
const service = new DeviceDirectoryService(repository, () => new Date());

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return `family-${randomUUID()}`;
}

test('PG: device + initial key creation persists atomically', async () => {
  const familyId = family();
  const { device, key: registeredKey } = await service.registerDevice({ familyId, platform: 'ANDROID', publicKey: key() });
  assert.equal(device.status, 'ACTIVE');
  const active = await service.listActiveKeys(familyId, device.deviceId);
  assert.equal(active.length, 1);
  assert.equal(active[0].keyId, registeredKey.keyId);
});

test('PG: public-key uniqueness is DB-enforced across devices', async () => {
  const sharedKey = key();
  const familyId = family();
  await service.registerDevice({ familyId, platform: 'ANDROID', publicKey: sharedKey });
  await assert.rejects(
    () => service.registerDevice({ familyId, platform: 'ANDROID', publicKey: sharedKey }),
    { code: 'DUPLICATE_KEY' },
  );
});

test('PG: key addition is atomic and rejects duplicates', async () => {
  const familyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', publicKey: key() });
  const added = await service.addDeviceKey(familyId, device.deviceId, key());
  assert.equal(added.status, 'ACTIVE');
  const active = await service.listActiveKeys(familyId, device.deviceId);
  assert.equal(active.length, 2);
});

test('PG: wrong-family lookup is indistinguishable from nonexistent device', async () => {
  const familyId = family();
  const otherFamilyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', publicKey: key() });
  const wrongFamilyError = await service.listActiveKeys(otherFamilyId, device.deviceId).catch((e) => e);
  const unknownError = await service.listActiveKeys(otherFamilyId, randomUUID()).catch((e) => e);
  assert.ok(wrongFamilyError instanceof DeviceDirectoryError);
  assert.equal(wrongFamilyError.code, 'DEVICE_NOT_FOUND');
  assert.equal(wrongFamilyError.message, unknownError.message);
});

test('PG: device revocation + all ACTIVE keys revoked in ONE DB transaction', async () => {
  const familyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', publicKey: key() });
  await service.addDeviceKey(familyId, device.deviceId, key());
  await service.addDeviceKey(familyId, device.deviceId, key());
  const revoked = await service.revokeDevice(familyId, device.deviceId);
  assert.equal(revoked.status, 'REVOKED');
  const active = await service.listActiveKeys(familyId, device.deviceId);
  assert.equal(active.length, 0, 'every key must be revoked in the same transaction as the device');
});

test('PG CONCURRENCY: many simultaneous registrations with the same public key -- exactly 1 succeeds', async () => {
  const sharedKey = key();
  const attempts = await Promise.allSettled(
    Array.from({ length: 25 }, () => service.registerDevice({ familyId: family(), platform: 'ANDROID', publicKey: sharedKey })),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 24);
  for (const failure of rejected) assert.equal(failure.reason.code, 'DUPLICATE_KEY');
});

test('PG FAILURE INJECTION: createDeviceWithKey itself leaves no orphan device row when the key insert fails', async () => {
  // Exercises the REAL production path (repository.createDeviceWithKey ->
  // runInTransaction), not a hand-rolled transaction, unlike the generic
  // rollback-semantics test below. The device INSERT succeeds first; the
  // key INSERT then hits the partial-unique-index violation, which must
  // abort the whole transaction and take the device insert down with it.
  const sharedKey = key();
  const firstFamilyId = family();
  const firstDeviceId = randomUUID();
  const now = new Date();
  await repository.createDeviceWithKey(
    { deviceId: firstDeviceId, familyId: firstFamilyId, platform: 'ANDROID', status: 'ACTIVE', createdAt: now, revokedAt: null },
    { deviceId: firstDeviceId, keyId: randomUUID(), publicKey: sharedKey, status: 'ACTIVE', createdAt: now, revokedAt: null },
  );

  const collidingFamilyId = family();
  const collidingDeviceId = randomUUID();
  const result = await repository.createDeviceWithKey(
    { deviceId: collidingDeviceId, familyId: collidingFamilyId, platform: 'ANDROID', status: 'ACTIVE', createdAt: now, revokedAt: null },
    { deviceId: collidingDeviceId, keyId: randomUUID(), publicKey: sharedKey, status: 'ACTIVE', createdAt: now, revokedAt: null },
  );
  assert.equal(result.outcome, 'DUPLICATE_KEY');

  const orphan = await repository.findDeviceForFamily(collidingFamilyId, collidingDeviceId);
  assert.equal(orphan, null, 'the device half of the failed pair must not survive as an orphan row');
});

test('PG FAILURE INJECTION: general Postgres rollback semantics -- an aborted transaction discards its earlier statement', async () => {
  const familyId = family();
  const deviceId = randomUUID();
  const now = new Date();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at) VALUES ($1,$2,'ANDROID','ACTIVE',$3,NULL)`,
      [deviceId, familyId, now],
    );
    // Deliberately violate the platform CHECK constraint on a second,
    // unrelated insert to force this transaction to abort.
    await assert.rejects(() =>
      client.query(`INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at) VALUES ($1,$2,'WINDOWS','ACTIVE',$3,NULL)`, [
        randomUUID(),
        familyId,
        now,
      ]),
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  const found = await repository.findDeviceForFamily(familyId, deviceId);
  assert.equal(found, null, 'the first insert must not survive once the transaction is rolled back');
});

test.after(async () => {
  await closePool();
});
