import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';
import { registerRemovalDecisionRoutes } from '../../dist/http/routes/removalDecisionRoutes.js';
import { RemovalDecisionAuthority, InMemoryRemovalDecisionRepository } from '../../dist/familyrbac/RemovalDecisionAuthority.js';
import { UnavailableRemovalDecisionSigningKeyResolver } from '../../dist/familyrbac/UnavailableRemovalDecisionSigningKeyResolver.js';
import { UnavailableAuthorizedRecoveryAuthority } from '../../dist/familyrbac/UnavailableAuthorizedRecoveryAuthority.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { AdministrationPinService, InMemoryAdministrationPinRepository } from '../../dist/enrollment/AdministrationPinService.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';

// Coordinator wiring regression coverage (this task): proves
// RemovalDecisionAuthority's THREE decision modes behave exactly as the
// Coordinator's honest wiring intends once composed the way main.ts now
// composes them:
//   - local Administration PIN: genuinely production-ready (real
//     AdministrationPinService), so it must actually work end-to-end.
//   - signed remote-parent / authorized recovery: no real production
//     implementation exists yet, so both must fail closed (NOT_AUTHORIZED)
//     via the honestly-named Unavailable* stubs -- never crash, never
//     silently succeed.
// Uses the real RemovalDecisionAuthority/AdministrationPinService classes
// (only the repository/ledger/audit backing stores are the in-memory
// reference implementations, exactly mirroring main.ts's use of
// MySqlRemovalDecisionRepository/MySqlAdministrationPinRepository in
// production), so this exercises the actual wiring shape, not a
// reimplementation of it.

function buildApp({ parentRole = 'ADMINISTRATOR', roleLookupError = false, removalTargetResolver } = {}) {
  const familyId = 'family-a';
  const sessions = new Map([['session-a', { accountId: 'account-a', familyId }]]);
  const stepUpGrants = new Map();
  const stepUpCalls = [];
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole() {
      if (roleLookupError) throw new Error('role lookup unavailable');
      return parentRole;
    },
    async consumeSensitiveStepUpForSession(rawSessionToken, requestedFamilyId, operation, token) {
      stepUpCalls.push({ rawSessionToken, familyId: requestedFamilyId, operation, token });
      if (typeof token !== 'string') return false;
      const grant = stepUpGrants.get(token);
      if (
        !grant || grant.consumed || grant.rawSessionToken !== rawSessionToken ||
        grant.familyId !== requestedFamilyId || grant.operation !== operation
      ) return false;
      grant.consumed = true;
      return true;
    },
  };

  const pinService = new AdministrationPinService({ repository: new InMemoryAdministrationPinRepository() });
  const removalDecisionAuthority = new RemovalDecisionAuthority({
    repository: new InMemoryRemovalDecisionRepository(),
    // Not exercised by decideWithLocalPin/decideWithAuthorizedRecovery; only
    // decideWithSignedRemoteParent would reach it, and that mode fails
    // closed at the signing-key-resolver step first.
    authorization: { authorize: () => ({ verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' }) },
    signingKeyResolver: new UnavailableRemovalDecisionSigningKeyResolver(),
    signatureVerifier: { verify: async () => true },
    targetDeviceRoleResolver: new UnavailableTrustSetRoleResolver(),
    pinService,
    recoveryAuthority: new UnavailableAuthorizedRecoveryAuthority(),
    auditService: new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  });

  const app = Fastify();
  registerRemovalDecisionRoutes(app, {
    parentAccountService,
    removalDecisionAuthority,
    removalTargetResolver: removalTargetResolver ?? {
      async resolveForRemoval() { return { outcome: 'UNBOUND' }; },
    },
    administrationPinService: pinService,
  });
  app.__removalDecisionAuthority = removalDecisionAuthority;
  app.__pinService = pinService;
  app.__familyId = familyId;
  app.__stepUpGrants = stepUpGrants;
  app.__stepUpCalls = stepUpCalls;
  return app;
}

const authHeaders = { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

after(async () => {
  await writeParentRouteScenarioReport();
});

function grantStepUp(app, token, operation) {
  app.__stepUpGrants.set(token, {
    rawSessionToken: 'session-a',
    familyId: app.__familyId,
    operation,
    consumed: false,
  });
}

function removalRequestPayload(requestId, operation = 'REMOVE_REVOKE_DEVICE', stepUpToken) {
  return {
    requestId,
    childId: 'child-a',
    deviceId: 'device-a',
    operation,
    protectionLevel: 'PROTECTED',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    reasonCategory: 'ROUTINE_POLICY_CHANGE',
    ...(stepUpToken === undefined ? {} : { stepUpToken }),
  };
}

async function seedPendingRequest(app, requestId, operation = 'REMOVE_REVOKE_DEVICE', familyId = app.__familyId) {
  const now = new Date();
  return app.__removalDecisionAuthority.createRequest({
    requestId,
    familyId,
    requestedByParentAccountId: null,
    childId: 'child-a',
    deviceId: 'device-a',
    operation,
    protectionLevel: 'PROTECTED',
    requestedAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    reasonCategory: 'ROUTINE_POLICY_CHANGE',
    protectiveAuthorityApplies: true,
  });
}

test('removal-decision routes are registered and reachable (not 404) without a session', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/parent/families/family-a/removal-decisions' });
  recordParentRouteScenario({
    method: 'GET',
    route: '/api/parent/families/:familyId/removal-decisions',
    scenarioId: 'anonymous_list_read',
    classification: 'EXPECTED_DENIAL',
    expectedStatus: 401,
    response,
  });
  assert.equal(response.statusCode, 401);
  assert.notEqual(response.statusCode, 404);
});

test('create-request fails closed 409 while the coordinator protective-authority resolver is honestly unavailable', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions',
    headers: authHeaders,
    payload: {
      requestId: 'req-1',
      childId: 'child-a',
      deviceId: 'device-a',
      operation: 'REMOVE_REVOKE_DEVICE',
      protectionLevel: 'PROTECTED',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      reasonCategory: 'ROUTINE_POLICY_CHANGE',
    },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/removal-decisions',
    scenarioId: 'protective_authority_not_applicable',
    classification: 'PROTECTIVE_AUTHORITY_NOT_APPLICABLE',
    expectedStatus: 409,
    response,
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'protective_authority_not_applicable' });
});

