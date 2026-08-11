import assert from 'node:assert/strict';
import test from 'node:test';
import { BlockDecisionStateService, InMemoryBlockDecisionStateRepository } from '../../dist/safebrowser/BlockDecisionStateStore.js';
import {
  InMemoryParentUnblockRequestRepository,
  ParentUnblockRequestService,
  UnblockRequestError,
} from '../../dist/safebrowser/ParentUnblockRequestService.js';

function decision(overrides = {}) {
  return {
    domain: 'blocked.example',
    outcome: 'BLOCK',
    source: 'PARENT_DENYLIST',
    reasonCode: "blocked by your family's block list",
    coverage: 'DOMAIN_ONLY',
    ...overrides,
  };
}

async function setup(decisionOverrides = {}) {
  const decisions = new InMemoryBlockDecisionStateRepository();
  const decisionService = new BlockDecisionStateService(decisions, () => new Date('2026-01-01T00:00:00Z'));
  const built = decision(decisionOverrides);
  const state = await decisionService.record('fam-1', 'prof-1', `https://${built.domain}/`, null, built);
  const requests = new InMemoryParentUnblockRequestRepository();
  const service = new ParentUnblockRequestService(requests, decisions, () => new Date('2026-01-01T00:00:00Z'));
  return { state, requests, service };
}

test('submit creates a PENDING request tied to the block decision', async () => {
  const { state, service } = await setup();
  const request = await service.submit('fam-1', 'prof-1', state.id);
  assert.equal(request.status, 'PENDING');
  assert.equal(request.blockDecisionId, state.id);
  assert.equal(request.domain, 'blocked.example');
});

test('submit rejects a request for a non-requestable (security) block', async () => {
  const { state, service } = await setup({ domain: 'malware.example', source: 'SECURITY_DENYLIST' });
  await assert.rejects(
    () => service.submit('fam-1', 'prof-1', state.id),
    (err) => err instanceof UnblockRequestError && err.code === 'NOT_REQUESTABLE',
  );
});

test('submit rejects a second request while one is already pending', async () => {
  const { state, service } = await setup();
  await service.submit('fam-1', 'prof-1', state.id);
  await assert.rejects(
    () => service.submit('fam-1', 'prof-1', state.id),
    (err) => err instanceof UnblockRequestError && err.code === 'ALREADY_PENDING',
  );
});

test('approvePermanent moves PENDING to APPROVED_PERMANENT', async () => {
  const { state, service } = await setup();
  const request = await service.submit('fam-1', 'prof-1', state.id);
  const decided = await service.approvePermanent(request.id);
  assert.equal(decided.status, 'APPROVED_PERMANENT');
  assert.notEqual(decided.decidedAt, null);
});

test('approveTemporary sets an expiry and rejects a non-positive duration', async () => {
  const { state, service } = await setup();
  const request = await service.submit('fam-1', 'prof-1', state.id);
  const decided = await service.approveTemporary(request.id, 3600_000);
  assert.equal(decided.status, 'APPROVED_TEMPORARY');
  assert.equal(decided.temporaryApprovalExpiresAt.getTime(), new Date('2026-01-01T01:00:00Z').getTime());

  const { state: state2, service: service2 } = await setup();
  const request2 = await service2.submit('fam-1', 'prof-1', state2.id);
  await assert.rejects(
    () => service2.approveTemporary(request2.id, -1),
    (err) => err instanceof UnblockRequestError && err.code === 'INVALID_DURATION',
  );
});

test('a decided request cannot be decided again', async () => {
  const { state, service } = await setup();
  const request = await service.submit('fam-1', 'prof-1', state.id);
  await service.deny(request.id);
  await assert.rejects(
    () => service.approvePermanent(request.id),
    (err) => err instanceof UnblockRequestError && err.code === 'ILLEGAL_TRANSITION',
  );
});

test('submit rejects a reference to a nonexistent block decision', async () => {
  const { service } = await setup();
  await assert.rejects(
    () => service.submit('fam-1', 'prof-1', 'does-not-exist'),
    (err) => err instanceof UnblockRequestError && err.code === 'DECISION_NOT_FOUND',
  );
});
