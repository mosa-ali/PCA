import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService, DeviceDirectoryError } from '../../dist/device/DeviceDirectoryService.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceRepository();
const service = new DeviceDirectoryService(repository, () => new Date());

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return `family-${randomUUID()}`;
}

test('MySQL: device + initial key creation persists atomically', async () => {
  const familyId = family();
  const { device, key: registeredKey } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  assert.equal(device.status, 'PAIRING_PENDING');
  const active = await service.listActiveKeys(familyId, device.deviceId);
  assert.equal(active.length, 1);
  assert.equal(active[0].keyId, registeredKey.keyId);
  assert.equal(active[0].keyPurpose, 'DSK');
});

test('MySQL: public-key uniqueness is DB-enforced across devices', async () => {
  const sharedKey = key();
  const familyId = family();
  await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: sharedKey });
  await assert.rejects(
    () => service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: sharedKey }),
    { code: 'DUPLICATE_KEY' },
  );
});

test('MySQL: key addition is atomic and rejects duplicates', async () => {
  const familyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  const added = await service.addDeviceKey(familyId, device.deviceId, key(), 'DEK');
  assert.equal(added.status, 'ACTIVE');
  assert.equal(added.keyPurpose, 'DEK');
  const active = await service.listActiveKeys(familyId, device.deviceId);
  assert.equal(active.length, 2);
});

test('MySQL: wrong-family lookup is indistinguishable from nonexistent device', async () => {
  const familyId = family();
  const otherFamilyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  const wrongFamilyError = await service.listActiveKeys(otherFamilyId, device.deviceId).catch((e) => e);
  const unknownError = await service.listActiveKeys(otherFamilyId, randomUUID()).catch((e) => e);
  assert.ok(wrongFamilyError instanceof DeviceDirectoryError);
  assert.equal(wrongFamilyError.code, 'DEVICE_NOT_FOUND');
  assert.equal(wrongFamilyError.message, unknownError.message);
});

test('MySQL: device revocation + all ACTIVE keys revoked in ONE DB transaction', async () => {
  const familyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await service.addDeviceKey(familyId, device.deviceId, key(), 'DEK');
  await service.addDeviceKey(familyId, device.deviceId, key(), 'DEK');
  const revoked = await service.revokeDevice(familyId, device.deviceId);
  assert.equal(revoked.status, 'REVOKED');
  const active = await service.listActiveKeys(familyId, device.deviceId);
  assert.equal(active.length, 0, 'every key must be revoked in the same transaction as the device');
});

test('MySQL CONCURRENCY: many simultaneous registrations with the same public key -- exactly 1 succeeds', async () => {
  const sharedKey = key();
  const attempts = await Promise.allSettled(
    Array.from({ length: 25 }, () => service.registerDevice({ familyId: family(), platform: 'ANDROID', keyPurpose: 'DSK', publicKey: sharedKey })),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 24);
  for (const failure of rejected) assert.equal(failure.reason.code, 'DUPLICATE_KEY');
});

test('MySQL FAILURE INJECTION: createDeviceWithKey itself leaves no orphan device row when the key insert fails', async () => {
  // Exercises the REAL production path (repository.createDeviceWithKey ->
  // runInTransaction), not a hand-rolled transaction, unlike the generic
  // rollback-semantics test below. The device INSERT succeeds first; the
  // key INSERT then hits the unique-index violation, which must abort the
  // whole transaction and take the device insert down with it.
  const sharedKey = key();
  const firstFamilyId = family();
  const firstDeviceId = randomUUID();
  const now = new Date();
  await repository.createDeviceWithKey(
    { deviceId: firstDeviceId, familyId: firstFamilyId, platform: 'ANDROID', status: 'PAIRING_PENDING', createdAt: now, revokedAt: null, pairedAt: null, pairedByAccountId: null },
    { deviceId: firstDeviceId, keyId: randomUUID(), keyPurpose: 'DSK', publicKey: sharedKey, status: 'ACTIVE', createdAt: now, revokedAt: null },
  );

  const collidingFamilyId = family();
  const collidingDeviceId = randomUUID();
  const result = await repository.createDeviceWithKey(
    { deviceId: collidingDeviceId, familyId: collidingFamilyId, platform: 'ANDROID', status: 'PAIRING_PENDING', createdAt: now, revokedAt: null, pairedAt: null, pairedByAccountId: null },
    { deviceId: collidingDeviceId, keyId: randomUUID(), keyPurpose: 'DSK', publicKey: sharedKey, status: 'ACTIVE', createdAt: now, revokedAt: null },
  );
  assert.equal(result.outcome, 'DUPLICATE_KEY');

  const orphan = await repository.findDeviceForFamily(collidingFamilyId, collidingDeviceId);
  assert.equal(orphan, null, 'the device half of the failed pair must not survive as an orphan row');
});