test('a Viewer cannot create a removal request and the protective-authority resolver is not called', async () => {
  let resolverCalls = 0;
  const app = buildApp({
    parentRole: 'VIEWER',
    removalTargetResolver: {
      async resolveForRemoval() {
        resolverCalls += 1;
        return { outcome: 'RESOLVED', familyId: app.__familyId, deviceId: 'device-a', childProfileId: 'child-a', protectionLevel: 'PROTECTED', reportedAt: new Date() };
      },
    },
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions',
    headers: authHeaders,
    payload: {
      requestId: 'req-viewer-create',
      childId: 'child-a',
      deviceId: 'device-a',
      operation: 'REMOVE_REVOKE_DEVICE',
      protectionLevel: 'PROTECTED',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      reasonCategory: 'ROUTINE_POLICY_CHANGE',
    },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  assert.equal(resolverCalls, 0);
  assert.deepEqual(await app.__removalDecisionAuthority.listRequests(app.__familyId), []);
});

test('removal request creation requires a one-use grant scoped to its requested operation and persists resolved target data', async () => {
  const app = buildApp({ removalTargetResolver: {
    async resolveForRemoval(familyId, deviceId) {
      assert.equal(familyId, 'family-a');
      assert.equal(deviceId, 'device-a');
      return { outcome: 'RESOLVED', familyId, deviceId, childProfileId: 'child-from-authority', protectionLevel: 'DEGRADED', reportedAt: new Date() };
    },
  } });
  const url = '/api/parent/families/family-a/removal-decisions';

  const missing = await app.inject({ method: 'POST', url, headers: authHeaders, payload: removalRequestPayload('req-stepup-missing') });
  assert.equal(missing.statusCode, 403);
  assert.deepEqual(missing.json(), { error: 'forbidden' });
  assert.deepEqual(await app.__removalDecisionAuthority.listRequests(app.__familyId), []);

  grantStepUp(app, 'wrong-operation-grant', 'family.security.settings.change');
  const wrongOperation = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: removalRequestPayload('req-stepup-wrong', 'REMOVE_REVOKE_DEVICE', 'wrong-operation-grant'),
  });
  assert.equal(wrongOperation.statusCode, 403);
  assert.deepEqual(await app.__removalDecisionAuthority.listRequests(app.__familyId), []);

  grantStepUp(app, 'device-revoke-grant', 'family.device.enrollment.revoke');
  const deviceRevoke = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: {
      ...removalRequestPayload('req-stepup-valid-revoke', 'REMOVE_REVOKE_DEVICE', 'device-revoke-grant'),
      requestedByParentAccountId: 'attacker-controlled-account-id',
    },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/removal-decisions',
    scenarioId: 'step_up_authorized_device_revoke_create',
    classification: 'ALLOW_PROVEN',
    expectedStatus: 201,
    response: deviceRevoke,
  });
  assert.equal(deviceRevoke.statusCode, 201);
  assert.equal(deviceRevoke.json().removalDecision.operation, 'REMOVE_REVOKE_DEVICE');
  assert.equal(deviceRevoke.json().removalDecision.childId, 'child-from-authority');
  assert.equal(deviceRevoke.json().removalDecision.protectionLevel, 'DEGRADED');
  assert.equal(deviceRevoke.json().removalDecision.requestedByParentAccountId, undefined);
  assert.equal((await app.__removalDecisionAuthority.getRequest(app.__familyId, 'req-stepup-valid-revoke')).requestedByParentAccountId, 'account-a');

  const replay = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: removalRequestPayload('req-stepup-replay', 'REMOVE_REVOKE_DEVICE', 'device-revoke-grant'),
  });
  assert.equal(replay.statusCode, 403);
  assert.equal((await app.__removalDecisionAuthority.listRequests(app.__familyId)).length, 1);

  grantStepUp(app, 'disable-policy-grant', 'family.security.settings.change');
  const disablePolicy = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: removalRequestPayload('req-stepup-valid-disable', 'DISABLE_PROTECTION_POLICY', 'disable-policy-grant'),
  });
  assert.equal(disablePolicy.statusCode, 201);
  assert.equal(disablePolicy.json().removalDecision.operation, 'DISABLE_PROTECTION_POLICY');
  assert.deepEqual(app.__stepUpCalls.map(({ rawSessionToken, familyId, operation }) => ({ rawSessionToken, familyId, operation })), [
    { rawSessionToken: 'session-a', familyId: app.__familyId, operation: 'family.device.enrollment.revoke' },
    { rawSessionToken: 'session-a', familyId: app.__familyId, operation: 'family.device.enrollment.revoke' },
    { rawSessionToken: 'session-a', familyId: app.__familyId, operation: 'family.device.enrollment.revoke' },
    { rawSessionToken: 'session-a', familyId: app.__familyId, operation: 'family.security.settings.change' },
  ]);
});

