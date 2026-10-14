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

function buildHarness(now = () => new Date(), auditService = undefined, auditFailureObserver = undefined) {
  const deviceRepository = createInMemoryDeviceRepository();
  const sessionRepository = new InMemoryDeviceSessionRepository();
  const deviceAuthService = new DeviceAuthService(
    createInMemoryDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const sessionService = new DeviceSessionService(deviceAuthService, sessionRepository, now, auditService, auditFailureObserver);
  return { deviceRepository, deviceAuthService, sessionRepository, sessionService };
}

function sessionRecord(tokenHash, sessionId, issuedAt, expiresAt) {
  return {
    sessionId,
    tokenHash,
    deviceId: `device-${sessionId}`,
    familyId: `family-${sessionId}`,
    dskKeyId: `dsk-${sessionId}`,
    dskPublicKey: `public-${sessionId}`,
    familySessionEpoch: 1,
    issuedAt,
    expiresAt,
    revokedAt: null,
  };
}

test('process-local session repository prunes expired records by expiry order and snapshots timestamps', async () => {
  const repository = new InMemoryDeviceSessionRepository();
  const base = new Date('2026-01-01T00:00:00.000Z');
  const laterExpiry = sessionRecord('hash-later', 'session-later', new Date(base), new Date(base.getTime() + 500));
  const earlierExpiry = sessionRecord('hash-earlier', 'session-earlier', new Date(base), new Date(base.getTime() + 100));
  const surviving = sessionRecord('hash-surviving', 'session-surviving', new Date(base), new Date(base.getTime() + 300));
  await repository.create(laterExpiry);
  await repository.create(earlierExpiry);
  await repository.create(surviving);
  // Caller-owned Date mutation cannot extend the stored bearer lifetime.
  earlierExpiry.expiresAt.setTime(base.getTime() + 60_000);

  assert.equal((await repository.validate('hash-earlier', new Date(base.getTime() + 100))).outcome, 'INVALID');
  assert.equal(repository.byTokenHash.size, 2);
  assert.equal((await repository.validate('hash-surviving', new Date(base.getTime() + 200))).outcome, 'VALID');
  assert.equal((await repository.validate('hash-later', new Date(base.getTime() + 600))).outcome, 'INVALID');
  assert.equal(repository.byTokenHash.size, 0, 'expired records are removed from process memory, including when never presented again');

  await repository.create(sessionRecord('hash-new', 'session-new', new Date(base.getTime() + 700), new Date(base.getTime() + 800)));
  assert.equal(repository.byTokenHash.size, 1);
});

test('device-session repository fails closed on invalid clocks and immediately removes a revoked bearer', async () => {
  const repository = new InMemoryDeviceSessionRepository();
  const issuedAt = new Date('2026-01-01T00:00:00.000Z');
  await repository.create(sessionRecord('hash-revoke', 'session-revoke', issuedAt,
    new Date(issuedAt.getTime() + DEVICE_SESSION_TTL_MS)));
  const invalidNow = new Date(Number.NaN);

  assert.deepEqual(await repository.validate('hash-revoke', invalidNow), { outcome: 'INVALID' });
  assert.equal(await repository.revoke('hash-revoke', invalidNow), false);
  assert.equal(repository.byTokenHash.size, 1, 'invalid time input cannot mutate live session state');

  assert.equal(await repository.revoke('hash-revoke', new Date(issuedAt.getTime() + 1)), true);
  assert.equal(repository.byTokenHash.size, 0, 'revocation drops the bearer record immediately');
  assert.deepEqual(await repository.validate('hash-revoke', new Date(issuedAt.getTime() + 2)), { outcome: 'INVALID' });
});

test('an old expiry-heap tombstone cannot evict a later sessionId/expiry reusing a token hash', async () => {
  const repository = new InMemoryDeviceSessionRepository();
  const start = new Date('2026-01-01T00:00:00.000Z');
  await repository.create(sessionRecord('hash-reused', 'session-reused', new Date(start), new Date(start.getTime() + 100)));
  assert.equal(await repository.revoke('hash-reused', new Date(start.getTime() + 10)), true);
  await repository.create(sessionRecord('hash-reused', 'session-replacement', new Date(start.getTime() + 20), new Date(start.getTime() + 200)));

  const beforeNewExpiry = await repository.validate('hash-reused', new Date(start.getTime() + 100));
  assert.equal(beforeNewExpiry.outcome, 'VALID');
  if (beforeNewExpiry.outcome === 'VALID') assert.equal(beforeNewExpiry.session.expiresAt.getTime(), start.getTime() + 200);
});

async function registerDevice(deviceRepository, familyId = `family-${randomUUID()}`, status = 'ACTIVE') {
  const deviceId = `device-${randomUUID()}`;
  const publicKey = `pubkey-${randomUUID()}`;
  const dskKeyId = `key-${randomUUID()}`;
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
      keyId: dskKeyId,
      keyPurpose: 'DSK',
      publicKey,
      status: 'ACTIVE',
      createdAt: new Date(),
      revokedAt: null,
    },
  );
  assert.equal(result.outcome, 'CREATED');
  return { deviceId, familyId, publicKey, dskKeyId };
}

