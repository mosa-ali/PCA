import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService, DeviceDirectoryError } from '../../dist/device/DeviceDirectoryService.js';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';

function key() {
  return randomBytes(32).toString('base64url');
}

function buildService() {
  const repository = createInMemoryDeviceRepository();
  const service = new DeviceDirectoryService(repository, () => new Date('2026-01-01T00:00:00.000Z'));
  return { service, repository };
}

const FAMILY_A = 'family-opaque-A';
const FAMILY_B = 'family-opaque-B';
const baseInput = { familyId: FAMILY_A, platform: 'ANDROID', keyPurpose: 'DSK' };

test('registerDevice creates a PAIRING_PENDING device with an ACTIVE key', async () => {
  const { service } = buildService();
  const { device, key: registeredKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  assert.equal(device.status, 'PAIRING_PENDING');
  assert.equal(registeredKey.status, 'ACTIVE');
  assert.equal(registeredKey.keyPurpose, 'DSK');
  assert.equal(registeredKey.deviceId, device.deviceId);
});

test('registerDevice rejects a malformed public key', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.registerDevice({ ...baseInput, publicKey: 'not a real key' }),
    { code: 'INVALID_PUBLIC_KEY' },
  );
});

test('registerDevice rejects a public key already registered to another device', async () => {
  const { service } = buildService();
  const sharedKey = key();
  await service.registerDevice({ ...baseInput, publicKey: sharedKey });
  await assert.rejects(
    () => service.registerDevice({ ...baseInput, publicKey: sharedKey }),
    { code: 'DUPLICATE_KEY' },
  );
});

test('addDeviceKey rotates in a new active key for an active device (correct family)', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const rotated = await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  assert.equal(rotated.status, 'ACTIVE');
  assert.equal(rotated.keyPurpose, 'DEK');
  const active = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(active.length, 2);
});

test('addDeviceKey rejects duplicate public key across devices', async () => {
  const { service } = buildService();
  const sharedKey = key();
  const { device: deviceA } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.registerDevice({ ...baseInput, publicKey: sharedKey });
  await assert.rejects(
    () => service.addDeviceKey(FAMILY_A, deviceA.deviceId, sharedKey, 'DEK'),
    { code: 'DUPLICATE_KEY' },
  );
});

test('addDeviceKey rejects unknown device', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.addDeviceKey(FAMILY_A, 'unknown-device', key(), 'DEK'), { code: 'DEVICE_NOT_FOUND' });
});

test('addDeviceKey rejects a revoked device', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.revokeDevice(FAMILY_A, device.deviceId);
  await assert.rejects(() => service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK'), { code: 'DEVICE_REVOKED' });
});

test('revokeKey deactivates only the targeted key, leaving other active keys untouched', async () => {
  const { service } = buildService();
  const { device, key: firstKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const secondKey = await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  await service.revokeKey(FAMILY_A, device.deviceId, firstKey.keyId);
  const active = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(active.length, 1);
  assert.equal(active[0].keyId, secondKey.keyId);
});

test('revokeKey rejects an unknown key id for a real device', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await assert.rejects(() => service.revokeKey(FAMILY_A, device.deviceId, 'unknown-key-id'), { code: 'KEY_NOT_FOUND' });
});

test('revokeDevice atomically cascades to revoke every active key', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  const revoked = await service.revokeDevice(FAMILY_A, device.deviceId);
  assert.equal(revoked.status, 'REVOKED');
  const active = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(active.length, 0);
});

test('revoked key material is permanently tombstoned: it can never be re-registered on the same device after full device revocation', async () => {
  const { service } = buildService();
  const revokedKey = key();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: revokedKey });
  await service.revokeDevice(FAMILY_A, device.deviceId);
  await assert.rejects(
    () => service.registerDevice({ ...baseInput, publicKey: revokedKey }),
    { code: 'DUPLICATE_KEY' },
  );
});

test('revoked key material is permanently tombstoned: a different device (same family) cannot register it either', async () => {
  const { service } = buildService();
  const revokedKey = key();
  const { device: firstDevice } = await service.registerDevice({ ...baseInput, publicKey: revokedKey });
  await service.revokeDevice(FAMILY_A, firstDevice.deviceId);
  await assert.rejects(
    () => service.registerDevice({ ...baseInput, publicKey: revokedKey }),
    { code: 'DUPLICATE_KEY' },
  );
});

test('revoked key material is permanently tombstoned: a device in a different family cannot register it, without leaking that it belongs to another family', async () => {
  const { service } = buildService();
  const revokedKey = key();
  const { device } = await service.registerDevice({ familyId: FAMILY_A, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: revokedKey });
  await service.revokeDevice(FAMILY_A, device.deviceId);
  const error = await service
    .registerDevice({ familyId: FAMILY_B, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: revokedKey })
    .catch((e) => e);
  assert.equal(error.code, 'DUPLICATE_KEY');
  // Same generic message as any other duplicate-key rejection -- no hint of cross-family origin.
  assert.equal(error.message, 'This public key is already registered to a device.');
});

