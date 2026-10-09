import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { hashSessionToken } from '../../dist/auth/token.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import {
  DEVICE_SESSION_TTL_MS,
  DeviceSessionService,
  InMemoryDeviceSessionRepository,
  RuntimeSyncAuthError,
} from '../../dist/runtime-sync/index.js';
import { createInMemoryDeviceChallengeRepository } from '../support/inMemoryDeviceChallengeRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../support/testOnlyDeviceSignatureVerifier.mjs';

function buildHarness(now = () => new Date()) {
  const deviceRepository = createInMemoryDeviceRepository();
  const sessionRepository = new InMemoryDeviceSessionRepository();
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const sessionService = new DeviceSessionService(deviceAuthService, sessionRepository, now);
  return { deviceRepository, deviceAuthService, sessionRepository, sessionService };
}

async function registerDevice(deviceRepository, familyId = `family-${randomUUID()}`, status = 'ACTIVE') {
  const deviceId = `device-${randomUUID()}`;
  const publicKey = `pubkey-${randomUUID()}`;
  const result = await deviceRepository.createDeviceWithKey(
    {
      deviceId,
      familyId,
      platform: 'ANDROID',
      status,
      createdAt: new Date(),
      revokedAt: null,
      pairedAt: status === 'PAIRED' ? new Date() : null,
      pairedByAccountId: status === 'PAIRED' ? `parent-${randomUUID()}` : null,
    },
    {
      deviceId,
      keyId: `key-${randomUUID()}`,
      keyPurpose: 'DSK',
      publicKey,
      status: 'ACTIVE',
      createdAt: new Date(),
      revokedAt: null,
    },
  );
  assert.equal(result.outcome, 'CREATED');
  return { deviceId, familyId, publicKey };
}

test('completeChallenge with a valid signature issues a working device session', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);

  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);
  const session = await sessionService.completeChallenge(challenge.challengeId, signature);

  const identity = await sessionService.validateSession(session.rawToken);
  assert.deepEqual(identity, { deviceId, familyId });
});

