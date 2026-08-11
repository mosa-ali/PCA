import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryChildRequestRepository } from '../../dist/childrequests/ChildRequestRepository.js';
import { ChildRequestError, ChildRequestService } from '../../dist/childrequests/ChildRequestService.js';

const T0 = new Date('2026-01-01T00:00:00Z');

function epoch() {
  return {
    familyId: 'fam-1',
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-child', role: 'CHILD', dskKeyId: 'k3', dskPublicKey: 'pk3', dekKeyId: 'k4', dekPublicKey: 'pk4', status: 'ACTIVE' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  };
}

function makeHarness(nowFn = () => T0) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(epoch());
  const resolver = new FamilyTrustSetRoleResolver(store);
  const authz = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, new InMemoryActionIdempotencyLedger(), nowFn);
  const repo = new InMemoryChildRequestRepository();
  const service = new ChildRequestService(repo, authz, nowFn);
  return { store, repo, service };
}

test('createDraft returns a DRAFT_LOCAL request that is never persisted', () => {
  const { repo, service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'BONUS_TIME', { kind: 'CHILD_PROFILE', id: 'child-1' });
  assert.equal(draft.state, 'DRAFT_LOCAL');
  return repo.get(draft.requestId).then((found) => assert.equal(found, null));
});

test('submit persists the request as PENDING', async () => {
  const { repo, service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  assert.equal(pending.state, 'PENDING');
  assert.notEqual(pending.correlationId, null);
  const found = await repo.get(pending.requestId);
  assert.equal(found.state, 'PENDING');
});

test('a child request cannot self-approve: the CHILD device deciding its own request is rejected', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'BONUS_TIME', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  await assert.rejects(
    () => service.decide(pending.requestId, 'dev-child', 'APPROVED', 'act-1', 'idem-1'),
    (err) => err instanceof ChildRequestError && err.code === 'NOT_AUTHORIZED_TO_DECIDE',
  );
});

test('an Owner can approve a pending request', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'BONUS_TIME', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  const decided = await service.decide(pending.requestId, 'dev-owner', 'APPROVED', 'act-2', 'idem-2');
  assert.equal(decided.state, 'APPROVED');
  assert.equal(decided.decidedByDeviceId, 'dev-owner');
  assert.equal(decided.decisionActionId, 'act-2');
});

test('an Owner can deny a pending request', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  const decided = await service.decide(pending.requestId, 'dev-owner', 'DENIED', 'act-3', 'idem-3');
  assert.equal(decided.state, 'DENIED');
});

test('deciding an already-decided request with a DIFFERENT outcome is an illegal transition', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  await service.decide(pending.requestId, 'dev-owner', 'DENIED', 'act-4', 'idem-4');
  await assert.rejects(
    () => service.decide(pending.requestId, 'dev-owner', 'APPROVED', 'act-5', 'idem-5'),
    (err) => err instanceof ChildRequestError && err.code === 'ILLEGAL_TRANSITION',
  );
});

test('a repeated decide() call with the SAME outcome and actor is idempotent', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  const first = await service.decide(pending.requestId, 'dev-owner', 'APPROVED', 'act-6', 'idem-6');
  const second = await service.decide(pending.requestId, 'dev-owner', 'APPROVED', 'act-6-retry', 'idem-6-retry');
  assert.deepEqual(second, first);
});

test('a request past its expiry cannot be decided and transitions to EXPIRED', async () => {
  let clock = T0;
  const { repo, service } = makeHarness(() => clock);
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);

  clock = new Date(pending.expiresAt.getTime() + 60_000);
  await assert.rejects(
    () => service.decide(pending.requestId, 'dev-owner', 'APPROVED', 'act-late', 'idem-late'),
    (err) => err instanceof ChildRequestError && err.code === 'REQUEST_EXPIRED',
  );
  const found = await repo.get(pending.requestId);
  assert.equal(found.state, 'EXPIRED');
});

test('cancel is only permitted by the requesting child device', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  await assert.rejects(
    () => service.cancel(pending.requestId, 'dev-owner'),
    (err) => err instanceof ChildRequestError && err.code === 'NOT_THE_REQUESTER',
  );
  const cancelled = await service.cancel(pending.requestId, 'dev-child');
  assert.equal(cancelled.state, 'CANCELLED');
});

test('acknowledgeApplied moves APPROVED to APPLIED_ACKNOWLEDGED only for the requesting child device', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  await service.decide(pending.requestId, 'dev-owner', 'APPROVED', 'act-7', 'idem-7');
  await assert.rejects(() => service.acknowledgeApplied(pending.requestId, 'dev-owner'), ChildRequestError);
  const acknowledged = await service.acknowledgeApplied(pending.requestId, 'dev-child');
  assert.equal(acknowledged.state, 'APPLIED_ACKNOWLEDGED');
});

test('DENIED and CANCELLED and EXPIRED are terminal -- no further transition is legal', async () => {
  const { service } = makeHarness();
  const draft = service.createDraft('fam-1', 'dev-child', 'child-1', 'UNBLOCK', { kind: 'CHILD_PROFILE', id: 'child-1' });
  const pending = await service.submit(draft);
  const denied = await service.decide(pending.requestId, 'dev-owner', 'DENIED', 'act-8', 'idem-8');
  assert.equal(denied.state, 'DENIED');
  await assert.rejects(() => service.acknowledgeApplied(pending.requestId, 'dev-child'), ChildRequestError);
});
