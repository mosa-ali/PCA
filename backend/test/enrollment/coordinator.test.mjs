import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { EnrollmentCoordinator, EnrollmentError } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { createInMemoryEnrollmentRepository } from '../support/inMemoryEnrollmentRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function key() {
  return randomBytes(32).toString('base64url');
}

// Mirrors the real generator's canonical shape (43-char base64url) without
// importing the invitation token generator's randomness directly.
function rawToken() {
  return randomBytes(32).toString('base64url');
}

function attemptId() {
  return randomBytes(24).toString('base64url');
}

function recoveryToken() {
  return randomBytes(32).toString('base64url');
}

function buildCoordinator() {
  const repository = createInMemoryEnrollmentRepository();
  let currentTime = BASE_TIME;
  const clock = { now: () => new Date(currentTime), advance: (ms) => { currentTime += ms; }, set: (ms) => { currentTime = ms; } };
  const coordinator = new EnrollmentCoordinator(repository, clock.now);
  return { coordinator, repository, clock };
}

function seedInvitation(repository, overrides = {}) {
  const token = rawToken();
  const invitation = {
    invitationId: randomUUID(),
    familyId: `family-${randomUUID()}`,
    tokenHash: hashInvitationToken(token),
    platform: 'ANDROID',
    status: 'CREATED',
    expiresAt: new Date(BASE_TIME + 15 * 60 * 1000),
    redeemedAt: null,
    ...overrides,
  };
  repository._seedInvitation(invitation);
  return { token, invitation };
}

function deviceKeysInput(overrides = {}) {
  return {
    platform: 'ANDROID',
    signingPublicKey: key(),
    encryptionPublicKey: key(),
    attemptId: attemptId(),
    attemptRecoveryToken: recoveryToken(),
    ...overrides,
  };
}

test('successful enrollment: PAIRING_PENDING device created, DSK+DEK registered, invitation redeemed', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token, invitation } = seedInvitation(repository);
  const result = await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() });
  assert.equal(result.familyId, invitation.familyId);
  assert.equal(result.invitationId, invitation.invitationId);
  assert.equal(result.status, 'PAIRING_PENDING');
  assert.ok(result.deviceId);
  assert.ok(result.signingKeyId);
  assert.ok(result.encryptionKeyId);
  assert.notEqual(result.signingKeyId, result.encryptionKeyId);
});

test('malformed invitation token rejected before any repository lookup', async () => {
  const { coordinator } = buildCoordinator();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: 'not a token', ...deviceKeysInput() }),
    { code: 'INVALID_TOKEN' },
  );
});

test('malformed signing public key rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ signingPublicKey: 'not a key' }) }),
    { code: 'INVALID_PUBLIC_KEY' },
  );
});

test('malformed encryption public key rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ encryptionPublicKey: 'not a key' }) }),
    { code: 'INVALID_PUBLIC_KEY' },
  );
});

test('identical signing and encryption keys rejected -- DSK/DEK role separation is mandatory', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const sharedKey = key();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ signingPublicKey: sharedKey, encryptionPublicKey: sharedKey }) }),
    { code: 'KEYS_NOT_DISTINCT' },
  );
});

test('invalid platform rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ platform: 'WINDOWS' }) }),
    { code: 'INVALID_PLATFORM' },
  );
});

test('unknown invitation token rejected', async () => {
  const { coordinator } = buildCoordinator();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken(), ...deviceKeysInput() }),
    { code: 'NOT_FOUND' },
  );
});

test('expired invitation rejected', async () => {
  const { coordinator, repository, clock } = buildCoordinator();
  const { token } = seedInvitation(repository, { expiresAt: new Date(BASE_TIME + 1000) });
  clock.advance(1001);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() }),
    { code: 'EXPIRED' },
  );
});

test('revoked invitation rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository, { status: 'REVOKED' });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() }),
    { code: 'REVOKED' },
  );
});

test('already-redeemed invitation rejected -- cannot enroll a second device with a NEW attempt id', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() }),
    { code: 'ALREADY_REDEEMED' },
  );
});

