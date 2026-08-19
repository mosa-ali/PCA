import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdministrationPinService,
  InMemoryAdministrationPinRepository,
} from '../../dist/enrollment/AdministrationPinService.js';
import {
  InMemoryProtectionApprovalRepository,
  ProtectionApprovalError,
  ProtectionApprovalService,
} from '../../dist/enrollment/ProtectionApprovalService.js';

const NOW_MS = Date.parse('2026-08-18T12:00:00.000Z');

function buildService({ remoteAllowed = false, recoveryAllowed = false } = {}) {
  let nowMs = NOW_MS;
  const repository = new InMemoryProtectionApprovalRepository();
  const pinService = new AdministrationPinService({
    repository: new InMemoryAdministrationPinRepository(),
    now: () => new Date(nowMs),
    sleep: async () => {},
  });
  const calls = [];
  const authority = {
    async verifyRemoteDecision(input) {
      calls.push({ method: 'REMOTE_PARENT', input });
      return remoteAllowed;
    },
    async verifyAuthorizedRecovery(input) {
      calls.push({ method: 'AUTHORIZED_RECOVERY', input });
      return recoveryAllowed;
    },
  };
  const service = new ProtectionApprovalService({
    repository,
    pinService,
    authority,
    now: () => new Date(nowMs),
  });
  return {
    service,
    pinService,
    calls,
    advance: (milliseconds) => { nowMs += milliseconds; },
    now: () => new Date(nowMs),
  };
}

function request(overrides = {}) {
  const requestedAt = new Date(NOW_MS);
  return {
    requestId: 'request-enrollment-84',
    familyId: 'family-enrollment-84',
    childId: 'child-enrollment-84',
    deviceId: 'device-enrollment-84',
    operation: 'REMOVE_REVOKE_DEVICE',
    protectionLevel: 'PROTECTED',
    requestedAt,
    expiresAt: new Date(NOW_MS + 60_000),
    reasonCategory: 'CHILD_SAFETY_CONCERN',
    protectiveAuthorityApplies: true,
    ...overrides,
  };
}

test('removal request starts in PARENT_APPROVAL_REQUIRED and preserves parent-visible metadata', async () => {
  const { service } = buildService();
  const created = await service.createRequest(request());
  assert.equal(created.state, 'PARENT_APPROVAL_REQUIRED');
  assert.equal(created.childId, 'child-enrollment-84');
  assert.equal(created.deviceId, 'device-enrollment-84');
  assert.equal(created.protectionLevel, 'PROTECTED');
  assert.equal(created.reasonCategory, 'CHILD_SAFETY_CONCERN');
  assert.equal(created.decidedAt, null);
  assert.equal(created.decisionMethod, null);
});

test('local Administration PIN can apply KEEP_ACTIVE without storing the PIN or changing target metadata', async () => {
  const { service, pinService } = buildService();
  await pinService.configurePin('family-enrollment-84', '123456');
  const created = await service.createRequest(request());

  const decided = await service.decideWithLocalPin(created.requestId, created.familyId, {
    decision: 'KEEP_ACTIVE',
    temporaryDisableUntil: null,
    pin: '123456',
  });
  assert.equal(decided.state, 'KEEP_ACTIVE');
  assert.equal(decided.decisionMethod, 'LOCAL_ADMINISTRATION_PIN');
  assert.equal(decided.childId, created.childId);
  assert.equal(decided.deviceId, created.deviceId);
  assert.equal('pin' in decided, false);
});

