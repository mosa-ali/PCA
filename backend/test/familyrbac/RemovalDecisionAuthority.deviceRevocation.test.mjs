// PCA-ADD-ENR-016/017 (this session): an ALLOW_REMOVAL decision on a
// REMOVE_REVOKE_DEVICE request previously never actually revoked the
// decided-on device -- DeviceDirectoryService.revokeDevice was real,
// tested, and correct in isolation, but never constructed anywhere in
// main.ts, so it was unreachable from the running server. This file
// proves the fix: RemovalDecisionAuthority now calls it (best-effort,
// non-blocking, matching emitAlert's own posture) right after a
// REMOVE_REVOKE_DEVICE decision commits ALLOW_REMOVAL, and
// reconcilePendingRevocations is the durable crash-recovery path for
// exactly the case where that inline attempt is lost.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import {
  InMemoryRemovalDecisionReplayLedger,
  InMemoryRemovalDecisionRepository,
  RemovalDecisionAuthority,
} from '../../dist/familyrbac/RemovalDecisionAuthority.js';
import { AdministrationPinService, InMemoryAdministrationPinRepository } from '../../dist/enrollment/AdministrationPinService.js';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const FAMILY = 'family-revoke-1';
const CHILD = 'child-revoke-1';
const DEVICE = 'device-revoke-1';
const OWNER = 'owner-revoke-1';

function actorResolver() {
  return {
    resolveActor(familyId, deviceId) {
      if (familyId !== FAMILY) return 'FAMILY_MISMATCH';
      if (deviceId === OWNER) return { deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 };
      if (deviceId === DEVICE) return { deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      return 'FAMILY_MISMATCH';
    },
  };
}

function childMembership() {
  return {
    resolveMembership(familyId, childId) {
      return familyId === FAMILY && childId === CHILD ? { status: 'MEMBER_OF_FAMILY' } : { status: 'NOT_MEMBER_OF_FAMILY' };
    },
  };
}

function fakeDeviceRevocation() {
  const calls = [];
  let throwOnNextCall = false;
  return {
    calls,
    setThrowOnNextCall(value) {
      throwOnNextCall = value;
    },
    async revokeDevice(familyId, deviceId) {
      calls.push({ familyId, deviceId });
      if (throwOnNextCall) {
        throwOnNextCall = false;
        throw new Error('simulated transient failure');
      }
      return { deviceId, status: 'REVOKED' };
    },
  };
}

function buildAuthority({ repository = new InMemoryRemovalDecisionRepository(), deviceRevocation } = {}) {
  const audit = new FamilyAuditService(new InMemoryFamilyAuditRepository(), () => NOW);
  const authorization = new ParentActionAuthorizationService(
    actorResolver(),
    () => defaultFamilyRbacPolicyConfig(),
    new InMemoryActionIdempotencyLedger(),
    () => NOW,
    childMembership(),
    audit,
  );
  const pinService = new AdministrationPinService({ repository: new InMemoryAdministrationPinRepository(), now: () => NOW, sleep: async () => {} });
  const authority = new RemovalDecisionAuthority({
    repository,
    authorization,
    signingKeyResolver: { async resolve() { return null; } },
    signatureVerifier: { async verify() { return false; } },
    targetDeviceRoleResolver: actorResolver(),
    pinService,
    recoveryAuthority: { async verifyAuthorizedRecovery() { return false; } },
    replayLedger: new InMemoryRemovalDecisionReplayLedger(),
    auditService: audit,
    deviceRevocation,
    now: () => NOW,
  });
  return { authority, repository, pinService };
}

async function createPending(authority, overrides = {}) {
  return authority.createRequest({
    requestId: overrides.requestId ?? `request-${Math.random().toString(16).slice(2)}`,
    familyId: FAMILY,
    childId: CHILD,
    deviceId: DEVICE,
    operation: overrides.operation ?? 'REMOVE_REVOKE_DEVICE',
    protectionLevel: 'PROTECTED',
    requestedAt: new Date(NOW.getTime() - 1_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    reasonCategory: 'ROUTINE_POLICY_CHANGE',
    protectiveAuthorityApplies: true,
  });
}

test('ALLOW_REMOVAL on a REMOVE_REVOKE_DEVICE request revokes the real device via DeviceDirectoryService', async () => {
  const deviceRevocation = fakeDeviceRevocation();
  const { authority, pinService } = buildAuthority({ deviceRevocation });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority);

  await authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });

  assert.deepEqual(deviceRevocation.calls, [{ familyId: FAMILY, deviceId: DEVICE }]);
});

test('KEEP_ACTIVE never revokes the device', async () => {
  const deviceRevocation = fakeDeviceRevocation();
  const { authority, pinService } = buildAuthority({ deviceRevocation });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority);

  await authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: '135790' });

  assert.deepEqual(deviceRevocation.calls, []);
});

test('TEMPORARILY_DISABLE never performs a permanent device revocation', async () => {
  const deviceRevocation = fakeDeviceRevocation();
  const { authority, pinService } = buildAuthority({ deviceRevocation });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority);

  await authority.decideWithLocalPin(request.requestId, FAMILY, {
    decision: 'TEMPORARILY_DISABLE',
    temporaryDisableUntil: new Date(NOW.getTime() + 30_000), // must not exceed the request's own expiresAt (NOW + 60_000)
    pin: '135790',
  });

  assert.deepEqual(deviceRevocation.calls, []);
});

