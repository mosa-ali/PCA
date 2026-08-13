// Verifies FamilyAuditRepository.append() is actually invoked by the real
// domain services it was wired into (PCA-17D Part 1) -- not just that the
// audit domain logic itself works in isolation (see FamilyAuditStore.test.mjs
// for that). Each test calls the REAL service method and asserts on the
// FamilyAuditRecord that landed in the injected in-memory repository.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { DeviceDirectoryService } from '../../dist/device/DeviceDirectoryService.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { RecoveryService } from '../../dist/recovery/RecoveryService.js';
import { DeviceSessionService } from '../../dist/runtime-sync/DeviceSessionService.js';
import { InMemoryDeviceSessionRepository } from '../../dist/runtime-sync/DeviceSessionRepository.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';
import { createInMemoryEnrollmentRepository } from '../support/inMemoryEnrollmentRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRecoveryRepository } from '../support/inMemoryRecoveryRepository.mjs';
import { createInMemoryDeviceChallengeRepository } from '../support/inMemoryDeviceChallengeRepository.mjs';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../support/testOnlyDeviceSignatureVerifier.mjs';

function key() {
  return randomBytes(32).toString('base64url');
}

function freshAudit() {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  return { repo, service };
}

test('invitation create appends a ROLE_INVITATION SUCCESS record', async () => {
  const { repo, service } = freshAudit();
  const invitationService = new InvitationService(createInMemoryInvitationRepository(), () => new Date(), service);
  const { record } = await invitationService.createInvitation({
    familyId: 'fam-audit-1',
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
  });
  const events = await repo.listForFamily('fam-audit-1');
  assert.equal(events.length, 1);
  assert.equal(events[0].actionType, 'ROLE_INVITATION');
  assert.equal(events[0].resultStatus, 'SUCCESS');
  assert.equal(events[0].correlationId, record.invitationId);
});

test('invitation revoke appends a ROLE_REVOKE SUCCESS record', async () => {
  const { repo, service } = freshAudit();
  const invitationService = new InvitationService(createInMemoryInvitationRepository(), () => new Date(), service);
  const { record } = await invitationService.createInvitation({
    familyId: 'fam-audit-2',
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
  });
  await invitationService.revokeInvitationForFamily('fam-audit-2', record.invitationId);
  const events = await repo.listForFamily('fam-audit-2');
  const revokeEvent = events.find((e) => e.actionType === 'ROLE_REVOKE');
  assert.ok(revokeEvent);
  assert.equal(revokeEvent.resultStatus, 'SUCCESS');
  assert.equal(revokeEvent.correlationId, record.invitationId);
});

test('enrollment (invitation acceptance) appends a ROLE_ACCEPT SUCCESS record', async () => {
  const { repo, service } = freshAudit();
  const enrollmentRepository = createInMemoryEnrollmentRepository();
  const coordinator = new EnrollmentCoordinator(enrollmentRepository, () => new Date(), service);
  const token = randomBytes(32).toString('base64url');
  const invitation = {
    invitationId: randomUUID(),
    familyId: 'fam-audit-3',
    tokenHash: (await import('../../dist/invitation/token.js')).hashInvitationToken(token),
    platform: 'ANDROID',
    status: 'CREATED',
    expiresAt: new Date(Date.now() + 60_000),
  };
  enrollmentRepository._seedInvitation(invitation);
  const result = await coordinator.enrollDevice({
    rawInvitationToken: token,
    platform: 'ANDROID',
    signingPublicKey: key(),
    encryptionPublicKey: key(),
    attemptId: randomBytes(24).toString('base64url'),
    attemptRecoveryToken: randomBytes(32).toString('base64url'),
  });
  const events = await repo.listForFamily('fam-audit-3');
  assert.equal(events.length, 1);
  assert.equal(events[0].actionType, 'ROLE_ACCEPT');
  assert.equal(events[0].targetScope.id, result.deviceId);
});

