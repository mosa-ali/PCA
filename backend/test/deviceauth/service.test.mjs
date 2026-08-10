import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { DeviceAuthService, DeviceAuthError } from '../../dist/deviceauth/DeviceAuthService.js';
import { DEVICE_CHALLENGE_TTL_MS } from '../../dist/deviceauth/policy.js';
import { DeviceDirectoryService } from '../../dist/device/DeviceDirectoryService.js';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../support/inMemoryDeviceChallengeRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../support/testOnlyDeviceSignatureVerifier.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function key() {
  return randomBytes(32).toString('base64url');
}

function buildHarness(overrides = {}) {
  const deviceRepository = overrides.deviceRepository ?? createInMemoryDeviceRepository();
  const challengeRepository = overrides.challengeRepository ?? createInMemoryDeviceChallengeRepository();
  const signatureVerifier = overrides.signatureVerifier ?? createTestOnlyDeviceSignatureVerifier();
  let currentTime = overrides.startTime ?? BASE_TIME;
  const clock = {
    now: () => new Date(currentTime),
    advance: (ms) => { currentTime += ms; },
  };
  const directoryService = new DeviceDirectoryService(deviceRepository, clock.now);
  const authService = new DeviceAuthService(challengeRepository, deviceRepository, signatureVerifier, clock.now);
  return { authService, directoryService, deviceRepository, challengeRepository, clock };
}

async function registerDeviceWithDsk(directoryService, overrides = {}) {
  const dskPublicKey = overrides.dskPublicKey ?? key();
  const { device } = await directoryService.registerDevice({
    familyId: overrides.familyId ?? 'family-opaque-1',
    platform: overrides.platform ?? 'ANDROID',
    publicKey: dskPublicKey,
    keyPurpose: 'DSK',
  });
  return { device, dskPublicKey };
}

test('issueChallenge for a known, non-revoked device returns a fresh, plausible nonce and a short expiry', async () => {
  const { authService, directoryService, clock } = buildHarness();
  const { device } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  assert.ok(issued.challengeId);
  assert.ok(issued.nonce);
  assert.equal(issued.expiresAt.getTime(), clock.now().getTime() + DEVICE_CHALLENGE_TTL_MS);
});

test('issueChallenge for an unknown device is DEVICE_NOT_FOUND', async () => {
  const { authService } = buildHarness();
  await assert.rejects(() => authService.issueChallenge('unknown-device-id'), DeviceAuthError);
});

test('issueChallenge for a revoked device is DEVICE_REVOKED', async () => {
  const { authService, directoryService } = buildHarness();
  const { device } = await registerDeviceWithDsk(directoryService);
  await directoryService.revokeDevice(device.familyId, device.deviceId);
  const error = await authService.issueChallenge(device.deviceId).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'DEVICE_REVOKED');
});

test('verifyChallenge with a valid signature over the correct nonce succeeds and returns the device/family identity', async () => {
  const { authService, directoryService } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, issued.nonce);
  const identity = await authService.verifyChallenge(issued.challengeId, signature);
  assert.equal(identity.deviceId, device.deviceId);
  assert.equal(identity.familyId, device.familyId);
});

test('verifyChallenge with an invalid signature is INVALID_SIGNATURE, and the challenge remains unconsumed', async () => {
  const { authService, directoryService, challengeRepository } = buildHarness();
  const { device } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  const error = await authService.verifyChallenge(issued.challengeId, 'not-a-valid-signature').catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');
  const stored = await challengeRepository.findById(issued.challengeId);
  assert.equal(stored.consumedAt, null, 'a rejected signature must never consume the challenge');
});

test('verifyChallenge is REPLAY-PROOF: the same valid signature can never succeed twice', async () => {
  const { authService, directoryService } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, issued.nonce);

  await authService.verifyChallenge(issued.challengeId, signature);
  const error = await authService.verifyChallenge(issued.challengeId, signature).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'ALREADY_CONSUMED');
});

test('verifyChallenge REPLAY-PROOF under genuine concurrency: N simultaneous verifications of the identical valid signature -- exactly one succeeds', async () => {
  const { authService, directoryService } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, issued.nonce);

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => authService.verifyChallenge(issued.challengeId, signature)),
  );
  const succeeded = results.filter((r) => r.status === 'fulfilled');
  assert.equal(succeeded.length, 1, 'exactly one concurrent verification of a replayed valid signature may ever succeed');
});

test('verifyChallenge after expiry is EXPIRED, even with a valid signature', async () => {
  const { authService, directoryService, clock } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, issued.nonce);
  clock.advance(DEVICE_CHALLENGE_TTL_MS + 1);
  const error = await authService.verifyChallenge(issued.challengeId, signature).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'EXPIRED');
});

test('verifyChallenge for an unknown challengeId is NOT_FOUND', async () => {
  const { authService } = buildHarness();
  const error = await authService.verifyChallenge('00000000-0000-0000-0000-000000000000', 'anything').catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'NOT_FOUND');
});

test('verifyChallenge for a device revoked AFTER challenge issuance is DEVICE_REVOKED, not a stale success', async () => {
  const { authService, directoryService } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  await directoryService.revokeDevice(device.familyId, device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, issued.nonce);
  const error = await authService.verifyChallenge(issued.challengeId, signature).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'DEVICE_REVOKED');
});

test('a signature valid for a DIFFERENT device\'s key is rejected -- the challenge is bound to the device it was issued for', async () => {
  const { authService, directoryService } = buildHarness();
  const { device: deviceA } = await registerDeviceWithDsk(directoryService, { familyId: 'family-a' });
  const { dskPublicKey: dskB } = await registerDeviceWithDsk(directoryService, { familyId: 'family-b' });
  const issuedForA = await authService.issueChallenge(deviceA.deviceId);
  const signatureUnderWrongKey = signTestOnlyChallenge(dskB, issuedForA.nonce);
  const error = await authService.verifyChallenge(issuedForA.challengeId, signatureUnderWrongKey).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');
});

test('a DEK can never satisfy a device-authentication challenge, only the DSK', async () => {
  const { authService, directoryService, deviceRepository } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const dekPublicKey = key();
  await directoryService.addDeviceKey(device.familyId, device.deviceId, dekPublicKey, 'DEK');

  const issued = await authService.issueChallenge(device.deviceId);
  const signatureUnderDek = signTestOnlyChallenge(dekPublicKey, issued.nonce);
  const error = await authService.verifyChallenge(issued.challengeId, signatureUnderDek).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');

  // Sanity: the DSK-signed version of the same challenge still works.
  const signatureUnderDsk = signTestOnlyChallenge(dskPublicKey, issued.nonce);
  const identity = await authService.verifyChallenge(issued.challengeId, signatureUnderDsk);
  assert.equal(identity.deviceId, device.deviceId);
});
