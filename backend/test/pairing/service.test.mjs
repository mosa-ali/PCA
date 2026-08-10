import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService } from '../../dist/device/DeviceDirectoryService.js';
import { PairingService, PairingError } from '../../dist/pairing/PairingService.js';
import { computeKeyFingerprint } from '../../dist/pairing/fingerprint.js';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';

function key() {
  return randomBytes(32).toString('base64url');
}

const FAMILY_A = 'family-opaque-A';
const FAMILY_B = 'family-opaque-B';

function buildServices() {
  const repository = createInMemoryDeviceRepository();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const deviceService = new DeviceDirectoryService(repository, now);
  const pairingService = new PairingService(repository, now);
  return { deviceService, pairingService, repository };
}

async function pairedCandidateDevice(deviceService) {
  const signingKey = key();
  const encryptionKey = key();
  const { device } = await deviceService.registerDevice({ familyId: FAMILY_A, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: signingKey });
  await deviceService.addDeviceKey(FAMILY_A, device.deviceId, encryptionKey, 'DEK');
  return { device, signingKey, encryptionKey };
}

test('getPairingRequest exposes device id, platform, status, and both key fingerprints', async () => {
  const { deviceService, pairingService } = buildServices();
  const { device, signingKey, encryptionKey } = await pairedCandidateDevice(deviceService);
  const view = await pairingService.getPairingRequest(FAMILY_A, device.deviceId);
  assert.equal(view.deviceId, device.deviceId);
  assert.equal(view.platform, 'ANDROID');
  assert.equal(view.status, 'PAIRING_PENDING');
  assert.equal(view.dskFingerprint, computeKeyFingerprint(signingKey));
  assert.equal(view.dekFingerprint, computeKeyFingerprint(encryptionKey));
});

test('getPairingRequest for an unknown device is NOT_FOUND', async () => {
  const { pairingService } = buildServices();
  await assert.rejects(() => pairingService.getPairingRequest(FAMILY_A, 'no-such-device'), { code: 'NOT_FOUND' });
});

test('wrong account/family cannot inspect a pairing request -- indistinguishable from nonexistent', async () => {
  const { deviceService, pairingService } = buildServices();
  const { device } = await pairedCandidateDevice(deviceService);
  const wrongFamilyError = await pairingService.getPairingRequest(FAMILY_B, device.deviceId).catch((e) => e);
  const unknownError = await pairingService.getPairingRequest(FAMILY_B, 'no-such-device').catch((e) => e);
  assert.equal(wrongFamilyError.code, 'NOT_FOUND');
  assert.equal(wrongFamilyError.message, unknownError.message);
});

test('authorized parent confirmation: PAIRING_PENDING -> PAIRED', async () => {
  const { deviceService, pairingService } = buildServices();
  const { device } = await pairedCandidateDevice(deviceService);
  const confirmedBy = randomUUID();
  const view = await pairingService.confirmPairing(FAMILY_A, device.deviceId, confirmedBy);
  assert.equal(view.status, 'PAIRED');
});

test('confirmation is idempotent', async () => {
  const repository = createInMemoryDeviceRepository();
  let currentTime = new Date('2026-01-01T00:00:00.000Z').getTime();
  const now = () => new Date(currentTime);
  const deviceService = new DeviceDirectoryService(repository, now);
  const pairingService = new PairingService(repository, now);
  const { device } = await pairedCandidateDevice(deviceService);
  const confirmedBy = randomUUID();

  const first = await pairingService.confirmPairing(FAMILY_A, device.deviceId, confirmedBy);
  currentTime += 60_000;
  const second = await pairingService.confirmPairing(FAMILY_A, device.deviceId, confirmedBy);
  assert.equal(first.status, 'PAIRED');
  assert.equal(second.status, 'PAIRED');
});

test('REVOKED pairing request cannot become PAIRED', async () => {
  const { deviceService, pairingService } = buildServices();
  const { device } = await pairedCandidateDevice(deviceService);
  await deviceService.revokeDevice(FAMILY_A, device.deviceId);
  await assert.rejects(
    () => pairingService.confirmPairing(FAMILY_A, device.deviceId, randomUUID()),
    { code: 'INVALID_STATE' },
  );
});

test('viewer/service authority alone does not create family cryptographic trust: confirmPairing never reaches ACTIVE', async () => {
  const { deviceService, pairingService } = buildServices();
  const { device } = await pairedCandidateDevice(deviceService);
  const view = await pairingService.confirmPairing(FAMILY_A, device.deviceId, randomUUID());
  assert.notEqual(view.status, 'ACTIVE');
  assert.equal(view.status, 'PAIRED');
});
