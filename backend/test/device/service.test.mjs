import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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

const baseInput = { familyId: 'family-opaque-1', platform: 'ANDROID' };

test('registerDevice creates an ACTIVE device with an ACTIVE key', async () => {
  const { service } = buildService();
  const { device, key: registeredKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  assert.equal(device.status, 'ACTIVE');
  assert.equal(registeredKey.status, 'ACTIVE');
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

test('addDeviceKey rotates in a new active key for an active device', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const rotated = await service.addDeviceKey(device.deviceId, key());
  assert.equal(rotated.status, 'ACTIVE');
  const active = await service.listActiveKeys(device.deviceId);
  assert.equal(active.length, 2);
});

test('addDeviceKey rejects duplicate public key across devices', async () => {
  const { service } = buildService();
  const sharedKey = key();
  const { device: deviceA } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.registerDevice({ ...baseInput, publicKey: sharedKey });
  await assert.rejects(
    () => service.addDeviceKey(deviceA.deviceId, sharedKey),
    { code: 'DUPLICATE_KEY' },
  );
});

test('addDeviceKey rejects unknown device', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.addDeviceKey('unknown-device', key()), { code: 'DEVICE_NOT_FOUND' });
});

test('addDeviceKey rejects a revoked device', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.revokeDevice(device.deviceId);
  await assert.rejects(() => service.addDeviceKey(device.deviceId, key()), { code: 'DEVICE_REVOKED' });
});

test('revokeKey deactivates only the targeted key, leaving other active keys untouched', async () => {
  const { service } = buildService();
  const { device, key: firstKey } = await service.registerDevice({ ...baseInput, publicKey: key() });
  const secondKey = await service.addDeviceKey(device.deviceId, key());
  await service.revokeKey(device.deviceId, firstKey.keyId);
  const active = await service.listActiveKeys(device.deviceId);
  assert.equal(active.length, 1);
  assert.equal(active[0].keyId, secondKey.keyId);
});

test('revokeKey rejects an unknown key id for a real device', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await assert.rejects(() => service.revokeKey(device.deviceId, 'unknown-key-id'), { code: 'KEY_NOT_FOUND' });
});

test('revokeDevice cascades to revoke every active key', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: key() });
  await service.addDeviceKey(device.deviceId, key());
  const revoked = await service.revokeDevice(device.deviceId);
  assert.equal(revoked.status, 'REVOKED');
  const active = await service.listActiveKeys(device.deviceId);
  assert.equal(active.length, 0);
});

test('a public key freed by full revocation of its owning device can be re-registered (no permanent lockout of the key value)', async () => {
  const { service } = buildService();
  const reusedKey = key();
  const { device } = await service.registerDevice({ ...baseInput, publicKey: reusedKey });
  await service.revokeDevice(device.deviceId);
  const second = await service.registerDevice({ ...baseInput, publicKey: reusedKey });
  assert.equal(second.device.status, 'ACTIVE');
  assert.notEqual(second.device.deviceId, device.deviceId);
});

test('familyId is server-recorded from input only -- device registration cannot be steered to an unrelated family after creation', async () => {
  const { service } = buildService();
  const { device } = await service.registerDevice({ familyId: 'family-A', platform: 'ANDROID', publicKey: key() });
  assert.equal(device.familyId, 'family-A');
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
  const forged = { ...baseInput, publicKey: key(), deviceId: 'attacker-chosen', status: 'REVOKED' };
  const { device } = await service.registerDevice(forged);
  assert.notEqual(device.deviceId, 'attacker-chosen');
  assert.equal(device.status, 'ACTIVE');
});
