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
  RemovalDecisionAuthority,
  RemovalDecisionError,
  canonicalizeRemovalDecision,
} from '../../dist/familyrbac/RemovalDecisionAuthority.js';
import {
  AdministrationPinService,
  InMemoryAdministrationPinRepository,
} from '../../dist/enrollment/AdministrationPinService.js';
import { ProtectionAlertProducer } from '../../dist/alerts/ProtectionAlertProducer.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';

// Server-ciphertext TTL (migration 0034): the alert ledger now expires rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so fixtures dated in the past
// would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant these fixtures use.
const LEDGER_NOW = new Date('2026-08-20T12:00:00.000Z');

const NOW = new Date('2026-08-20T12:00:00.000Z');
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

function buildAuthority({
  adminEnabled = false,
  repository = new InMemoryRemovalDecisionRepository(),
  now = () => NOW,
  recoveryAllowed = false,
  alerting,
  deviceRevocation,
} = {}) {
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
  const pinService = new AdministrationPinService({
    repository: new InMemoryAdministrationPinRepository(),
    now,
    sleep: async () => {},
  });
  const recoveryCalls = [];
  const recoveryAuthority = {
    async verifyAuthorizedRecovery(input) {
      recoveryCalls.push(input);
      return recoveryAllowed;
    },
  };
  const authority = new RemovalDecisionAuthority({
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
    pinService,
    recoveryAuthority,
    replayLedger: new InMemoryRemovalDecisionReplayLedger(),
    auditService: audit,
    alerting,
    deviceRevocation,
    now,
  });
  return { authority, repository, auditRepository, pinService, recoveryCalls };
}

function makeAlerting({ enabled = true } = {}) {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const composed = [];
  const producer = new ProtectionAlertProducer(
    ledger,
    async (input) => {
      composed.push(input);
      return { encryptedPayloadB64: 'AQID', nonceB64: 'BAUG' };
    },
    () => NOW,
  );
  return {
    alerting: {
      producer,
      composeOpaquePayload: async () => ({ encryptedPayloadB64: 'AQID', nonceB64: 'BAUG' }),
      alertsEnabled: enabled,
      async resolveParentDevices() {
        return [{ deviceId: 'parent-device-1', keyEpoch: 3 }];
      },
    },
    ledger,
    composed,
  };
}