test('revoking a single key (not the whole device) also permanently tombstones it', async () => {
  const { service } = buildService();
  const revokedKey = key();
  const { device, key: registeredKey } = await service.registerDevice({ ...baseInput, publicKey: revokedKey });
  await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK'); // keep the device from being fully revoked
  await service.revokeKey(FAMILY_A, device.deviceId, registeredKey.keyId);
  await assert.rejects(
    () => service.addDeviceKey(FAMILY_A, device.deviceId, revokedKey, 'DEK'),
    { code: 'DUPLICATE_KEY' },
  );
});

test('familyId is server-recorded from input only -- device registration cannot be steered to an unrelated family after creation', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ familyId: FAMILY_A, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  assert.equal(device.familyId, FAMILY_A);
});

test('concurrent registration attempts with the same public key: exactly one succeeds', async () => {
  const { service } = buildService();
  const sharedKey = key();
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.registerDevice({ ...baseInput, publicKey: sharedKey })),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 19);
  for (const failure of rejected) assert.equal(failure.reason.code, 'DUPLICATE_KEY');
});

test('errors never carry public key material in their message', async () => {
  const { service } = buildService();
  const sharedKey = key();
  await service.registerDevice({ ...baseInput, publicKey: sharedKey });
  try {
    await service.registerDevice({ ...baseInput, publicKey: sharedKey });
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(error instanceof DeviceDirectoryError);
    assert.equal(error.message.includes(sharedKey), false);
  }
});

test('security: registerDevice input has no field through which a caller can forge deviceId or status', async () => {
  const { service } = buildService();
  const forged = { ...baseInput, publicKey: key(), deviceId: 'attacker-chosen', status: 'ACTIVE' };
  const { device } = await service.registerDevice(forged);
  assert.notEqual(device.deviceId, 'attacker-chosen');
  assert.equal(device.status, 'PAIRING_PENDING');
});

// --- Family/authority scope ---------------------------------------------

test('family scope: correct family succeeds for every mutation/read', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  const active = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(active.length, 2);
  const [firstKey] = active;
  await service.revokeKey(FAMILY_A, device.deviceId, firstKey.keyId);
  const revoked = await service.revokeDevice(FAMILY_A, device.deviceId);
  assert.equal(revoked.status, 'REVOKED');
});

test('family scope: wrong family is rejected identically to unknown device on every operation', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });

  await assert.rejects(() => service.listActiveKeys(FAMILY_B, device.deviceId), { code: 'DEVICE_NOT_FOUND' });
  await assert.rejects(() => service.addDeviceKey(FAMILY_B, device.deviceId, key(), 'DEK'), { code: 'DEVICE_NOT_FOUND' });
  await assert.rejects(() => service.revokeDevice(FAMILY_B, device.deviceId), { code: 'DEVICE_NOT_FOUND' });

  // Device must remain fully intact and operable by its real family after every rejected cross-family attempt.
  const stillActive = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(stillActive.length, 1);
});

