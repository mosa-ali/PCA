import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { BrowserEndpointService, BrowserEndpointError } from '../../dist/device/BrowserEndpointService.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';

function key() {
  return randomBytes(32).toString('base64url');
}

const FAMILY = 'family-browser-1';

function buildService() {
  const repository = createInMemoryDeviceRepository();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const service = new BrowserEndpointService(repository, now);
  const pairingService = new PairingService(repository, now);
  return { service, repository, pairingService };
}

test('registerEndpoint creates a PAIRING_PENDING BROWSER device with a single ACTIVE DSK, never a DEK', async () => {
  const { service, repository } = buildService();
  const registeredBy = randomUUID();
  const result = await service.registerEndpoint(FAMILY, registeredBy, key());
  assert.equal(result.status, 'PAIRING_PENDING');
  assert.ok(result.deviceId);

  const device = await repository.findDeviceForFamily(FAMILY, result.deviceId);
  assert.equal(device.platform, 'BROWSER');
  assert.equal(device.status, 'PAIRING_PENDING');
  assert.equal(device.registeredByAccountId, registeredBy);
  assert.equal(device.pairedByAccountId, null, 'registration alone must never itself confirm pairing');

  const keys = await repository.findKeysByDeviceForFamily(FAMILY, result.deviceId);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].keyPurpose, 'DSK');
  assert.equal(keys[0].status, 'ACTIVE');
});

test('registerEndpoint rejects a malformed public key, never creates a device', async () => {
  const { service, repository } = buildService();
  await assert.rejects(
    () => service.registerEndpoint(FAMILY, randomUUID(), 'not a real key'),
    { code: 'INVALID_PUBLIC_KEY' },
  );
  await assert.rejects(() => service.registerEndpoint(FAMILY, randomUUID(), ''), { code: 'INVALID_PUBLIC_KEY' });
});

test('registerEndpoint rejects a public key already registered to another device', async () => {
  const { service } = buildService();
  const sharedKey = key();
  await service.registerEndpoint(FAMILY, randomUUID(), sharedKey);
  await assert.rejects(
    () => service.registerEndpoint(FAMILY, randomUUID(), sharedKey),
    { code: 'DUPLICATE_KEY' },
  );
});

test('two different families can register browser endpoints independently, with independent deviceIds', async () => {
  const { service } = buildService();
  const a = await service.registerEndpoint('family-a', randomUUID(), key());
  const b = await service.registerEndpoint('family-b', randomUUID(), key());
  assert.notEqual(a.deviceId, b.deviceId);
});

test('end-to-end: registration -> confirm by a DIFFERENT account reaches PAIRED; the SAME account is denied', async () => {
  const { service, pairingService } = buildService();
  const registeredBy = randomUUID();
  const { deviceId } = await service.registerEndpoint(FAMILY, registeredBy, key());

  await assert.rejects(
    () => pairingService.confirmPairing(FAMILY, deviceId, registeredBy),
    { code: 'SELF_APPROVAL_DENIED' },
  );

  const view = await pairingService.confirmPairing(FAMILY, deviceId, randomUUID());
  assert.equal(view.status, 'PAIRED');
});