test('MySQL FAILURE INJECTION: general InnoDB rollback semantics -- an aborted transaction discards its earlier statement', async () => {
  const familyId = family();
  const deviceId = randomUUID();
  const now = new Date();
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at) VALUES (?,?,'ANDROID','ACTIVE',?,NULL)`,
      [deviceId, familyId, now],
    );
    // Deliberately violate the platform CHECK constraint on a second,
    // unrelated insert to force this transaction to abort.
    await assert.rejects(() =>
      conn.query(`INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at) VALUES (?,?,'WINDOWS','ACTIVE',?,NULL)`, [
        randomUUID(),
        familyId,
        now,
      ]),
    );
  } finally {
    await conn.rollback().catch(() => {});
    conn.release();
  }
  const found = await repository.findDeviceForFamily(familyId, deviceId);
  assert.equal(found, null, 'the first insert must not survive once the transaction is rolled back');
});

test('MySQL REVOKED_KEY_REUSE: revoked key material is permanently tombstoned -- same device, different device, different family all rejected', async () => {
  const revokedKey = key();
  const ownerFamilyId = family();
  const { device: owner } = await service.registerDevice({ familyId: ownerFamilyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: revokedKey });
  await service.revokeDevice(ownerFamilyId, owner.deviceId);

  // Same device (would need a new device since it's revoked, so this
  // exercises addDeviceKey against a real, still-active device instead).
  const { device: sameFamilyDevice } = await service.registerDevice({ familyId: ownerFamilyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await assert.rejects(
    () => service.addDeviceKey(ownerFamilyId, sameFamilyDevice.deviceId, revokedKey, 'DEK'),
    { code: 'DUPLICATE_KEY' },
  );

  // Different device, same family, via registerDevice.
  await assert.rejects(
    () => service.registerDevice({ familyId: ownerFamilyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: revokedKey }),
    { code: 'DUPLICATE_KEY' },
  );

  // Different family entirely -- rejected with the same generic error, no cross-family leak.
  const otherFamilyId = family();
  const error = await service.registerDevice({ familyId: otherFamilyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: revokedKey }).catch((e) => e);
  assert.equal(error.code, 'DUPLICATE_KEY');
  assert.equal(error.message, 'This public key is already registered to a device.');
});

test('MySQL REVOCATION_IDEMPOTENCY: repeated device revocation preserves the first revoked_at for both the device and its cascaded keys', async () => {
  const familyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await service.addDeviceKey(familyId, device.deviceId, key(), 'DEK');

  const first = await service.revokeDevice(familyId, device.deviceId);
  await new Promise((resolve) => setTimeout(resolve, 20)); // ensure a real clock delta is observable
  const second = await service.revokeDevice(familyId, device.deviceId);
  assert.equal(second.revokedAt.getTime(), first.revokedAt.getTime());

  const [rows] = await getPool().query(`SELECT revoked_at FROM device_public_keys WHERE device_id = ?`, [device.deviceId]);
  const keyRevokedAt = rows[0].revoked_at.getTime();
  await service.revokeDevice(familyId, device.deviceId); // third, redundant call
  const [rowsAgain] = await getPool().query(`SELECT revoked_at FROM device_public_keys WHERE device_id = ?`, [device.deviceId]);
  assert.equal(rowsAgain[0].revoked_at.getTime(), keyRevokedAt);
});

test('MySQL REVOCATION_IDEMPOTENCY: repeated single-key revocation preserves the first revoked_at', async () => {
  const familyId = family();
  const { device, key: registeredKey } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  const first = await service.revokeKey(familyId, device.deviceId, registeredKey.keyId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await service.revokeKey(familyId, device.deviceId, registeredKey.keyId);
  assert.equal(second.revokedAt.getTime(), first.revokedAt.getTime());
});

test('MySQL CONCURRENCY: many genuinely simultaneous device-revocation calls converge on one winning revoked_at, not a sequential-only guarantee', async () => {
  const familyId = family();
  const { device } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await service.addDeviceKey(familyId, device.deviceId, key(), 'DEK');

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.revokeDevice(familyId, device.deviceId)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'repeated revocation must never be a hard error, even racing');
  const timestamps = new Set(attempts.map((a) => a.value.revokedAt.getTime()));
  assert.equal(timestamps.size, 1, 'every concurrent caller must observe the same single winning revocation instant');

  const [rows] = await getPool().query(`SELECT DISTINCT revoked_at FROM device_public_keys WHERE device_id = ?`, [device.deviceId]);
  assert.equal(rows.length, 1, 'the cascaded keys must also agree on exactly one revocation instant under real concurrency');
});

test('MySQL CONCURRENCY: many genuinely simultaneous single-key revocation calls converge on one winning revoked_at', async () => {
  const familyId = family();
  const { device, key: registeredKey } = await service.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.revokeKey(familyId, device.deviceId, registeredKey.keyId)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  const timestamps = new Set(attempts.map((a) => a.value.revokedAt.getTime()));
  assert.equal(timestamps.size, 1, 'every concurrent caller must observe the same single winning revocation instant');
});

test.after(async () => {
  await closePool();
});