test('platform mismatch rejected: an IOS device cannot redeem an ANDROID invitation', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository, { platform: 'ANDROID' });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ platform: 'IOS' }) }),
    { code: 'PLATFORM_MISMATCH' },
  );
});

test('platform mismatch does NOT redeem the invitation -- it remains usable by a correctly-platformed device', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository, { platform: 'ANDROID' });
  await assert.rejects(() => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ platform: 'IOS' }) }));
  const result = await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ platform: 'ANDROID' }) });
  assert.ok(result.deviceId);
});

test('duplicate public key (as either DSK or DEK) rejected and does not consume the invitation', async () => {
  const { coordinator, repository } = buildCoordinator();
  const sharedKey = key();
  const { token: firstToken } = seedInvitation(repository);
  await coordinator.enrollDevice({ rawInvitationToken: firstToken, ...deviceKeysInput({ signingPublicKey: sharedKey }) });

  const { token: secondToken } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: secondToken, ...deviceKeysInput({ encryptionPublicKey: sharedKey }) }),
    { code: 'DUPLICATE_KEY' },
  );
  // The second invitation must NOT have been consumed by the failed attempt.
  const retry = await coordinator.enrollDevice({ rawInvitationToken: secondToken, ...deviceKeysInput() });
  assert.ok(retry.deviceId);
});

test('errors never carry the raw token or public key', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const input = deviceKeysInput();
  await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  try {
    await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: attemptId() }) });
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(error instanceof EnrollmentError);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(input.signingPublicKey), false);
  }
});

test('concurrency (in-memory): many simultaneous enrollment attempts (distinct attempt ids) against one invitation -- exactly one succeeds', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() })),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent enrollment must succeed');
  assert.equal(rejected.length, 19);
  for (const failure of rejected) assert.equal(failure.reason.code, 'ALREADY_REDEEMED');
});

// --- PCA-ENROLLMENT-RUNTIME-2: ambiguous-retry / idempotent-recovery tests ---

test('RETRY: same attempt id + same token + same keys replays the original result -- no second device, no ALREADY_REDEEMED', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const input = deviceKeysInput();
  const first = await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  const retry = await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  assert.equal(retry.deviceId, first.deviceId);
  assert.equal(retry.signingKeyId, first.signingKeyId);
  assert.equal(retry.encryptionKeyId, first.encryptionKeyId);
  assert.equal(retry.status, 'PAIRING_PENDING');
});

test('RETRY: idempotent replay works any number of times', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const input = deviceKeysInput();
  const first = await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  for (let i = 0; i < 5; i++) {
    const retry = await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
    assert.equal(retry.deviceId, first.deviceId);
  }
});

test('DIFFERENT ATTEMPT ID against an already-redeemed invitation is a generic ALREADY_REDEEMED, not a replay', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput() });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: attemptId() }) }),
    { code: 'ALREADY_REDEEMED' },
  );
});

test('ATTEMPT CONFLICT: same attempt id reused against a DIFFERENT (still-redeemed) token is rejected, not replayed', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token: firstToken } = seedInvitation(repository);
  const sharedAttemptId = attemptId();
  await coordinator.enrollDevice({ rawInvitationToken: firstToken, ...deviceKeysInput({ attemptId: sharedAttemptId }) });

  const { token: secondToken } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: secondToken, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
    { code: 'ATTEMPT_CONFLICT' },
  );
});

test('ATTEMPT CONFLICT: same attempt id + same token but DIFFERENT keys is rejected, not silently replayed with stale keys', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const sharedAttemptId = attemptId();
  await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: sharedAttemptId }) });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
    { code: 'ATTEMPT_CONFLICT' },
  );
});

