import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryProtectionApprovalRepository,
  ProtectionApprovalService,
} from '../../dist/enrollment/ProtectionApprovalService.js';
import {
  AdministrationPinService,
  InMemoryAdministrationPinRepository,
} from '../../dist/enrollment/AdministrationPinService.js';

const NOW = new Date('2026-08-19T00:00:00.000Z');

function request(overrides = {}) {
  return {
    requestId: 'request-persistence-84',
    familyId: 'family-persistence-84',
    childId: 'child-persistence-84',
    deviceId: 'device-persistence-84',
    operation: 'REMOVE_REVOKE_DEVICE',
    protectionLevel: 'PROTECTED',
    requestedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    reasonCategory: 'CHILD_SAFETY_CONCERN',
    protectiveAuthorityApplies: true,
    ...overrides,
  };
}

function buildService() {
  const repository = new InMemoryProtectionApprovalRepository();
  const pinService = new AdministrationPinService({
    repository: new InMemoryAdministrationPinRepository(),
    now: () => NOW,
    sleep: async () => {},
  });
  return new ProtectionApprovalService({
    repository,
    pinService,
    authority: {
      verifyRemoteDecision: async () => false,
      verifyAuthorizedRecovery: async () => false,
    },
    now: () => NOW,
  });
}

test('exact request replay is idempotent while a changed target under the same request id conflicts', async () => {
  const service = buildService();
  const first = await service.createRequest(request());
  const replay = await service.createRequest(request());
  assert.deepEqual(replay, first);
  await assert.rejects(
    () => service.createRequest(request({ deviceId: 'different-device-under-reused-request-id' })),
    (error) => error.code === 'CONFLICT',
  );
});

test('family listing is scoped and ordered newest first without exposing PIN material', async () => {
  const service = buildService();
  await service.createRequest(request({ requestId: 'request-persistence-old', requestedAt: new Date(NOW.getTime() - 1_000) }));
  await service.createRequest(request({ requestId: 'request-persistence-new' }));
  await service.createRequest(request({ requestId: 'request-persistence-other-family', familyId: 'family-other-84' }));
  const listed = await service.listRequests('family-persistence-84');
  assert.deepEqual(listed.map((item) => item.requestId), ['request-persistence-new', 'request-persistence-old']);
  assert.equal(listed.some((item) => 'pin' in item), false);
});