test('completeChallenge with a valid signature issues a working device session', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);

  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signature);

  const identity = await sessionService.validateSession(session.rawToken);
  assert.deepEqual(identity, { deviceId, familyId, dskKeyId: (await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId))[0].keyId });
});

test('completeChallenge rejects a valid signer when its device differs from the route-bound expected device', async () => {
  const { deviceRepository, sessionRepository, sessionService } = buildHarness();
  const signer = await registerDevice(deviceRepository);
  const other = await registerDevice(deviceRepository, `family-${randomUUID()}`);
  const challenge = await sessionService.issueChallengeSafely(signer.deviceId);
  const signature = signTestOnlyChallenge(signer.publicKey, challenge.nonce);

  await assert.rejects(
    () => sessionService.completeChallenge(other.deviceId, challenge.challengeId, signature),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
  assert.equal(sessionRepository.byTokenHash.size, 0, 'mismatched challenge scope must not create a bearer session');
});

test('a PAIRED device cannot receive or validate an ordinary device session, even with valid proof', async () => {
  const { deviceRepository, sessionRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey, dskKeyId } = await registerDevice(
    deviceRepository,
    `family-${randomUUID()}`,
    'PAIRED',
  );

  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);
  await assert.rejects(
    () => sessionService.completeChallenge(deviceId, challenge.challengeId, signature),
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
    dskKeyId,
    dskPublicKey: publicKey,
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
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  await deviceRepository.revokeDeviceAndKeysAtomically(familyId, deviceId, new Date());

  await assert.rejects(
    () => sessionService.validateSession(session.rawToken),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('a bearer remains bound to its verified DSK when a second active DSK exists', async () => {
  const { deviceRepository, sessionRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey, dskKeyId } = await registerDevice(deviceRepository);
  const firstChallenge = await sessionService.issueChallengeSafely(deviceId);
  const oldSession = await sessionService.completeChallenge(deviceId, firstChallenge.challengeId,
    signTestOnlyChallenge(publicKey, firstChallenge.nonce));

  const replacementKey = { deviceId, keyId: `key-${randomUUID()}`, keyPurpose: 'DSK',
    publicKey: `pubkey-${randomUUID()}`, status: 'ACTIVE', createdAt: new Date(), revokedAt: null };
  assert.equal((await deviceRepository.addKeyAtomically(familyId, replacementKey)).outcome, 'ADDED');
  assert.equal((await deviceRepository.revokeKeyForFamily(familyId, deviceId, dskKeyId, new Date())).outcome, 'REVOKED');
  const activeKeys = await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId);
  assert.equal(activeKeys.filter(key => key.keyPurpose === 'DSK' && key.status === 'ACTIVE').length, 1);
  assert.equal(activeKeys.find(key => key.keyId === replacementKey.keyId).status, 'ACTIVE');

  await assert.rejects(() => sessionService.validateSession(oldSession.rawToken),
    error => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED');

  const replacementChallenge = await sessionService.issueChallengeSafely(deviceId);
  const replacementSession = await sessionService.completeChallenge(deviceId, replacementChallenge.challengeId,
    signTestOnlyChallenge(replacementKey.publicKey, replacementChallenge.nonce));
  assert.deepEqual(await sessionService.validateSession(replacementSession.rawToken),
    { deviceId, familyId, dskKeyId: replacementKey.keyId });
  // Validation of a token whose persisted DSK snapshot was corrupted also fails closed.
  const validate = sessionRepository.validate.bind(sessionRepository);
  sessionRepository.validate = async (tokenHash, now) => {
    const result = await validate(tokenHash, now);
    return result.outcome === 'VALID' && result.session.dskKeyId === replacementKey.keyId
      ? { outcome: 'VALID', session: { ...result.session, dskPublicKey: `${replacementKey.publicKey}-tampered` } }
      : result;
  };
  await assert.rejects(() => sessionService.validateSession(replacementSession.rawToken),
    error => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED');
});

test('an issued device session is rejected immediately after family suspension', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

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
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

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
    () => sessionService.completeChallenge('nonexistent-device', challenge.challengeId, 'any-signature'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('issueChallengeSafely rejects an invalid synthetic challenge clock instead of returning an invalid expiry', async () => {
  for (const timestamp of [Number.NaN, Date.UTC(9999, 11, 31, 23, 59, 59, 999)]) {
    const { sessionService } = buildHarness(() => new Date(timestamp));
    await assert.rejects(
      () => sessionService.issueChallengeSafely('nonexistent-device'),
      RangeError,
    );
  }
});

test('completeChallenge rejects an invalid final session clock or expiry without minting a bearer', async () => {
  const valid = new Date('2026-01-01T00:00:00.000Z');
  for (const finalTimestamp of [
    Number.NaN,
    Date.UTC(9999, 11, 31, 23, 30, 0, 0),
  ]) {
    let clockCalls = 0;
    const { deviceRepository, sessionRepository, sessionService } = buildHarness(() => {
      clockCalls += 1;
      return new Date(clockCalls === 1 ? finalTimestamp : valid.getTime());
    });
    const { deviceId, publicKey } = await registerDevice(deviceRepository);
    const challenge = await sessionService.issueChallengeSafely(deviceId);
    await assert.rejects(
      () => sessionService.completeChallenge(deviceId, challenge.challengeId,
        signTestOnlyChallenge(publicKey, challenge.nonce)),
      (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
    );
    assert.equal(clockCalls, 1, 'the failure must happen at final session issuance, after successful proof verification');
    assert.equal(sessionRepository.byTokenHash.size, 0, 'invalid persistence timestamps cannot create a bearer');
  }
});

test('issueChallengeSafely for a revoked device is indistinguishable at the API boundary from a nonexistent one', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId } = await registerDevice(deviceRepository);
  await deviceRepository.revokeDeviceAndKeysAtomically(familyId, deviceId, new Date());

  const challenge = await sessionService.issueChallengeSafely(deviceId);
  await assert.rejects(
    () => sessionService.completeChallenge(deviceId, challenge.challengeId, 'any-signature'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('wrong signature is rejected with the single generic UNAUTHORIZED error', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  await assert.rejects(
    () => sessionService.completeChallenge(deviceId, challenge.challengeId, 'forged-signature'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});

test('a replayed (already-consumed) challenge is rejected on the second attempt even with a correct signature', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const signature = signTestOnlyChallenge(publicKey, challenge.nonce);

  await sessionService.completeChallenge(deviceId, challenge.challengeId, signature);
  await assert.rejects(
    () => sessionService.completeChallenge(deviceId, challenge.challengeId, signature),
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
    Array.from({ length: 20 }, () => sessionService.completeChallenge(deviceId, challenge.challengeId, signature)),
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
  assert.deepEqual(await sessionService.validateSession(succeeded[0].value.rawToken), {
    deviceId, familyId, dskKeyId: (await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId))[0].keyId,
  });
});

test('a lost session response requires a fresh challenge and can recover without replaying the consumed challenge', async () => {
  const { deviceRepository, sessionService } = buildHarness();
  const { deviceId, familyId, publicKey } = await registerDevice(deviceRepository);
  const firstChallenge = await sessionService.issueChallengeSafely(deviceId);
  const firstSignature = signTestOnlyChallenge(publicKey, firstChallenge.nonce);

  // Simulate the server committing the session while the HTTP response is lost.
  await sessionService.completeChallenge(deviceId, firstChallenge.challengeId, firstSignature);
  await assert.rejects(
    () => sessionService.completeChallenge(deviceId, firstChallenge.challengeId, firstSignature),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );

  const retryChallenge = await sessionService.issueChallengeSafely(deviceId);
  const recovered = await sessionService.completeChallenge(deviceId,
    retryChallenge.challengeId,
    signTestOnlyChallenge(publicKey, retryChallenge.nonce),
  );
  assert.deepEqual(await sessionService.validateSession(recovered.rawToken), {
    deviceId, familyId, dskKeyId: (await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId))[0].keyId,
  });
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
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  await sessionService.revokeSession(session.rawToken);
  await sessionService.revokeSession(session.rawToken); // idempotent, no throw
  await assert.rejects(() => sessionService.validateSession(session.rawToken));
});

test('revokeSession remains successful after committed revocation when audit and warning sinks throw', async () => {
  let auditCalls = 0;
  const reportedFailures = [];
  const auditService = { async record() { auditCalls += 1; throw new Error('audit unavailable'); } };
  const { deviceRepository, sessionService } = buildHarness(
    () => new Date(),
    auditService,
    (failure) => {
      reportedFailures.push(failure);
      throw new Error('logger unavailable');
    },
  );
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId,
    signTestOnlyChallenge(publicKey, challenge.nonce));

  await sessionService.revokeSession(session.rawToken);

  assert.equal(auditCalls, 1, 'the audit is attempted for the committed transition');
  assert.deepEqual(reportedFailures, [{ event: 'device_session_revocation_audit_append_failed', occurrences: 1 }]);
  await assert.rejects(() => sessionService.validateSession(session.rawToken),
    error => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED');
  await sessionService.revokeSession(session.rawToken);
  assert.equal(auditCalls, 1, 'an idempotent retry cannot recreate the transition audit');
});

test('concurrent revocations emit exactly one lifecycle transition audit', async () => {
  const auditEvents = [];
  const auditService = { async record(event) { auditEvents.push(event); } };
  const { deviceRepository, sessionRepository, sessionService } = buildHarness(() => new Date(), auditService);
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  const originalValidate = sessionRepository.validate.bind(sessionRepository);
  let priorReads = 0;
  let signalBothValidated;
  let releaseReads;
  const bothValidated = new Promise(resolve => { signalBothValidated = resolve; });
  const readGate = new Promise(resolve => { releaseReads = resolve; });
  sessionRepository.validate = async (tokenHash, now) => {
    const result = await originalValidate(tokenHash, now);
    priorReads += 1;
    if (priorReads <= 2) {
      if (priorReads === 2) signalBothValidated();
      await readGate;
    }
    return result;
  };

  const first = sessionService.revokeSession(session.rawToken);
  const second = sessionService.revokeSession(session.rawToken);
  try {
    await bothValidated;
  } finally {
    releaseReads();
  }
  await Promise.all([first, second]);

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].actionType, 'DEVICE_LIFECYCLE_TRANSITION');
  assert.equal(auditEvents[0].freeTextNote, 'DEVICE_SESSION_REVOKED');
  await assert.rejects(() => sessionService.validateSession(session.rawToken));
});

test('validateSession rejects a session once its TTL has elapsed, even though the token was never revoked', async () => {
  let currentTime = new Date();
  const { deviceRepository, sessionService } = buildHarness(() => currentTime);
  const { deviceId, publicKey } = await registerDevice(deviceRepository);
  const challenge = await sessionService.issueChallengeSafely(deviceId);
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

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
  const session = await sessionService.completeChallenge(deviceId, challenge.challengeId, signTestOnlyChallenge(publicKey, challenge.nonce));

  // The device's own, correct family is satisfied and returns the verified identity.
  const identity = await sessionService.requireActorDeviceInFamily(session.rawToken, familyId);
  assert.deepEqual(identity, {
    deviceId, familyId, dskKeyId: (await deviceRepository.findKeysByDeviceForFamily(familyId, deviceId))[0].keyId,
  });

  // A valid device session from THIS family must never satisfy a binding for a DIFFERENT
  // family -- this is the cross-tenant check that stops a device session from one family
  // being used to act on another family's data (see requireActorDeviceInFamily's doc comment).
  await assert.rejects(
    () => sessionService.requireActorDeviceInFamily(session.rawToken, 'a-different-family-id'),
    (error) => error instanceof RuntimeSyncAuthError && error.code === 'UNAUTHORIZED',
  );
});
