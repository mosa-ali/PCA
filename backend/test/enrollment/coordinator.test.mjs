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
  return { platform: 'ANDROID', signingPublicKey: key(), encryptionPublicKey: key(), ...overrides };
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

test('already-redeemed invitation rejected -- cannot enroll a second device', async () => {
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
    await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(error instanceof EnrollmentError);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(input.signingPublicKey), false);
  }
});

test('concurrency (in-memory): many simultaneous enrollment attempts against one invitation -- exactly one succeeds', async () => {
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