test('wrong local PIN leaves the request pending and does not reveal target details through the error', async () => {
  const { service, pinService } = buildService();
  await pinService.configurePin('family-enrollment-84', '123456');
  const created = await service.createRequest(request());

  await assert.rejects(
    () => service.decideWithLocalPin(created.requestId, created.familyId, {
      decision: 'ALLOW_REMOVAL',
      temporaryDisableUntil: null,
      pin: '000000',
    }),
    (error) => error instanceof ProtectionApprovalError && error.code === 'PIN_INVALID' && !error.message.includes(created.childId),
  );
  assert.equal((await service.getRequest(created.familyId, created.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
});

test('TEMPORARILY_DISABLE requires a bounded future deadline, while ALLOW_REMOVAL and KEEP_ACTIVE do not accept one', async () => {
  const { service, pinService, now } = buildService();
  await pinService.configurePin('family-enrollment-84', '123456');
  const created = await service.createRequest(request());

  await assert.rejects(() => service.decideWithLocalPin(created.requestId, created.familyId, {
    decision: 'TEMPORARILY_DISABLE',
    temporaryDisableUntil: new Date(NOW_MS + 120_000),
    pin: '123456',
  }), (error) => error.code === 'INVALID_INPUT');

  const second = await service.createRequest(request({ requestId: 'request-enrollment-84b' }));
  const decided = await service.decideWithLocalPin(second.requestId, second.familyId, {
    decision: 'TEMPORARILY_DISABLE',
    temporaryDisableUntil: new Date(now().getTime() + 30_000),
    pin: '123456',
  });
  assert.equal(decided.state, 'TEMPORARILY_DISABLE');
});

test('remote and recovery decisions require the coordinator authority and receive the exact request binding', async () => {
  const { service, calls } = buildService({ remoteAllowed: true, recoveryAllowed: true });
  const created = await service.createRequest(request({ requestId: 'request-remote-84' }));
  const remoteDecision = { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null };
  const remote = await service.decideWithRemoteParent(created.requestId, created.familyId, remoteDecision, {
    signature: 'opaque-signature',
    actorDeviceId: 'trusted-parent-device-84',
    actionId: 'action-remote-84',
    idempotencyKey: 'idempotency-remote-84',
    issuedAt: new Date(NOW_MS),
    expiresAt: new Date(NOW_MS + 30_000),
  });
  assert.equal(remote.decisionMethod, 'REMOTE_PARENT');
  assert.equal(calls[0].input.request.childId, created.childId);
  assert.equal(calls[0].input.request.deviceId, created.deviceId);
  assert.equal(calls[0].input.proof.actorDeviceId, 'trusted-parent-device-84');

  const recoveryRequest = await service.createRequest(request({ requestId: 'request-recovery-84' }));
  const recovered = await service.decideWithAuthorizedRecovery(
    recoveryRequest.requestId,
    recoveryRequest.familyId,
    { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null },
    { proof: 'opaque-recovery-proof', recoveryTransactionId: 'recovery-transaction-84' },
  );
  assert.equal(recovered.decisionMethod, 'AUTHORIZED_RECOVERY');
  assert.equal(calls[1].input.request.requestId, recoveryRequest.requestId);
});

test('a denied remote authority cannot change the request and cross-family callers cannot read it', async () => {
  const { service } = buildService();
  const created = await service.createRequest(request());
  await assert.rejects(
    () => service.decideWithRemoteParent(created.requestId, created.familyId, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null }, {
      signature: 'bad', actorDeviceId: 'foreign-device', actionId: 'action-bad', idempotencyKey: 'idem-bad',
      issuedAt: new Date(NOW_MS), expiresAt: new Date(NOW_MS + 30_000),
    }),
    (error) => error.code === 'NOT_AUTHORIZED',
  );
  await assert.rejects(
    () => service.decideWithRemoteParent(created.requestId, 'other-family-84', { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null }, {
      signature: 'bad', actorDeviceId: 'foreign-device', actionId: 'action-bad-2', idempotencyKey: 'idem-bad-2',
      issuedAt: new Date(NOW_MS), expiresAt: new Date(NOW_MS + 30_000),
    }),
    (error) => error.code === 'NOT_FOUND',
  );
  assert.equal((await service.getRequest(created.familyId, created.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
  assert.equal(await service.getRequest('other-family-84', created.requestId), null);
});

test('expired requests cannot be decided', async () => {
  const { service, advance } = buildService();
  const created = await service.createRequest(request({ requestId: 'request-expired-84' }));
  advance(60_000);
  await assert.rejects(
    () => service.decideWithRemoteParent(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null }, {
      signature: 'opaque', actorDeviceId: 'trusted-parent-device-84', actionId: 'action-expired', idempotencyKey: 'idem-expired',
      issuedAt: new Date(NOW_MS), expiresAt: new Date(NOW_MS + 30_000),
    }),
    (error) => error.code === 'EXPIRED',
  );
});