test('ATTEMPT CONFLICT: concurrent competing bootstraps with the SAME attempt id but DIFFERENT tokens -- only one may ever succeed', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token: tokenA } = seedInvitation(repository);
  const { token: tokenB } = seedInvitation(repository);
  const sharedAttemptId = attemptId();
  const attempts = await Promise.allSettled([
    coordinator.enrollDevice({ rawInvitationToken: tokenA, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
    coordinator.enrollDevice({ rawInvitationToken: tokenB, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
  ]);
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one of two competing attempt-id claims may succeed');
});

test('INVALID ATTEMPT ID: too short is rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: 'short' }) }),
    { code: 'INVALID_ATTEMPT_ID' },
  );
});

test('INVALID ATTEMPT ID: oversized is rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: 'a'.repeat(200) }) }),
    { code: 'INVALID_ATTEMPT_ID' },
  );
});

test('INVALID ATTEMPT ID: malformed characters rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptId: '!!!not-base64url-and-too-short-anyway!!!' }) }),
    { code: 'INVALID_ATTEMPT_ID' },
  );
});

test('INVALID RECOVERY TOKEN: too short is rejected', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: token, ...deviceKeysInput({ attemptRecoveryToken: 'short' }) }),
    { code: 'INVALID_RECOVERY_TOKEN' },
  );
});

test('AUTHORITY INJECTION: EnrollDeviceInput has no familyId/role/memberId/childId field a caller could smuggle authority through', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token, invitation } = seedInvitation(repository);
  const input = { ...deviceKeysInput(), rawInvitationToken: token, familyId: 'attacker-family', role: 'PARENT', memberId: 'attacker-member' };
  const result = await coordinator.enrollDevice(input);
  // The coordinator only ever reads rawInvitationToken/platform/keys/attemptId/attemptRecoveryToken
  // off the input object -- extra fields are inert. familyId always comes
  // from the invitation record itself, never the caller.
  assert.equal(result.familyId, invitation.familyId);
  assert.notEqual(result.familyId, 'attacker-family');
});

// --- recoverAttempt ---

test('RECOVERY: correct attempt id + correct recovery token returns the same deviceId', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const input = deviceKeysInput();
  const original = await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  const recovered = await coordinator.recoverAttempt({ attemptId: input.attemptId, attemptRecoveryToken: input.attemptRecoveryToken });
  assert.equal(recovered.deviceId, original.deviceId);
  assert.equal(recovered.status, 'PAIRING_PENDING');
});

test('RECOVERY: unknown attempt id is NOT_FOUND', async () => {
  const { coordinator } = buildCoordinator();
  await assert.rejects(
    () => coordinator.recoverAttempt({ attemptId: attemptId(), attemptRecoveryToken: recoveryToken() }),
    { code: 'NOT_FOUND' },
  );
});

test('RECOVERY: known attempt id with WRONG recovery token is NOT_FOUND -- same error as unknown attempt id (no oracle)', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const input = deviceKeysInput();
  await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  await assert.rejects(
    () => coordinator.recoverAttempt({ attemptId: input.attemptId, attemptRecoveryToken: recoveryToken() }),
    { code: 'NOT_FOUND' },
  );
});

test('RECOVERY: random guessed recovery identifier never matches', async () => {
  const { coordinator, repository } = buildCoordinator();
  const { token } = seedInvitation(repository);
  const input = deviceKeysInput();
  await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  for (let i = 0; i < 10; i++) {
    await assert.rejects(() => coordinator.recoverAttempt({ attemptId: input.attemptId, attemptRecoveryToken: recoveryToken() }));
  }
});

test('RECOVERY: malformed attempt id in recovery request is a distinguishable client-shape error, not NOT_FOUND', async () => {
  const { coordinator } = buildCoordinator();
  await assert.rejects(
    () => coordinator.recoverAttempt({ attemptId: 'x', attemptRecoveryToken: recoveryToken() }),
    { code: 'INVALID_ATTEMPT_ID' },
  );
});

test('RECOVERY: oversized recovery token in recovery request is a distinguishable client-shape error', async () => {
  const { coordinator } = buildCoordinator();
  await assert.rejects(
    () => coordinator.recoverAttempt({ attemptId: attemptId(), attemptRecoveryToken: 'a'.repeat(500) }),
    { code: 'INVALID_RECOVERY_TOKEN' },
  );
});