test('pairing confirmation appends a DEVICE_LIFECYCLE_TRANSITION SUCCESS record', async () => {
  const { repo, service } = freshAudit();
  const deviceRepository = createInMemoryDeviceRepository();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const deviceService = new DeviceDirectoryService(deviceRepository, now);
  const pairingService = new PairingService(deviceRepository, now, service);
  const { device } = await deviceService.registerDevice({ familyId: 'fam-audit-4', platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await deviceService.addDeviceKey('fam-audit-4', device.deviceId, key(), 'DEK');
  await pairingService.confirmPairing('fam-audit-4', device.deviceId, 'account-1');
  const events = await repo.listForFamily('fam-audit-4');
  const pairEvent = events.find((e) => e.actionType === 'DEVICE_LIFECYCLE_TRANSITION');
  assert.ok(pairEvent);
  assert.equal(pairEvent.resultStatus, 'SUCCESS');
  assert.equal(pairEvent.targetScope.id, device.deviceId);
});

test('device revocation appends a DEVICE_LIFECYCLE_TRANSITION SUCCESS record', async () => {
  const { repo, service } = freshAudit();
  const deviceRepository = createInMemoryDeviceRepository();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const deviceService = new DeviceDirectoryService(deviceRepository, now, service);
  const { device } = await deviceService.registerDevice({ familyId: 'fam-audit-5', platform: 'ANDROID', keyPurpose: 'DSK', publicKey: key() });
  await deviceService.revokeDevice('fam-audit-5', device.deviceId);
  const events = await repo.listForFamily('fam-audit-5');
  const revokeEvent = events.find((e) => e.freeTextNote === 'DEVICE_REVOKED');
  assert.ok(revokeEvent);
  assert.equal(revokeEvent.actionType, 'DEVICE_LIFECYCLE_TRANSITION');
  assert.equal(revokeEvent.resultStatus, 'SUCCESS');
});

test('recovery envelope store and delete each append a RECOVERY_EVENT record', async () => {
  const { repo, service } = freshAudit();
  const recoveryService = new RecoveryService(createInMemoryRecoveryRepository(), () => new Date(), service);
  await recoveryService.storeEnvelope('fam-audit-6', Buffer.from('ciphertext-not-inspected'), 0);
  await recoveryService.deleteEnvelope('fam-audit-6');
  const events = await repo.listForFamily('fam-audit-6');
  const recoveryEvents = events.filter((e) => e.actionType === 'RECOVERY_EVENT');
  assert.equal(recoveryEvents.length, 2);
  assert.ok(recoveryEvents.every((e) => e.resultStatus === 'SUCCESS'));
  assert.ok(recoveryEvents.every((e) => e.reasonCategory === 'RECOVERY'));
});

test('a denied ParentActionAuthorizationService.authorize() call appends a DENIED_AUTHORIZATION_ATTEMPT record', async () => {
  const { repo, service } = freshAudit();
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId: 'fam-audit-7',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [{ deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' }],
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    supersedesEpoch: null,
    signature: 'sig',
  });
  const resolver = new FamilyTrustSetRoleResolver(store);
  const authz = new ParentActionAuthorizationService(
    resolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    () => new Date('2026-01-01T00:00:00Z'),
    undefined,
    service,
  );
  const decision = authz.authorize({
    familyId: 'fam-audit-7',
    actorDeviceId: 'dev-viewer',
    operation: 'DELETE_NOW',
    targetScope: { kind: 'FAMILY', id: 'fam-audit-7' },
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-01T00:15:00Z'),
    stepUp: null,
    idempotencyKey: 'idem-denied-1',
    actionId: 'act-denied-1',
  });
  assert.equal(decision.verdict, 'DENY');
  // The audit append is fire-and-forget (authorize() stays synchronous) --
  // yield the microtask queue once so the pending append lands.
  await new Promise((resolve) => setImmediate(resolve));
  const events = await repo.listForFamily('fam-audit-7');
  assert.equal(events.length, 1);
  assert.equal(events[0].actionType, 'DENIED_AUTHORIZATION_ATTEMPT');
  assert.equal(events[0].resultStatus, 'DENIED');
});

test('a STEP_UP_REQUIRED_BUT_ABSENT denial is categorized as STEP_UP_FAILURE, not a generic denial', async () => {
  const { repo, service } = freshAudit();
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId: 'fam-audit-8',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [{ deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' }],
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    supersedesEpoch: null,
    signature: 'sig',
  });
  const resolver = new FamilyTrustSetRoleResolver(store);
  const authz = new ParentActionAuthorizationService(
    resolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    () => new Date('2026-01-01T00:00:00Z'),
    undefined,
    service,
  );
  const decision = authz.authorize({
    familyId: 'fam-audit-8',
    actorDeviceId: 'dev-owner',
    operation: 'DELETE_NOW', // OWNER: ALLOW_WITH_STEP_UP -- no stepUp supplied below
    targetScope: { kind: 'FAMILY', id: 'fam-audit-8' },
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-01T00:15:00Z'),
    stepUp: null,
    idempotencyKey: 'idem-stepup-1',
    actionId: 'act-stepup-1',
  });
  assert.equal(decision.verdict, 'DENY');
  assert.equal(decision.reason, 'STEP_UP_REQUIRED_BUT_ABSENT');
  await new Promise((resolve) => setImmediate(resolve));
  const events = await repo.listForFamily('fam-audit-8');
  assert.equal(events.length, 1);
  assert.equal(events[0].actionType, 'STEP_UP_FAILURE');
});

test('device session revocation appends a DEVICE_LIFECYCLE_TRANSITION record only when a real session existed', async () => {
  const { repo, service } = freshAudit();
  const deviceRepository = createInMemoryDeviceRepository();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const deviceService = new DeviceDirectoryService(deviceRepository, now);
  const dskPublicKey = key();
  const { device } = await deviceService.registerDevice({ familyId: 'fam-audit-9', platform: 'ANDROID', keyPurpose: 'DSK', publicKey: dskPublicKey });

  const deviceAuthService = new DeviceAuthService(createInMemoryDeviceChallengeRepository(), deviceRepository, createTestOnlyDeviceSignatureVerifier(), now);
  const sessionRepository = new InMemoryDeviceSessionRepository();
  const sessionService = new DeviceSessionService(deviceAuthService, sessionRepository, now, service);

  const challenge = await deviceAuthService.issueChallenge(device.deviceId);
  const signature = signTestOnlyChallenge(dskPublicKey, challenge.nonce);
  const { rawToken } = await sessionService.completeChallenge(challenge.challengeId, signature);
  await sessionService.revokeSession(rawToken);

  const events = await repo.listForFamily('fam-audit-9');
  const revokeEvent = events.find((e) => e.freeTextNote === 'DEVICE_SESSION_REVOKED');
  assert.ok(revokeEvent);
  assert.equal(revokeEvent.actionType, 'DEVICE_LIFECYCLE_TRANSITION');

  // Revoking again (already-revoked token) must not throw and must not append a second event.
  await sessionService.revokeSession(rawToken);
  const eventsAfter = await repo.listForFamily('fam-audit-9');
  assert.equal(eventsAfter.length, events.length);
});