test('local Administration PIN decisions work end-to-end (the one genuinely production-ready mode)', async () => {
  const app = buildApp();
  await app.__pinService.configurePin(app.__familyId, '135790');
  await seedPendingRequest(app, 'req-pin-1');
  grantStepUp(app, 'step-up-wrong-pin', 'family.device.enrollment.revoke');

  const wrongPin = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-pin-1/decide/local-pin',
    headers: authHeaders,
    payload: { decision: 'ALLOW_REMOVAL', pin: '000000', stepUpToken: 'step-up-wrong-pin' },
  });
  assert.equal(wrongPin.statusCode, 403);
  assert.deepEqual(wrongPin.json(), { error: 'pin_invalid' });

  grantStepUp(app, 'step-up-correct-pin', 'family.device.enrollment.revoke');
  const correctPin = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-pin-1/decide/local-pin',
    headers: authHeaders,
    payload: {
      decision: 'ALLOW_REMOVAL',
      pin: '135790',
      stepUpToken: 'step-up-correct-pin',
      decidedByParentAccountId: 'attacker-controlled-account-id',
    },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/removal-decisions/:requestId/decide/local-pin',
    scenarioId: 'correct_pin_and_step_up_decision',
    classification: 'ALLOW_PROVEN',
    expectedStatus: 200,
    response: correctPin,
  });
  assert.equal(correctPin.statusCode, 200);
  assert.equal(correctPin.json().removalDecision.state, 'ALLOW_REMOVAL');
  assert.equal(correctPin.json().removalDecision.decisionMethod, 'LOCAL_ADMINISTRATION_PIN');
  assert.equal(correctPin.json().removalDecision.decidedByParentAccountId, undefined);
  assert.equal((await app.__removalDecisionAuthority.getRequest(app.__familyId, 'req-pin-1')).decidedByParentAccountId, 'account-a');
  assert.deepEqual(app.__stepUpCalls.map((call) => call.operation), [
    'family.device.enrollment.revoke',
    'family.device.enrollment.revoke',
  ]);
});