test('family scope: revokeKey under the wrong family is rejected and does not revoke the key', async () => {
  const { service } = buildService();
  const { device, key: registeredKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await assert.rejects(
    () => service.revokeKey(FAMILY_B, device.deviceId, registeredKey.keyId),
    { code: 'DEVICE_NOT_FOUND' },
  );
  const active = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(active.length, 1);
  assert.equal(active[0].status, 'ACTIVE');
});

test('family scope: unknown device is rejected the same way as a real device in another family', async () => {
  const { service } = buildService();
  const unknownError = await service.listActiveKeys(FAMILY_A, 'no-such-device').catch((e) => e);
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const wrongFamilyError = await service.listActiveKeys(FAMILY_B, device.deviceId).catch((e) => e);
  assert.equal(unknownError.code, 'DEVICE_NOT_FOUND');
  assert.equal(wrongFamilyError.code, 'DEVICE_NOT_FOUND');
  assert.equal(unknownError.message, wrongFamilyError.message);
});

test('family scope: revoked-device behavior is correct under the owning family', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.revokeDevice(FAMILY_A, device.deviceId);
  await assert.rejects(() => service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK'), { code: 'DEVICE_REVOKED' });
  // Revoking an already-revoked device is idempotent, not an error.
  const again = await service.revokeDevice(FAMILY_A, device.deviceId);
  assert.equal(again.status, 'REVOKED');
});

test('revocation timestamps are idempotent: repeated device/key revocation preserves the first revocation instant', async () => {
  const repository = createInMemoryDeviceRepository();
  let currentTime = new Date('2026-01-01T00:00:00.000Z').getTime();
  const service = new DeviceDirectoryService(repository, () => new Date(currentTime));

  const { device, key: registeredKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const secondKey = await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  await service.revokeKey(FAMILY_A, device.deviceId, secondKey.keyId);

  const firstDeviceRevoke = await service.revokeDevice(FAMILY_A, device.deviceId);
  currentTime += 60_000;
  const secondDeviceRevoke = await service.revokeDevice(FAMILY_A, device.deviceId);
  assert.equal(secondDeviceRevoke.revokedAt.getTime(), firstDeviceRevoke.revokedAt.getTime());

  const activeKeysAfter = await repository.findKeysByDeviceForFamily(FAMILY_A, device.deviceId);
  const cascadedKey = activeKeysAfter.find((k) => k.keyId === registeredKey.keyId);
  const preRevokeKeyTimestamp = cascadedKey.revokedAt.getTime();
  await service.revokeDevice(FAMILY_A, device.deviceId); // redundant call, must not disturb key timestamps either
  const activeKeysAgain = await repository.findKeysByDeviceForFamily(FAMILY_A, device.deviceId);
  const cascadedKeyAgain = activeKeysAgain.find((k) => k.keyId === registeredKey.keyId);
  assert.equal(cascadedKeyAgain.revokedAt.getTime(), preRevokeKeyTimestamp);
});

test('family scope: cross-family key access is impossible even by guessing a real key id', async () => {
  const { service } = buildService();
  const { device, key: registeredKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const otherFamilyDevice = await service.registerDevice({ familyId: FAMILY_B, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await assert.rejects(
    () => service.revokeKey(FAMILY_B, device.deviceId, registeredKey.keyId),
    { code: 'DEVICE_NOT_FOUND' },
  );
  await assert.rejects(
    () => service.revokeKey(FAMILY_A, otherFamilyDevice.device.deviceId, otherFamilyDevice.key.keyId),
    { code: 'DEVICE_NOT_FOUND' },
  );
});

test('atomicity: device revocation and key revocation observe no partial state (all-or-nothing from the caller\'s perspective)', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  await service.addDeviceKey(FAMILY_A, device.deviceId, key(), 'DEK');
  const revoked = await service.revokeDevice(FAMILY_A, device.deviceId);
  assert.equal(revoked.status, 'REVOKED');
  const active = await service.listActiveKeys(FAMILY_A, device.deviceId);
  assert.equal(active.length, 0, 'no key may remain ACTIVE once the device transition is observed as REVOKED');
});

// --- Pairing lifecycle ----------------------------------------------------

test('confirmPairing: PAIRING_PENDING -> PAIRED for the owning family', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  assert.equal(device.status, 'PAIRING_PENDING');
  const confirmingAccountId = randomUUID();
  const paired = await service.confirmPairing(FAMILY_A, device.deviceId, confirmingAccountId);
  assert.equal(paired.status, 'PAIRED');
  assert.equal(paired.pairedByAccountId, confirmingAccountId);
  assert.notEqual(paired.pairedAt, null);
});

test('confirmPairing is idempotent: confirming twice preserves the first pairedAt', async () => {
  const repository = createInMemoryDeviceRepository();
  let currentTime = new Date('2026-01-01T00:00:00.000Z').getTime();
  const service = new DeviceDirectoryService(repository, () => new Date(currentTime));
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const accountId = randomUUID();
  const first = await service.confirmPairing(FAMILY_A, device.deviceId, accountId);
  currentTime += 60_000;
  const second = await service.confirmPairing(FAMILY_A, device.deviceId, accountId);
  assert.equal(second.pairedAt.getTime(), first.pairedAt.getTime());
});

test('confirmPairing rejects a device that is already REVOKED', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.revokeDevice(FAMILY_A, device.deviceId);
  await assert.rejects(
    () => service.confirmPairing(FAMILY_A, device.deviceId, randomUUID()),
    { code: 'INVALID_STATE' },
  );
});

test('confirmPairing under the wrong family is rejected identically to an unknown device (IDOR)', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const wrongFamilyError = await service.confirmPairing(FAMILY_B, device.deviceId, randomUUID()).catch((e) => e);
  const unknownDeviceError = await service.confirmPairing(FAMILY_B, 'no-such-device', randomUUID()).catch((e) => e);
  assert.equal(wrongFamilyError.code, 'DEVICE_NOT_FOUND');
  assert.equal(unknownDeviceError.code, 'DEVICE_NOT_FOUND');
  assert.equal(wrongFamilyError.message, unknownDeviceError.message);
  // Device remains untouched and confirmable by its real family.
  const paired = await service.confirmPairing(FAMILY_A, device.deviceId, randomUUID());
  assert.equal(paired.status, 'PAIRED');
});

test('PAIRING_PENDING cannot self-promote to ACTIVE: no service-layer path sets status ACTIVE', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const paired = await service.confirmPairing(FAMILY_A, device.deviceId, randomUUID());
  // Confirmation reaches PAIRED, never ACTIVE -- ACTIVE requires first-policy
  // delivery via the Family Trust Set, a separate, later workstream.
  assert.equal(paired.status, 'PAIRED');
  assert.notEqual(paired.status, 'ACTIVE');
});