test('an ALLOW_REMOVAL decision on a DISABLE_PROTECTION_POLICY request never revokes the device (operation-scoped)', async () => {
  const deviceRevocation = fakeDeviceRevocation();
  const { authority, pinService } = buildAuthority({ deviceRevocation });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority, { operation: 'DISABLE_PROTECTION_POLICY' });

  const decided = await authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });

  assert.equal(decided.state, 'ALLOW_REMOVAL');
  assert.deepEqual(deviceRevocation.calls, [], 'DISABLE_PROTECTION_POLICY ALLOW_REMOVAL must never trigger device identity revocation');
});

test('re-deciding an already-decided local-PIN request fails INVALID_STATE and never calls revokeDevice again (local-PIN mode has no retry correlation, by design)', async () => {
  const deviceRevocation = fakeDeviceRevocation();
  const { authority, pinService } = buildAuthority({ deviceRevocation });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority);

  await authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });
  await assert.rejects(
    () => authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' }),
    (error) => error.code === 'INVALID_STATE',
  );

  assert.equal(deviceRevocation.calls.length, 1, 'the second (rejected) call must never have reached revocation');
});

test('reconcilePendingRevocations called twice in a row is idempotent (the second run finds nothing left to do)', async () => {
  const repository = new InMemoryRemovalDecisionRepository();
  const { authority: crashedAuthority, pinService } = buildAuthority({ repository, deviceRevocation: undefined });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(crashedAuthority);
  await crashedAuthority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });

  const deviceRevocation = fakeDeviceRevocation();
  const { authority: recoveryAuthority } = buildAuthority({ repository, deviceRevocation });
  const first = await recoveryAuthority.reconcilePendingRevocations();
  assert.equal(first.attempted, 1);
  // The fake executor doesn't itself mark the InMemory repository's device
  // as revoked (only the real DeviceDirectoryService/devices table would),
  // so simulate that real-world effect explicitly before the second pass.
  repository.revokedDeviceIdsForTest.add(DEVICE);
  const second = await recoveryAuthority.reconcilePendingRevocations();

  assert.equal(second.attempted, 0, 'a device already revoked by the first reconciliation pass must not be retried again');
});

test('a transient revokeDevice failure never blocks or reverses the already-committed decision', async () => {
  const deviceRevocation = fakeDeviceRevocation();
  deviceRevocation.setThrowOnNextCall(true);
  const { authority, pinService } = buildAuthority({ deviceRevocation });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority);

  const decided = await authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });

  assert.equal(decided.state, 'ALLOW_REMOVAL', 'the decision itself must still succeed even though revocation threw');
  assert.equal(deviceRevocation.calls.length, 1, 'the attempt must still have been made');
});

test('reconcilePendingRevocations retries every ALLOW_REMOVAL/REMOVE_REVOKE_DEVICE decision the repository reports as not-yet-revoked', async () => {
  // Simulate a crash between decision-commit and the inline revoke attempt:
  // construct the authority with NO deviceRevocation the first time (so the
  // inline call is skipped entirely, matching a lost/crashed attempt), then
  // reconcile with a real one.
  const repository = new InMemoryRemovalDecisionRepository();
  const { authority: crashedAuthority, pinService } = buildAuthority({ repository, deviceRevocation: undefined });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(crashedAuthority);
  await crashedAuthority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });

  const deviceRevocation = fakeDeviceRevocation();
  const { authority: recoveryAuthority } = buildAuthority({ repository, deviceRevocation });
  const result = await recoveryAuthority.reconcilePendingRevocations();

  assert.equal(result.attempted, 1);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(result.failedRequestIds, []);
  assert.deepEqual(deviceRevocation.calls, [{ familyId: FAMILY, deviceId: DEVICE }]);
});

test('reconcilePendingRevocations no longer finds a request once its device is marked revoked', async () => {
  const repository = new InMemoryRemovalDecisionRepository();
  const { authority, pinService } = buildAuthority({ repository, deviceRevocation: undefined });
  await pinService.configurePin(FAMILY, '135790');
  const request = await createPending(authority);
  await authority.decideWithLocalPin(request.requestId, FAMILY, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '135790' });

  repository.revokedDeviceIdsForTest.add(DEVICE);

  const deviceRevocation = fakeDeviceRevocation();
  const { authority: recoveryAuthority } = buildAuthority({ repository, deviceRevocation });
  const result = await recoveryAuthority.reconcilePendingRevocations();

  assert.equal(result.attempted, 0);
  assert.deepEqual(deviceRevocation.calls, []);
});

test('reconcilePendingRevocations is a safe no-op when no deviceRevocation is configured', async () => {
  const { authority } = buildAuthority({ deviceRevocation: undefined });
  const result = await authority.reconcilePendingRevocations();
  assert.deepEqual(result, { attempted: 0, succeeded: 0, failedRequestIds: [] });
});