test('local-PIN decisions require a grant for the persisted request operation', async () => {
  const app = buildApp();
  await app.__pinService.configurePin(app.__familyId, '135790');
  await seedPendingRequest(app, 'req-stepup-disable', 'DISABLE_PROTECTION_POLICY');
  const url = '/api/parent/families/family-a/removal-decisions/req-stepup-disable/decide/local-pin';

  const missing = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: { decision: 'ALLOW_REMOVAL', pin: '135790' },
  });
  assert.equal(missing.statusCode, 403);
  assert.equal((await app.__removalDecisionAuthority.getRequest(app.__familyId, 'req-stepup-disable')).state, 'PARENT_APPROVAL_REQUIRED');

  grantStepUp(app, 'device-revoke-grant', 'family.device.enrollment.revoke');
  const wrongOperation = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: {
      decision: 'ALLOW_REMOVAL',
      pin: '135790',
      operation: 'REMOVE_REVOKE_DEVICE',
      stepUpToken: 'device-revoke-grant',
    },
  });
  assert.equal(wrongOperation.statusCode, 403);
  assert.equal((await app.__removalDecisionAuthority.getRequest(app.__familyId, 'req-stepup-disable')).state, 'PARENT_APPROVAL_REQUIRED');

  grantStepUp(app, 'security-settings-grant', 'family.security.settings.change');
  const valid = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: {
      decision: 'ALLOW_REMOVAL',
      pin: '135790',
      operation: 'REMOVE_REVOKE_DEVICE',
      stepUpToken: 'security-settings-grant',
    },
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.json().removalDecision.state, 'ALLOW_REMOVAL');
  assert.deepEqual(app.__stepUpCalls.map((call) => call.operation), [
    'family.security.settings.change',
    'family.security.settings.change',
  ]);
});

test('a Viewer cannot decide a pending request even with the correct family PIN', async () => {
  const app = buildApp({ parentRole: 'VIEWER' });
  await app.__pinService.configurePin(app.__familyId, '135790');
  await seedPendingRequest(app, 'req-viewer-decision');

  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-viewer-decision/decide/local-pin',
    headers: authHeaders,
    payload: { decision: 'ALLOW_REMOVAL', pin: '135790' },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  assert.equal((await app.__removalDecisionAuthority.getRequest(app.__familyId, 'req-viewer-decision')).state, 'PARENT_APPROVAL_REQUIRED');
});

test('signed remote-parent decisions fail closed NOT_AUTHORIZED (no real signing-key source yet)', async () => {
  const app = buildApp();
  await seedPendingRequest(app, 'req-signed-1');

  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-signed-1/decide/signed',
    headers: authHeaders,
    payload: {
      childId: 'child-a',
      deviceId: 'device-a',
      operation: 'REMOVE_REVOKE_DEVICE',
      protectionLevel: 'PROTECTED',
      reasonCategory: 'ROUTINE_POLICY_CHANGE',
      decision: 'ALLOW_REMOVAL',
      actorDeviceId: 'parent-device-a',
      actionId: 'action-1',
      idempotencyKey: 'idem-1',
      trustSetEpoch: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      stepUp: { state: 'FRESH', assertedAt: new Date().toISOString(), freshUntil: new Date(Date.now() + 60_000).toISOString() },
      signature: 'deadbeef',
    },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/removal-decisions/:requestId/decide/signed',
    scenarioId: 'signed_decision_crypto_gate',
    classification: 'CRYPTO_DEVICE_GATED',
    expectedStatus: 403,
    response,
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'not_authorized' });
});

test('authorized-recovery decisions fail closed NOT_AUTHORIZED (no real recovery-protocol binding yet)', async () => {
  const app = buildApp();
  await seedPendingRequest(app, 'req-recovery-1');

  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-recovery-1/decide/authorized-recovery',
    headers: authHeaders,
    payload: {
      decision: 'ALLOW_REMOVAL',
      proof: { proof: 'opaque-proof-bytes', recoveryTransactionId: 'recovery-txn-1' },
    },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/removal-decisions/:requestId/decide/authorized-recovery',
    scenarioId: 'recovery_decision_crypto_gate',
    classification: 'CRYPTO_DEVICE_GATED',
    expectedStatus: 403,
    response,
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'not_authorized' });
});

test('administration-pin status route is registered and reflects unconfigured state', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
  });
  recordParentRouteScenario({
    method: 'GET',
    route: '/api/parent/families/:familyId/administration-pin',
    scenarioId: 'administration_pin_status_read',
    classification: 'ALLOW_PROVEN',
    expectedStatus: 200,
    response,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().pinStatus.configured, false);
});

test('administration-pin configure route rejects a malformed PIN', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
    payload: { pin: '123' },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/administration-pin',
    scenarioId: 'malformed_pin_validation',
    classification: 'VALIDATION_OR_PROTOCOL',
    expectedStatus: 400,
    response,
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'invalid_request' });
});

