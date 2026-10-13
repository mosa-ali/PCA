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
  const challengeRepository = overrides.challengeRepository ?? createInMemoryDeviceChallengeRepository({
    async isSignerKeyActive({ familyId, deviceId, keyId, publicKey }) {
      const keys = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
      return keys.some((candidate) => candidate.keyId === keyId && candidate.keyPurpose === 'DSK'
        && candidate.publicKey === publicKey && candidate.status === 'ACTIVE');
    },
  });
  const signatureVerifier = overrides.signatureVerifier ?? createTestOnlyDeviceSignatureVerifier();
  let currentTime = overrides.startTime ?? BASE_TIME;
  const clock = {
    now: () => new Date(currentTime),
    advance: (ms) => { currentTime += ms; },
    setTime: (ms) => { currentTime = ms; },
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

test('verifyChallenge with a valid signature over the correct nonce returns the exact verified DSK identity', async () => {
  const { authService, directoryService, deviceRepository } = buildHarness();
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, issued.nonce);
  const identity = await authService.verifyChallenge(issued.challengeId, signature);
  const [registeredDsk] = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  assert.equal(identity.deviceId, device.deviceId);
  assert.equal(identity.familyId, device.familyId);
  assert.equal(identity.dskKeyId, registeredDsk.keyId);
  assert.equal(identity.dskPublicKey, dskPublicKey);
});

test('verifyChallenge resolves the signature to its exact key when multiple DSK rows remain active', async () => {
  const { authService, directoryService } = buildHarness();
  const { device, dskPublicKey: firstPublicKey } = await registerDeviceWithDsk(directoryService);
  const secondPublicKey = key();
  const second = await directoryService.addDeviceKey(device.familyId, device.deviceId, secondPublicKey, 'DSK');

  const issued = await authService.issueChallenge(device.deviceId);
  const identity = await authService.verifyChallenge(issued.challengeId,
    signTestOnlyChallenge(secondPublicKey, issued.nonce));
  assert.notEqual(identity.dskPublicKey, firstPublicKey);
  assert.equal(identity.dskKeyId, second.keyId);
  assert.equal(identity.dskPublicKey, secondPublicKey);
});

test('verifyChallenge rejects a signature that matches multiple active DSK entries without consuming the challenge', async () => {
  const persistedChallenges = createInMemoryDeviceChallengeRepository();
  let consumeCalls = 0;
  const challengeRepository = {
    create: (record) => persistedChallenges.create(record),
    findById: (challengeId) => persistedChallenges.findById(challengeId),
    async consumeAtomically(...args) {
      consumeCalls += 1;
      return persistedChallenges.consumeAtomically(...args);
    },
  };
  let verifierCalls = 0;
  const signatureVerifier = { async verify() { verifierCalls += 1; return true; } };
  const { authService, directoryService } = buildHarness({ challengeRepository, signatureVerifier });
  const { device } = await registerDeviceWithDsk(directoryService);
  await directoryService.addDeviceKey(device.familyId, device.deviceId, key(), 'DSK');
  const issued = await authService.issueChallenge(device.deviceId);

  const error = await authService.verifyChallenge(issued.challengeId, 'signature-valid-for-both-keys').catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');
  assert.equal(verifierCalls, 2, 'every active DSK must be evaluated before deciding signer identity');
  assert.equal(consumeCalls, 0, 'an ambiguous signer set cannot consume the one-time challenge');
  assert.equal((await persistedChallenges.findById(issued.challengeId)).consumedAt, null);
});

test('verifyChallenge does not consume or accept proof when the exact DSK is revoked after verification but before consume', async () => {
  let revokeBeforeConsume = async () => {};
  const signatureVerifier = {
    async verify() {
      await revokeBeforeConsume();
      return true;
    },
  };
  const { authService, directoryService, deviceRepository, challengeRepository } = buildHarness({ signatureVerifier });
  const { device, dskPublicKey } = await registerDeviceWithDsk(directoryService);
  const [dsk] = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  assert.equal(dsk.keyPurpose, 'DSK');
  const issued = await authService.issueChallenge(device.deviceId);
  revokeBeforeConsume = () => directoryService.revokeKey(device.familyId, device.deviceId, dsk.keyId);

  const error = await authService.verifyChallenge(issued.challengeId, signTestOnlyChallenge(dskPublicKey, issued.nonce)).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');
  const currentKeys = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  assert.equal(currentKeys.find((key) => key.keyId === dsk.keyId).status, 'REVOKED');
  const storedChallenge = await challengeRepository.findById(issued.challengeId);
  assert.equal(storedChallenge.consumedAt, null, 'proof under a revoked key must leave the challenge unconsumed');
});