test('a PAIRED device cannot receive or validate an ordinary device session, even with valid proof', async () => {
  const { deviceRepository, sessionRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(
    deviceRepository,
    `family-${randomUUID()}`,
    'PAIRED',
  );

  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);
  await assert.rejects(
    () => sessionService.completeChallenge(challenge.challengeId, signature),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );

  // Exercise the live lifecycle check even if an otherwise-valid ordinary
  // session record already exists for this device.
  const rawToken = 'A'.repeat(43);
  const issuedAt = new Date();
  await sessionRepository.create({
    sessionId: `session-${randomUUID()}`,
    tokenHash: hashSessionToken(rawToken),
    deviceId,
    familyId,
    familySessionEpoch: 1,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + DEVICE_SESSION_TTL_MS),
    revokedAt: null,
  });
  await assert.rejects(
    () => sessionService.validateSession(rawToken),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('an issued device session is rejected immediately after device revocation', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  await deviceRepository.revokeDeviceAndKeysAtomically(familyId, deviceId, new Date());

  await assert.rejects(
    () => sessionService.validateSession(session.rawToken),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('an issued device session is rejected immediately after family suspension', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  deviceRepository.setFamilyStatusForTest(familyId, 'SUSPENDED');

  await assert.rejects(
    () => sessionService.validateSession(session.rawToken),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('a device session stays invalid after family reactivation', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  deviceRepository.setFamilyStatusForTest(familyId, 'SUSPENDED');
  deviceRepository.setFamilyStatusForTest(familyId, 'ACTIVE');

  await assert.rejects(
    () => sessionService.validateSession(session.rawToken),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('issueChallengeSafely for a nonexistent device returns a well-formed challenge that can never complete', async () => {
  const { sessionService } = buildHarness();
  const challenge = await sessionService.issueChallengeSafely('nonexistent-device');
  assert.ok(challenge.challengeId);
  assert.ok(challenge.nonce);

  await assert.rejects(
    () => sessionService.completeChallenge(challenge.challengeId, 'any-signature'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('issueChallengeSafely for a revoked device is indistinguishable at the API boundary from a nonexistent one', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId } = await registerDevice(deviceRepository);
  await deviceRepository.revokeDeviceAndKeysAtomically(familyId, deviceId, new Date());

  const challenge = await sessionService.issueChallengeSafely(deviceId);
  await assert.rejects(
    () => sessionService.completeChallenge(challenge.challengeId, 'any-signature'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('wrong signature is rejected with the single generic UNAUTHORIZED error', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  await assert.rejects(
    () => sessionService.completeChallenge(challenge.challengeId, 'forged-signature'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('a replayed (already-consumed) challenge is rejected on the second attempt even with a correct signature', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);

  await sessionService.completeChallenge(challenge.challengeId, signature);
  await assert.rejects(
    () => sessionService.completeChallenge(challenge.challengeId, signature),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('concurrent completeChallenge replay creates exactly one session', async () => {
  const { deviceRepository, sessionRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);
  let createCalls = 0;
  const create = sessionRepository.create.bind(sessionRepository);
  sessionRepository.create = async (record) => {
    createCalls += 1;
    return create(record);
  };

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => sessionService.completeChallenge(challenge.challengeId, signature)),
  );

  const succeeded = attempts.filter((attempt) => attempt.status === 'fulfilled');
  const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
  assert.equal(succeeded.length, 1);
  assert.equal(rejected.length, 19);
  assert.equal(createCalls, 1, 'only the atomic challenge-consumption winner may mint a session');
  for (const attempt of rejected) {
    assert.ok(attempt.reason instanceof RuntimeSyncAuthError);
    assert.equal(attempt.reason.code, 'UNAUTHORIZED');
  }
  assert.deepEqual(await sessionService.validateSession(succeeded[0].value.rawToken), { deviceId, familyId });
});

test('a lost session response requires a fresh challenge and can recover without replaying the consumed challenge', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const firstChallenge = await sessionService.issueChallengeSafely(deviceId);
  const firstSignature = signTestOnlyChallenge(publicKey, firstChallenge.nonce);

  // Simulate the server committing the session while the HTTP response is lost.
  await sessionService.completeChallenge(firstChallenge.challengeId, firstSignature);
  await assert.rejects(
    () => sessionService.completeChallenge(firstChallenge.challengeId, firstSignature),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );

  const retryChallenge = await sessionService.issueChallengeSafely(deviceId);
  const recovered = await sessionService.completeChallenge(
    retryChallenge.challengeId,
    signTestOnlyChallenge(publicKey, retryChallenge.nonce),
  );
  assert.deepEqual(await sessionService.validateSession(recovered.rawToken), { deviceId, familyId });
});

test('validateSession rejects an unknown token generically', async () => {
  const { sessionService } = buildHarness();
  await assert.rejects(
    () => sessionService.validateSession('A'.repeat(43)),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('revokeSession makes a previously valid token unusable, and is idempotent', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  await sessionService.revokeSession(session.rawToken);
  await sessionService.revokeSession(session.rawToken); // idempotent, no throw
  await assert.rejects(() => sessionService.validateSession(session.rawToken));
});

test('validateSession rejects a session once its TTL has elapsed, even though the token was never revoked', async () => {
  let currentTime = new Date();
  const { deviceRepository, sessionService } = buildHarness(() => currentTime);
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  // Sanity check: immediately after issuance, well within the TTL, the session is still valid.
  await sessionService.validateSession(session.rawToken);

  // The session remains valid immediately before expiry, then is rejected at
  // the exact expiry boundary (inclusive) rather than one millisecond later.
  currentTime = new Date(currentTime.getTime() + DEVICE_SESSION_TTL_MS - 1);
  await sessionService.validateSession(session.rawToken);
  currentTime = new Date(currentTime.getTime() + 1);
  await assert.rejects(
    () => sessionService.validateSession(session.rawToken),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('requireActorDeviceInFamily binds the caller to the verified device\'s OWN family, and rejects every other family', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  // The device's own, correct family is satisfied and returns the verified identity.
  const identity = await sessionService.requireActorDeviceInFamily(session.rawToken, familyId);
  assert.deepEqual(identity, { deviceId, familyId });

  // A valid device session from THIS family must never satisfy a binding for a DIFFERENT
  // family -- this is the cross-tenant check that stops a device session from one family
  // being used to act on another family's data (see requireActorDeviceInFamily's doc comment).
  await assert.rejects(
    () => sessionService.requireActorDeviceInFamily(session.rawToken, 'a-different-family-id'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});
