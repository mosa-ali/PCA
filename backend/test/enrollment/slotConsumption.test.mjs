import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { hashInvitationToken } from '../../dist/invitation/token.js';
import { SlotReservationService, SlotReservationError } from '../../dist/entitlements/slots/SlotReservationService.js';
import { createInMemoryEnrollmentRepository } from '../support/inMemoryEnrollmentRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z');

function rawToken() {
  return randomBytes(32).toString('base64url');
}

function deviceInput() {
  return {
    platform: 'ANDROID',
    signingPublicKey: randomBytes(32).toString('base64url'),
    encryptionPublicKey: randomBytes(32).toString('base64url'),
    attemptId: randomBytes(24).toString('base64url'),
    attemptRecoveryToken: randomBytes(32).toString('base64url'),
  };
}

function seed(repository) {
  const token = rawToken();
  const invitation = {
    invitationId: randomUUID(),
    familyId: `family-${randomUUID()}`,
    tokenHash: hashInvitationToken(token),
    platform: 'ANDROID',
    status: 'CREATED',
    expiresAt: new Date(BASE_TIME.getTime() + 15 * 60 * 1000),
    redeemedAt: null,
  };
  repository._seedInvitation(invitation);
  return { token, invitation };
}

test('successful enrollment consumes the managed-device reservation for the invitation', async () => {
  const repository = createInMemoryEnrollmentRepository();
  const { token, invitation } = seed(repository);
  const consumed = [];
  const coordinator = new EnrollmentCoordinator(repository, () => BASE_TIME, undefined, { consumeForInvitation: async (invitationId) => consumed.push(invitationId) });

  await coordinator.enrollDevice({ rawInvitationToken: token, ...deviceInput() });
  assert.deepEqual(consumed, [invitation.invitationId]);
});

test('a successful enrollment retry replays consumption idempotently for the same invitation', async () => {
  const repository = createInMemoryEnrollmentRepository();
  const { token } = seed(repository);
  const input = deviceInput();
  let calls = 0;
  const coordinator = new EnrollmentCoordinator(repository, () => BASE_TIME, undefined, { consumeForInvitation: async () => { calls += 1; } });

  await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  await coordinator.enrollDevice({ rawInvitationToken: token, ...input });
  assert.equal(calls, 2);
});

test('slot consumption treats missing and already-consumed reservations as idempotent', async () => {
  for (const outcome of ['NOT_FOUND', 'ALREADY_CONSUMED']) {
    const service = new SlotReservationService({ consumeByInvitationId: async () => ({ outcome }) });
    await assert.doesNotReject(() => service.consumeForInvitation('invitation-a'));
  }
});

test('slot consumption fails closed on an invalid reservation state', async () => {
  const service = new SlotReservationService({ consumeByInvitationId: async () => ({ outcome: 'INVALID_STATE' }) });
  await assert.rejects(() => service.consumeForInvitation('invitation-a'), (error) => error instanceof SlotReservationError && error.code === 'INVALID_STATE');
});
