import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerRemovalDecisionRoutes } from '../../dist/http/routes/removalDecisionRoutes.js';
import { RemovalDecisionAuthority, InMemoryRemovalDecisionRepository } from '../../dist/familyrbac/RemovalDecisionAuthority.js';
import { UnavailableRemovalDecisionSigningKeyResolver } from '../../dist/familyrbac/UnavailableRemovalDecisionSigningKeyResolver.js';
import { UnavailableAuthorizedRecoveryAuthority } from '../../dist/familyrbac/UnavailableAuthorizedRecoveryAuthority.js';
import { UnavailableProtectiveAuthorityResolver } from '../../dist/familyrbac/UnavailableProtectiveAuthorityResolver.js';
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

function buildApp() {
  const familyId = 'family-a';
  const sessions = new Map([['session-a', { accountId: 'account-a', familyId }]]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
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
    protectiveAuthorityResolver: new UnavailableProtectiveAuthorityResolver(),
  });
  app.__removalDecisionAuthority = removalDecisionAuthority;
  app.__pinService = pinService;
  app.__familyId = familyId;
  return app;
}

const authHeaders = { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

async function seedPendingRequest(app, requestId) {
  const now = new Date();
  return app.__removalDecisionAuthority.createRequest({
    requestId,
    familyId: app.__familyId,
    childId: 'child-a',
    deviceId: 'device-a',
    operation: 'REMOVE_REVOKE_DEVICE',
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
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'protective_authority_not_applicable' });
});

test('local Administration PIN decisions work end-to-end (the one genuinely production-ready mode)', async () => {
  const app = buildApp();
  await app.__pinService.configurePin(app.__familyId, '135790');
  await seedPendingRequest(app, 'req-pin-1');

  const wrongPin = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-pin-1/decide/local-pin',
    headers: authHeaders,
    payload: { decision: 'ALLOW_REMOVAL', pin: '000000' },
  });
  assert.equal(wrongPin.statusCode, 403);
  assert.deepEqual(wrongPin.json(), { error: 'pin_invalid' });

  const correctPin = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/removal-decisions/req-pin-1/decide/local-pin',
    headers: authHeaders,
    payload: { decision: 'ALLOW_REMOVAL', pin: '135790' },
  });
  assert.equal(correctPin.statusCode, 200);
  assert.equal(correctPin.json().removalDecision.state, 'ALLOW_REMOVAL');
  assert.equal(correctPin.json().removalDecision.decisionMethod, 'LOCAL_ADMINISTRATION_PIN');
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
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'not_authorized' });
});