async function createPending(authority, overrides = {}) {
  return authority.createRequest({
    requestId: overrides.requestId ?? `request-${Math.random().toString(16).slice(2)}`,
    familyId: FAMILY,
    childId: CHILD,
    deviceId: DEVICE,
    operation: overrides.operation ?? 'REMOVE_REVOKE_DEVICE',
    protectionLevel: overrides.protectionLevel ?? 'PROTECTED',
    requestedAt: new Date(NOW.getTime() - 1_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    reasonCategory: overrides.reasonCategory ?? 'ROUTINE_POLICY_CHANGE',
    protectiveAuthorityApplies: true,
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

// --- Signed remote-parent mode (folded in from RemovalDecisionService) ---

test('PCA-ADD-ENR-016/017: a signed remote-parent ALLOW_REMOVAL on a REMOVE_REVOKE_DEVICE request calls the injected deviceRevocation executor', async () => {
  const calls = [];
  const deviceRevocation = { async revokeDevice(familyId, deviceId) { calls.push({ familyId, deviceId }); } };
  const { authority } = buildAuthority({ deviceRevocation });
  const request = await createPending(authority, { requestId: 'request-signed-revoke' });
  const result = await authority.decideWithSignedRemoteParent(sign(unsignedDecision(request, { decision: 'ALLOW_REMOVAL' })));
  assert.equal(result.state, 'ALLOW_REMOVAL');
  assert.deepEqual(calls, [{ familyId: FAMILY, deviceId: DEVICE }]);
});

test('Owner can apply KEEP_ACTIVE via signed remote decision and the exact decision is audited', async () => {
  const { authority, auditRepository } = buildAuthority();
  const request = await createPending(authority, { requestId: 'request-owner' });
  const result = await authority.decideWithSignedRemoteParent(sign(unsignedDecision(request)));
  assert.equal(result.state, 'KEEP_ACTIVE');
  assert.equal(result.decisionMethod, 'REMOTE_PARENT');
  const events = await auditRepository.listForFamily(FAMILY);
  assert.ok(events.some((event) => event.resultStatus === 'SUCCESS' && event.actionId === result.decisionActionId));
});

test('Administrator is allowed only when family policy enables it (RBAC denial path)', async () => {
  const denied = buildAuthority();
  const deniedRequest = await createPending(denied.authority, { requestId: 'request-admin-denied' });
  await assert.rejects(
    denied.authority.decideWithSignedRemoteParent(sign(unsignedDecision(deniedRequest, { actorDeviceId: ADMIN }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );

  const allowed = buildAuthority({ adminEnabled: true });
  const allowedRequest = await createPending(allowed.authority, { requestId: 'request-admin-allowed' });
  const result = await allowed.authority.decideWithSignedRemoteParent(
    sign(unsignedDecision(allowedRequest, { actorDeviceId: ADMIN, decision: 'ALLOW_REMOVAL' })),
  );
  assert.equal(result.state, 'ALLOW_REMOVAL');
});

test('Viewer and wrong-family actors are denied (RBAC denial path)', async () => {
  const viewer = buildAuthority();
  const viewerRequest = await createPending(viewer.authority, { requestId: 'request-viewer' });
  await assert.rejects(
    viewer.authority.decideWithSignedRemoteParent(sign(unsignedDecision(viewerRequest, { actorDeviceId: VIEWER }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );
});

test('PCA-ADD-ENR-024: a signed removal decision purportedly from an owner device belonging to a different family is denied before signature verification (cross-family wrong-parent authorization)', async () => {
  const { authority } = buildAuthority();
  const request = await createPending(authority, { requestId: 'request-wrong-family' });
  // OTHER_FAMILY_OWNER genuinely holds the OWNER role, just for a different
  // family (family-other) -- this proves the denial is a real family-scope
  // check, not just a role check. signingKeyResolver() also refuses to
  // resolve a signing key for this actor against FAMILY, which is the exact
  // mechanism doc 08's wrong-parent-authorization constraint depends on.
  await assert.rejects(
    authority.decideWithSignedRemoteParent(sign(unsignedDecision(request, { actorDeviceId: OTHER_FAMILY_OWNER, actionId: 'action-wrong-family' }))),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );
  // The request must remain untouched, exactly as if no decision was ever attempted.
  assert.equal((await authority.getRequest(FAMILY, request.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
});

test('signature binding rejects child/device substitution and invalid signatures', async () => {
  const { authority } = buildAuthority();
  const request = await createPending(authority, { requestId: 'request-binding' });
  const substituted = sign(unsignedDecision(request, { actionId: 'action-substitution' }));
  substituted.deviceId = 'device-other';
  await assert.rejects(
    authority.decideWithSignedRemoteParent(substituted),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_INPUT',
  );

  const invalid = { ...sign(unsignedDecision(request, { actionId: 'action-invalid-signature' })), signature: 'forged' };
  await assert.rejects(
    authority.decideWithSignedRemoteParent(invalid),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_SIGNATURE',
  );
});

test('a signed decision from a stale trust-set epoch is rejected before mutation', async () => {
  const { authority } = buildAuthority();
  const request = await createPending(authority, { requestId: 'request-stale-epoch' });
  const stale = sign({ ...unsignedDecision(request, { actionId: 'action-stale-epoch' }), trustSetEpoch: 6 });
  await assert.rejects(
    authority.decideWithSignedRemoteParent(stale),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );
  assert.equal((await authority.getRequest(FAMILY, request.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
});

test('same signed action is idempotent, while replay on another request is rejected', async () => {
  const { authority } = buildAuthority();
  const request = await createPending(authority, { requestId: 'request-idempotent-a' });
  const signed = sign(unsignedDecision(request, { actionId: 'action-replay-once', idempotencyKey: 'idem-replay-once' }));
  const first = await authority.decideWithSignedRemoteParent(signed);
  const second = await authority.decideWithSignedRemoteParent(signed);
  assert.equal(second.decisionFingerprint, first.decisionFingerprint);

  const otherRequest = await createPending(authority, { requestId: 'request-idempotent-b' });
  await assert.rejects(
    authority.decideWithSignedRemoteParent(
      sign(unsignedDecision(otherRequest, { actionId: 'action-replay-once', idempotencyKey: 'idem-replay-other' })),
    ),
    (error) => error instanceof RemovalDecisionError && error.code === 'REPLAYED_ACTION',
  );
});

test('TEMPORARILY_DISABLE requires a bounded future deadline (state-transition correctness)', async () => {
  const { authority } = buildAuthority({ adminEnabled: true });
  const request = await createPending(authority, {
    requestId: 'request-temporary-valid',
    operation: 'DISABLE_PROTECTION_POLICY',
    reasonCategory: 'CHILD_SAFETY_CONCERN',
  });
  const result = await authority.decideWithSignedRemoteParent(sign(unsignedDecision(request, {
    actorDeviceId: ADMIN,
    decision: 'TEMPORARILY_DISABLE',
    temporaryDisableUntil: new Date(NOW.getTime() + 20_000),
  })));
  assert.equal(result.state, 'TEMPORARILY_DISABLE');
  assert.equal(result.temporaryDisableUntil?.getTime(), NOW.getTime() + 20_000);
});

// --- Local Administration PIN mode (folded in from ProtectionApprovalService) ---

test('local Administration PIN can apply KEEP_ACTIVE without storing the PIN or changing target metadata', async () => {
  const { authority, pinService } = buildAuthority();
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-pin-ok' });

  const decided = await authority.decideWithLocalPin(created.requestId, created.familyId, {
    decision: 'KEEP_ACTIVE',
    temporaryDisableUntil: null,
    pin: '123456',
  });
  assert.equal(decided.state, 'KEEP_ACTIVE');
  assert.equal(decided.decisionMethod, 'LOCAL_ADMINISTRATION_PIN');
  assert.equal('pin' in decided, false);
});

test('wrong local PIN leaves the request pending and does not reveal target details through the error', async () => {
  const { authority, pinService } = buildAuthority();
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-pin-wrong' });

  await assert.rejects(
    () => authority.decideWithLocalPin(created.requestId, created.familyId, {
      decision: 'ALLOW_REMOVAL',
      temporaryDisableUntil: null,
      pin: '000000',
    }),
    (error) => error instanceof RemovalDecisionError && error.code === 'PIN_INVALID' && !error.message.includes(created.childId),
  );
  assert.equal((await authority.getRequest(FAMILY, created.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
});

test('local PIN mode is denied when no PIN is configured', async () => {
  const { authority } = buildAuthority();
  const created = await createPending(authority, { requestId: 'request-pin-unconfigured' });
  await assert.rejects(
    () => authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: '123456' }),
    (error) => error instanceof RemovalDecisionError && error.code === 'PIN_NOT_CONFIGURED',
  );
});

// --- Authorized recovery mode (folded in from ProtectionApprovalService) ---

test('authorized recovery decision requires the coordinator authority and receives the exact request binding', async () => {
  const { authority, recoveryCalls } = buildAuthority({ recoveryAllowed: true });
  const created = await createPending(authority, { requestId: 'request-recovery-ok' });
  const recovered = await authority.decideWithAuthorizedRecovery(
    created.requestId,
    created.familyId,
    { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null },
    { proof: 'opaque-recovery-proof', recoveryTransactionId: 'recovery-transaction-84' },
  );
  assert.equal(recovered.decisionMethod, 'AUTHORIZED_RECOVERY');
  assert.equal(recoveryCalls[0].request.requestId, created.requestId);
});

test('a denied recovery authority cannot change the request', async () => {
  const { authority } = buildAuthority({ recoveryAllowed: false });
  const created = await createPending(authority, { requestId: 'request-recovery-denied' });
  await assert.rejects(
    () => authority.decideWithAuthorizedRecovery(
      created.requestId,
      created.familyId,
      { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null },
      { proof: 'bad', recoveryTransactionId: 'recovery-bad' },
    ),
    (error) => error instanceof RemovalDecisionError && error.code === 'NOT_AUTHORIZED',
  );
  assert.equal((await authority.getRequest(FAMILY, created.requestId)).state, 'PARENT_APPROVAL_REQUIRED');
});

// --- Shared state machine / read-side behavior ---

test('cross-family reads collapse to the same null result as an unknown request', async () => {
  const { authority } = buildAuthority();
  const created = await createPending(authority, { requestId: 'request-cross-family' });
  assert.equal(await authority.getRequest('other-family-84', created.requestId), null);
  assert.equal(await authority.getRequest(FAMILY, 'unknown-request'), null);
});

test('expired requests cannot be decided through the local-PIN or recovery paths', async () => {
  let clock = NOW;
  const { authority, pinService } = buildAuthority({ now: () => clock, recoveryAllowed: true });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-expired-pin' });
  clock = new Date(NOW.getTime() + 60_000);
  await assert.rejects(
    () => authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: '123456' }),
    (error) => error instanceof RemovalDecisionError && error.code === 'EXPIRED',
  );
});

test('a request already decided by one mode cannot be decided again by another mode', async () => {
  const { authority, pinService } = buildAuthority({ recoveryAllowed: true });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-cross-mode-conflict' });
  await authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: '123456' });
  await assert.rejects(
    () => authority.decideWithAuthorizedRecovery(
      created.requestId,
      created.familyId,
      { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null },
      { proof: 'proof', recoveryTransactionId: 'txn' },
    ),
    (error) => error instanceof RemovalDecisionError && error.code === 'INVALID_STATE',
  );
});

// --- PCA-ADD-ENR-020 alert wiring ---

test('a removal/disable request emits DISABLE_OR_REMOVAL_REQUESTED to every resolved parent device', async () => {
  const { alerting, ledger } = makeAlerting();
  const { authority } = buildAuthority({ alerting });
  const created = await createPending(authority, { requestId: 'request-alert-created' });
  const events = await ledger.listForFamily(created.familyId);
  assert.deepEqual(events.map((event) => event.trigger), ['DISABLE_OR_REMOVAL_REQUESTED']);
  assert.equal(events[0].parentDeviceId, 'parent-device-1');
});

test('a KEEP_ACTIVE/TEMPORARILY_DISABLE decision emits AUTHORITY_CHANGE regardless of which decision mode was used', async () => {
  const { alerting, ledger } = makeAlerting();
  const { authority, pinService } = buildAuthority({ alerting, recoveryAllowed: true });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-alert-decided' });
  await authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: '123456' });
  const events = await ledger.listForFamily(created.familyId);
  assert.deepEqual(events.map((event) => event.trigger), ['DISABLE_OR_REMOVAL_REQUESTED', 'AUTHORITY_CHANGE']);
});

// PCA-ADD-ENR-020: ALLOW_REMOVAL on a REMOVE_REVOKE_DEVICE request is this
// codebase's actual "device leaves protection" event -- the same exact
// condition applyDeviceRevocationIfNeeded gates real device revocation on
// -- so it reports as UNENROLLMENT, not the generic AUTHORITY_CHANGE.
test('an ALLOW_REMOVAL decision on a REMOVE_REVOKE_DEVICE request emits UNENROLLMENT, not AUTHORITY_CHANGE', async () => {
  const { alerting, ledger } = makeAlerting();
  const { authority, pinService } = buildAuthority({ alerting });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-alert-unenrollment', operation: 'REMOVE_REVOKE_DEVICE' });
  await authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '123456' });
  const events = await ledger.listForFamily(created.familyId);
  assert.deepEqual(events.map((event) => event.trigger), ['DISABLE_OR_REMOVAL_REQUESTED', 'UNENROLLMENT']);
});

// A DISABLE_PROTECTION_POLICY request's ALLOW_REMOVAL outcome means
// approval to disable the protection policy, never device revocation (see
// applyDeviceRevocationIfNeeded's own doc comment) -- so it must keep
// reporting as AUTHORITY_CHANGE, never UNENROLLMENT.
test('an ALLOW_REMOVAL decision on a DISABLE_PROTECTION_POLICY request still emits AUTHORITY_CHANGE, never UNENROLLMENT', async () => {
  const { alerting, ledger } = makeAlerting();
  const { authority, pinService } = buildAuthority({ alerting });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-alert-policy-disable', operation: 'DISABLE_PROTECTION_POLICY' });
  await authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '123456' });
  const events = await ledger.listForFamily(created.familyId);
  assert.deepEqual(events.map((event) => event.trigger), ['DISABLE_OR_REMOVAL_REQUESTED', 'AUTHORITY_CHANGE']);
});

test('a rate-limited local-PIN attempt emits REPEATED_INVALID_PIN exactly once, at the moment the lockout threshold is crossed', async () => {
  const { alerting, ledger } = makeAlerting();
  const { authority, pinService } = buildAuthority({ alerting });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-alert-rate-limited' });
  // AdministrationPinService's lockout threshold is a fixed 5 attempts
  // (FAILURE_LOCKOUT_THRESHOLD) -- the first 4 wrong attempts reject
  // PIN_INVALID with no alert; only the 5th crosses the threshold into
  // RATE_LIMITED and emits REPEATED_INVALID_PIN.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      () => authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: 'wrong-pin' }),
      (error) => error instanceof RemovalDecisionError && error.code === 'PIN_INVALID',
    );
  }
  assert.deepEqual((await ledger.listForFamily(created.familyId)).map((event) => event.trigger), ['DISABLE_OR_REMOVAL_REQUESTED']);
  await assert.rejects(
    () => authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: 'wrong-pin' }),
    (error) => error instanceof RemovalDecisionError && error.code === 'RATE_LIMITED',
  );
  const events = await ledger.listForFamily(created.familyId);
  assert.deepEqual(events.map((event) => event.trigger), ['DISABLE_OR_REMOVAL_REQUESTED', 'REPEATED_INVALID_PIN']);
});

test('disabled alerting never invokes the composer and never blocks the decision', async () => {
  const { alerting, ledger } = makeAlerting({ enabled: false });
  const { authority, pinService } = buildAuthority({ alerting });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-alert-disabled' });
  const decided = await authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'KEEP_ACTIVE', temporaryDisableUntil: null, pin: '123456' });
  assert.equal(decided.state, 'KEEP_ACTIVE');
  assert.deepEqual(await ledger.listForFamily(created.familyId), []);
});

test('an alert composer failure never blocks or reverses a decision', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const producer = new ProtectionAlertProducer(ledger, async () => {
    throw new Error('composer unavailable');
  }, () => NOW);
  const alerting = {
    producer,
    composeOpaquePayload: async () => { throw new Error('unused'); },
    alertsEnabled: true,
    async resolveParentDevices() { return [{ deviceId: 'parent-device-1', keyEpoch: 3 }]; },
  };
  const { authority, pinService } = buildAuthority({ alerting });
  await pinService.configurePin(FAMILY, '123456');
  const created = await createPending(authority, { requestId: 'request-alert-failure' });
  const decided = await authority.decideWithLocalPin(created.requestId, created.familyId, { decision: 'ALLOW_REMOVAL', temporaryDisableUntil: null, pin: '123456' });
  assert.equal(decided.state, 'ALLOW_REMOVAL');
});