test('administration-pin configure route persists a valid PIN and status reflects it', async () => {
  const app = buildApp();
  grantStepUp(app, 'step-up-configure-pin', 'family.security.settings.change');
  const configure = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
    payload: { pin: '246810', stepUpToken: 'step-up-configure-pin' },
  });
  recordParentRouteScenario({
    method: 'POST',
    route: '/api/parent/families/:familyId/administration-pin',
    scenarioId: 'step_up_authorized_pin_configuration',
    classification: 'ALLOW_PROVEN',
    expectedStatus: 200,
    response: configure,
  });
  assert.equal(configure.statusCode, 200);
  assert.equal(configure.json().pinStatus.configured, true);
  assert.deepEqual(app.__stepUpCalls.map((call) => call.operation), ['family.security.settings.change']);

  const replay = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
    payload: { pin: '864200', stepUpToken: 'step-up-configure-pin' },
  });
  assert.equal(replay.statusCode, 403);
  assert.deepEqual(replay.json(), { error: 'forbidden' });
  assert.equal((await app.__pinService.verifyPin(app.__familyId, '246810')).ok, true);

  const status = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().pinStatus.configured, true);
});

test('Administration PIN configuration rejects missing and wrong-operation grants without changing the PIN', async () => {
  const app = buildApp();
  const url = '/api/parent/families/family-a/administration-pin';

  const missing = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: { pin: '246810' },
  });
  assert.equal(missing.statusCode, 403);
  assert.deepEqual(missing.json(), { error: 'forbidden' });

  grantStepUp(app, 'wrong-operation-grant', 'family.device.enrollment.revoke');
  const wrongOperation = await app.inject({
    method: 'POST', url, headers: authHeaders,
    payload: { pin: '246810', stepUpToken: 'wrong-operation-grant' },
  });
  assert.equal(wrongOperation.statusCode, 403);
  assert.deepEqual(wrongOperation.json(), { error: 'forbidden' });

  const status = await app.inject({ method: 'GET', url, headers: authHeaders });
  assert.equal(status.json().pinStatus.configured, false);
});

test('a Viewer cannot configure the family Administration PIN', async () => {
  const app = buildApp({ parentRole: 'VIEWER' });
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
    payload: { pin: '246810' },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  const status = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
  });
  assert.equal(status.json().pinStatus.configured, false);
});

test('a failed active-role lookup denies Administration PIN configuration', async () => {
  const app = buildApp({ roleLookupError: true });
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
    payload: { pin: '246810' },
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  const status = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/administration-pin',
    headers: authHeaders,
  });
  assert.equal(status.json().pinStatus.configured, false);
});

test('removal-decision detail GET returns same-family records and hides unknown or cross-family IDs', async () => {
  const app = buildApp();
  await seedPendingRequest(app, 'req-detail-own');
  await seedPendingRequest(app, 'req-detail-other-family', 'REMOVE_REVOKE_DEVICE', 'family-b');

  try {
    const own = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/removal-decisions/req-detail-own',
      headers: authHeaders,
    });
    recordParentRouteScenario({
      method: 'GET',
      route: '/api/parent/families/:familyId/removal-decisions/:requestId',
      scenarioId: 'same_family_detail_read',
      classification: 'ALLOW_PROVEN',
      expectedStatus: 200,
      response: own,
    });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().removalDecision.requestId, 'req-detail-own');

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/removal-decisions/req-detail-unknown',
      headers: authHeaders,
    });
    recordParentRouteScenario({
      method: 'GET',
      route: '/api/parent/families/:familyId/removal-decisions/:requestId',
      scenarioId: 'unknown_request_privacy_denial',
      classification: 'EXPECTED_DENIAL',
      expectedStatus: 404,
      response: unknown,
    });
    assert.equal(unknown.statusCode, 404);

    const otherFamily = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/removal-decisions/req-detail-other-family',
      headers: authHeaders,
    });
    recordParentRouteScenario({
      method: 'GET',
      route: '/api/parent/families/:familyId/removal-decisions/:requestId',
      scenarioId: 'cross_family_request_privacy_denial',
      classification: 'EXPECTED_DENIAL',
      expectedStatus: 404,
      response: otherFamily,
    });
    assert.equal(otherFamily.statusCode, 404);
    assert.deepEqual(otherFamily.json(), unknown.json());
  } finally {
    await app.close();
  }
});

test('administration-pin configure route requires CSRF like other mutations', async () => {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/administration-pin',
    headers: { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a' },
    payload: { pin: '246810' },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'csrf_mismatch' });
});