test('verifyChallenge rejects a persisted challenge whose family scope differs from the current device before verification or consumption', async () => {
  const persistedChallenges = createInMemoryDeviceChallengeRepository();
  let consumeCalls = 0;
  const challengeRepository = {
    create: (record) => persistedChallenges.create(record),
    async findById(challengeId) {
      const record = await persistedChallenges.findById(challengeId);
      return record ? { ...record, familyId: 'different-family' } : null;
    },
    async consumeAtomically(...args) {
      consumeCalls += 1;
      return persistedChallenges.consumeAtomically(...args);
    },
  };
  let verifierCalls = 0;
  const signatureVerifier = { async verify() { verifierCalls += 1; return true; } };
  const { authService, directoryService } = buildHarness({ challengeRepository, signatureVerifier });
  const { device } = await registerDeviceWithDsk(directoryService, { familyId: 'family-opaque-1' });
  const issued = await authService.issueChallenge(device.deviceId);

  const error = await authService.verifyChallenge(issued.challengeId, 'otherwise-valid-signature').catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'DEVICE_NOT_FOUND', 'scope mismatch is indistinguishable from an unavailable challenge identity');
  assert.equal(verifierCalls, 0, 'a scope-mismatched challenge never reaches signature verification');
  assert.equal(consumeCalls, 0, 'a scope-mismatched challenge remains unconsumed');
  const stored = await persistedChallenges.findById(issued.challengeId);
  assert.equal(stored.familyId, device.familyId);
  assert.equal(stored.consumedAt, null);
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

test('verifyChallenge fails closed on an invalid server clock before signature verification or consumption', async () => {
  let verifierCalls = 0;
  const signatureVerifier = { async verify() { verifierCalls += 1; return true; } };
  const { authService, directoryService, challengeRepository, clock } = buildHarness({ signatureVerifier });
  const { device } = await registerDeviceWithDsk(directoryService);
  const issued = await authService.issueChallenge(device.deviceId);
  clock.setTime(Number.NaN);

  const error = await authService.verifyChallenge(issued.challengeId, 'valid-signature').catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'EXPIRED');
  assert.equal(verifierCalls, 0);
  assert.equal((await challengeRepository.findById(issued.challengeId)).consumedAt, null);
});

test('verifyChallenge revalidates the consumption clock after signature work and leaves challenge intact if invalid', async () => {
  let clock;
  const signatureVerifier = {
    async verify() {
      clock.setTime(Number.NaN);
      return true;
    },
  };
  const harness = buildHarness({ signatureVerifier });
  clock = harness.clock;
  const { device } = await registerDeviceWithDsk(harness.directoryService);
  const issued = await harness.authService.issueChallenge(device.deviceId);

  const error = await harness.authService.verifyChallenge(issued.challengeId, 'valid-signature').catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'EXPIRED');
  assert.equal((await harness.challengeRepository.findById(issued.challengeId)).consumedAt, null);
});

test('in-memory challenge consumption snapshots its timestamp before an awaited signer check', async () => {
  let releaseKeyCheck;
  let signalKeyCheckStarted;
  const keyCheckStarted = new Promise((resolve) => { signalKeyCheckStarted = resolve; });
  const keyCheckGate = new Promise((resolve) => { releaseKeyCheck = resolve; });
  const challengeRepository = createInMemoryDeviceChallengeRepository({
    async isSignerKeyActive() {
      signalKeyCheckStarted();
      await keyCheckGate;
      return true;
    },
  });
  const expiresAt = new Date('2026-01-01T01:00:00.000Z');
  const originalConsumedAt = new Date('2026-01-01T00:30:00.000Z');
  const record = {
    challengeId: 'challenge-one', deviceId: 'device-one', familyId: 'family-one', nonce: 'nonce-one',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt, consumedAt: null,
  };
  await challengeRepository.create(record);

  const consuming = challengeRepository.consumeAtomically('challenge-one', originalConsumedAt, {
    familyId: 'family-one', deviceId: 'device-one', keyId: 'key-one', publicKey: 'public-key-one',
  });
  await keyCheckStarted;
  originalConsumedAt.setTime(Date.parse('2026-01-01T02:00:00.000Z'));
  releaseKeyCheck();

  const outcome = await consuming;
  assert.equal(outcome.outcome, 'CONSUMED');
  assert.equal(outcome.challenge.consumedAt.toISOString(), '2026-01-01T00:30:00.000Z');
});

test('in-memory challenge repository rejects invalid or out-of-range consume timestamps without consuming', async () => {
  const challengeRepository = createInMemoryDeviceChallengeRepository();
  await challengeRepository.create({
    challengeId: 'challenge-one', deviceId: 'device-one', familyId: 'family-one', nonce: 'nonce-one',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'), consumedAt: null,
  });
  const signer = { familyId: 'family-one', deviceId: 'device-one', keyId: 'key-one', publicKey: 'public-key-one' };

  assert.equal((await challengeRepository.consumeAtomically('challenge-one', new Date(Number.NaN), signer)).outcome, 'EXPIRED');
  assert.equal((await challengeRepository.consumeAtomically('challenge-one', new Date('0999-12-31T23:59:59.999Z'), signer)).outcome, 'EXPIRED');
  assert.equal((await challengeRepository.findById('challenge-one')).consumedAt, null);
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
