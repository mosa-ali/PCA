import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import {
  InMemoryRemovalDecisionReplayLedger,
  InMemoryRemovalDecisionRepository,
  RemovalDecisionError,
  RemovalDecisionService,
  canonicalizeRemovalDecision,
} from '../../dist/familyrbac/RemovalDecisionService.js';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const FAMILY = 'family-84';
const CHILD = 'child-84';
const DEVICE = 'device-84';
const OWNER = 'owner-84';
const ADMIN = 'admin-84';
const VIEWER = 'viewer-84';
const OTHER_FAMILY_OWNER = 'other-family-owner-84';
const PUBLIC_KEY = 'public-key-84';

function actorResolver(entries = {}) {
  return {
    resolveActor(familyId, deviceId) {
      const entry = entries[deviceId];
      if (entry === undefined || entry.familyId !== familyId) return 'FAMILY_MISMATCH';
      return { deviceId, role: entry.role, trustSetEpoch: 7, keyEpoch: 3 };
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

function signingKeyResolver() {
  return {
    async resolve(familyId, actorDeviceId) {
      if (familyId !== FAMILY || actorDeviceId === OTHER_FAMILY_OWNER) return null;
      if (![OWNER, ADMIN, VIEWER].includes(actorDeviceId)) return null;
      return { familyId, deviceId: actorDeviceId, publicKey: PUBLIC_KEY };
    },
  };
}

function signatureVerifier() {
  return {
    async verify(publicKey, message, signature) {
      return signature === createHash('sha256').update(`${publicKey}:${message}`, 'utf8').digest('hex');
    },
  };
}

function makeService({ adminEnabled = false, actor = OWNER, repository = new InMemoryRemovalDecisionRepository(), now = () => NOW } = {}) {
  const auditRepository = new InMemoryFamilyAuditRepository();
  const audit = new FamilyAuditService(auditRepository, now);
  const authorization = new ParentActionAuthorizationService(
    actorResolver({
      [OWNER]: { familyId: FAMILY, role: 'OWNER' },
      [ADMIN]: { familyId: FAMILY, role: 'ADMINISTRATOR' },
      [VIEWER]: { familyId: FAMILY, role: 'VIEWER' },
      [OTHER_FAMILY_OWNER]: { familyId: 'family-other', role: 'OWNER' },
      [DEVICE]: { familyId: FAMILY, role: 'CHILD' },
    }),
    () => ({
      ...defaultFamilyRbacPolicyConfig(),
      administratorCanRevokeDeviceOrDisableProtection: adminEnabled,
    }),
    new InMemoryActionIdempotencyLedger(),
    now,
    childMembership(),
    audit,
  );
  const service = new RemovalDecisionService({
    repository,
    authorization,
    signingKeyResolver: signingKeyResolver(),
    signatureVerifier: signatureVerifier(),
    targetDeviceRoleResolver: actorResolver({
      [OWNER]: { familyId: FAMILY, role: 'OWNER' },
      [ADMIN]: { familyId: FAMILY, role: 'ADMINISTRATOR' },
      [VIEWER]: { familyId: FAMILY, role: 'VIEWER' },
      [OTHER_FAMILY_OWNER]: { familyId: 'family-other', role: 'OWNER' },
      [DEVICE]: { familyId: FAMILY, role: 'CHILD' },
    }),
    replayLedger: new InMemoryRemovalDecisionReplayLedger(),
    auditService: audit,
    now,
  });
  return { service, repository, auditRepository };
}

async function createPending(service, overrides = {}) {
  return service.createRequest({
    requestId: overrides.requestId ?? `request-${Math.random().toString(16).slice(2)}`,
    familyId: FAMILY,
    childId: CHILD,
    deviceId: DEVICE,
    operation: overrides.operation ?? 'REMOVE_REVOKE_DEVICE',
    protectionLevel: overrides.protectionLevel ?? 'PROTECTED',
    requestedAt: new Date(NOW.getTime() - 1_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    reasonCategory: overrides.reasonCategory ?? 'ROUTINE_POLICY_CHANGE',
  });
}

function unsignedDecision(request, overrides = {}) {
  return {
    requestId: request.requestId,
    familyId: request.familyId,
    childId: request.childId,
    deviceId: request.deviceId,
    operation: request.operation,
    protectionLevel: request.protectionLevel,
    reasonCategory: request.reasonCategory,
    decision: overrides.decision ?? 'KEEP_ACTIVE',
    temporaryDisableUntil: overrides.temporaryDisableUntil ?? null,
    actorDeviceId: overrides.actorDeviceId ?? OWNER,
    actionId: overrides.actionId ?? `action-${request.requestId}`,
    idempotencyKey: overrides.idempotencyKey ?? `idem-${request.requestId}`,
    trustSetEpoch: 7,
    policyRevision: 4,
    issuedAt: new Date(NOW.getTime() - 500),
    expiresAt: new Date(NOW.getTime() + 30_000),
    stepUp: {
      state: 'FRESH',
      assertedAt: new Date(NOW.getTime() - 100),
      freshUntil: new Date(NOW.getTime() + 10_000),
    },
  };
}

function sign(unsigned) {
  return {
    ...unsigned,
    signature: createHash('sha256').update(`${PUBLIC_KEY}:${canonicalizeRemovalDecision(unsigned)}`, 'utf8').digest('hex'),
  };
}

test('Owner can apply KEEP_ACTIVE and the exact decision is audited', async () => {
  const { service, auditRepository } = makeService();
  const request = await createPending(service, { requestId: 'request-owner' });
  const result = await service.decide(sign(unsignedDecision(request)));
  assert.equal(result.state, 'KEEP_ACTIVE');
  assert.equal(result.childId, CHILD);
  assert.equal(result.deviceId, DEVICE);
  const events = await auditRepository.listForFamily(FAMILY);
  assert.ok(events.some((event) => event.resultStatus === 'SUCCESS' && event.actionId === result.decisionActionId));
});

test('Administrator is allowed only when the existing family policy enables it', async () => {
  const denied = makeService();
  const deniedRequest = await createPending(denied.service, { requestId: 'request-admin-denied' });
  await assert.rejects(
    denied.service.decide(sign(unsignedDecision(deniedRequest, { actorDeviceId: ADMIN }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );

  const allowed = makeService({ adminEnabled: true });
  const allowedRequest = await createPending(allowed.service, { requestId: 'request-admin-allowed' });
  const result = await allowed.service.decide(sign(unsignedDecision(allowedRequest, { actorDeviceId: ADMIN, decision: 'ALLOW_REMOVAL' })));
  assert.equal(result.state, 'ALLOW_REMOVAL');
});

test('Viewer and wrong-family actors fail closed', async () => {
  const viewer = makeService();
  const viewerRequest = await createPending(viewer.service, { requestId: 'request-viewer' });
  await assert.rejects(
    viewer.service.decide(sign(unsignedDecision(viewerRequest, { actorDeviceId: VIEWER }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );

  const wrongFamily = makeService();
  const wrongFamilyRequest = await createPending(wrongFamily.service, { requestId: 'request-wrong-family' });
  await assert.rejects(
    wrongFamily.service.decide(sign(unsignedDecision(wrongFamilyRequest, { actorDeviceId: OTHER_FAMILY_OWNER }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );
});

test('a foreign target device fails closed even when the signed actor is an Owner', async () => {
  const { service } = makeService();
  const request = await createPending(service, { requestId: 'request-foreign-device' });
  request.deviceId = 'device-from-another-family';
  const signed = sign(unsignedDecision(request, { actionId: 'action-foreign-device' }));
  await assert.rejects(
    service.decide(signed),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );
});

test('signature binding rejects child/device/request substitution and invalid signatures', async () => {
  const { service } = makeService();
  const request = await createPending(service, { requestId: 'request-binding' });
  const substituted = sign(unsignedDecision(request, { actionId: 'action-substitution' }));
  substituted.deviceId = 'device-other';
  await assert.rejects(
    service.decide(substituted),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_INPUT',
  );

  const invalid = { ...sign(unsignedDecision(request, { actionId: 'action-invalid-signature' })), signature: 'forged' };
  await assert.rejects(
    service.decide(invalid),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_SIGNATURE',
  );

  const completed = await service.decide(sign(unsignedDecision(request, { actionId: 'action-completed' })));
  await assert.rejects(
    service.decide({ ...unsignedDecision(request, { actionId: 'action-completed' }), signature: 'forged-retry' }),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_SIGNATURE',
  );
  assert.equal(completed.state, 'KEEP_ACTIVE');
});

test('malformed runtime step-up input fails closed with a controlled error', async () => {
  const { service } = makeService();
  const request = await createPending(service, { requestId: 'request-malformed-step-up' });
  const unsigned = unsignedDecision(request, { actionId: 'action-malformed-step-up' });
  unsigned.stepUp = null;
  await assert.rejects(
    service.decide({ ...unsigned, signature: 'not-used' }),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_INPUT',
  );
});

test('expired and malformed temporary decisions fail before state mutation', async () => {
  let clock = NOW;
  const { service } = makeService({ now: () => clock });
  const request = await createPending(service, { requestId: 'request-expired' });
  clock = new Date(NOW.getTime() + 60_000);
  await assert.rejects(
    service.decide(sign(unsignedDecision(request, { actionId: 'action-expired' }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'ACTION_EXPIRED',
  );

  clock = NOW;
  const temporaryRequest = await createPending(service, { requestId: 'request-temporary' });
  await assert.rejects(
    service.decide(sign(unsignedDecision(temporaryRequest, {
      decision: 'TEMPORARILY_DISABLE',
      temporaryDisableUntil: new Date(NOW.getTime() + 120_000),
      actionId: 'action-temporary-invalid',
    }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_INPUT',
  );
  assert.equal((await service.getRequest(temporaryRequest.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
});

test('same signed action is idempotent, while replay on another request is rejected', async () => {
  const { service } = makeService();
  const request = await createPending(service, { requestId: 'request-idempotent-a' });
  const signed = sign(unsignedDecision(request, { actionId: 'action-replay-once', idempotencyKey: 'idem-replay-once' }));
  const first = await service.decide(signed);
  const second = await service.decide(signed);
  assert.equal(second.decisionFingerprint, first.decisionFingerprint);
  assert.equal(second.state, first.state);

  const otherRequest = await createPending(service, { requestId: 'request-idempotent-b' });
  await assert.rejects(
    service.decide(sign(unsignedDecision(otherRequest, { actionId: 'action-replay-once', idempotencyKey: 'idem-replay-other' }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'REPLAYED_ACTION',
  );
});

test('TEMPORARILY_DISABLE requires a bounded future deadline and preserves the exact supplied reason category', async () => {
  const { service } = makeService({ adminEnabled: true });
  const request = await createPending(service, {
    requestId: 'request-temporary-valid',
    operation: 'DISABLE_PROTECTION_POLICY',
    reasonCategory: 'CHILD_SAFETY_CONCERN',
  });
  const result = await service.decide(sign(unsignedDecision(request, {
    actorDeviceId: ADMIN,
    decision: 'TEMPORARILY_DISABLE',
    temporaryDisableUntil: new Date(NOW.getTime() + 20_000),
  })));
  assert.equal(result.state, 'TEMPORARILY_DISABLE');
  assert.equal(result.reasonCategory, 'CHILD_SAFETY_CONCERN');
  assert.equal(result.temporaryDisableUntil?.getTime(), NOW.getTime() + 20_000);
});
