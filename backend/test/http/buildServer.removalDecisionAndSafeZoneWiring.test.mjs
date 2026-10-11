import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { RemovalDecisionError } from '../../dist/familyrbac/RemovalDecisionAuthority.js';
import { InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';

// Coordinator wiring regression coverage (this task):
//   1. registerRemovalDecisionRoutes is now actually called from
//      buildServer.ts -- the removal-decision surface responds (never 404)
//      once mounted, exactly like every other registerXRoutes call.
//   2. registerParentAccountRoutes now receives deps.deviceSessionService
//      (previously silently dropped even though ServerDependencies already
//      declared it) -- Safe Zone routes reach real authorization instead of
//      unconditionally 503ing family_authority_unavailable.
//
// This exercises the REAL buildServer() composition function (not a
// re-implementation of its route registration), with lightweight stubs for
// every dependency buildServer.ts's ServerDependencies interface requires.
// Only the dependencies this test's assertions actually touch
// (parentAccountService/safeZoneRepository/safeZonePolicyAuthorizer/
// deviceSessionService/removalDecisionAuthority) are meaningfully
// implemented; every other required field is a minimal no-op stub never
// invoked by the routes under test.

function noop() {}
async function asyncNoop() {}

const SESSIONS = new Map([
  ['session-a', { accountId: 'account-a', familyId: 'family-a', emailVerified: true }],
]);

function buildStubDeps({ withDeviceSessionService }) {
  const parentAccountService = {
    async readSession(token) {
      const session = SESSIONS.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole() { return 'ADMINISTRATOR'; },
  };
  const safeZoneRepository = {
    async list() {
      return [];
    },
    async listForRecipient(familyId, recipientEndpointId) {
      return { safeZones: [{
        zoneId: 'zone-a', familyId, recipientEndpointId,
        ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1,
        revision: 1, deliveryState: 'PENDING_OFFLINE',
        createdAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString(),
      }], nextCursor: null };
    },
    async create(input) {
      return { zoneId: 'zone-a', ...input, revision: 1, deliveryState: 'PENDING_OFFLINE', createdAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString() };
    },
    async update() {
      throw new Error('not used in this test');
    },
    async remove() {
      return true;
    },
  };
  const safeZonePolicyAuthorizer = {
    async authorize() {
      return { verdict: 'ALLOW' };
    },
  };
  const deviceSessionService = withDeviceSessionService
    ? {
        async validateSession(rawToken) {
          if (rawToken !== 'devtoken-a') throw new RuntimeSyncAuthError('UNAUTHORIZED');
          return { deviceId: 'device-a', familyId: 'family-a', dskKeyId: 'dsk-a' };
        },
        async requireActorDeviceInFamily(rawToken, expectedFamilyId) {
          if (rawToken !== 'devtoken-a') throw new RuntimeSyncAuthError('UNAUTHORIZED');
          return { deviceId: 'device-a', familyId: expectedFamilyId, dskKeyId: 'dsk-a' };
        },
      }
    : undefined;

  const removalDecisionAuthority = {
    async listRequests() {
      return [];
    },
    async getRequest() {
      return null;
    },
    async createRequest() {
      throw new RemovalDecisionError('INVALID_INPUT');
    },
    async decideWithLocalPin() {
      throw new RemovalDecisionError('PIN_NOT_CONFIGURED');
    },
    async decideWithAuthorizedRecovery() {
      throw new RemovalDecisionError('NOT_AUTHORIZED');
    },
    async decideWithSignedRemoteParent() {
      throw new RemovalDecisionError('NOT_AUTHORIZED');
    },
  };

  return {
    authService: { requireServiceSession: asyncNoop },
    authzService: {},
    authzRepository: {},
    invitationService: {},
    enrollmentCoordinator: {},
    pairingService: {},
    deviceSessionService: deviceSessionService ?? {
      async requireActorDeviceInFamily() {
        throw new RuntimeSyncAuthError('UNAUTHORIZED');
      },
    },
    outboundRelayService: {},
    inboundReconnectService: {},
    statusTracker: {},
    resolveEnvelopeContext: noop,
    deviceRepository: { async findDeviceForFamily(_familyId, deviceId) { return { deviceId }; } },
    deleteNowLedger: {},
    familyAuditService: { record: asyncNoop },
    platformAdminAuthService: {},
    billingCheckoutService: {},
    billingWebhookService: {},
    billingProviderRegistry: {},
    billingRefundOrchestrationService: {},
    billingPaymentRepository: {},
    billingAuditService: {},
    billingFamilyCommercialAuthorityResolver: {},
    commercialNotificationService: {},
    commercialNotificationSupportService: {},
    platformAdminAccountService: {},
    platformAdminEntitlementService: {},
    changeRequestRepository: {},
    entitlementRepository: {},
    priceBookService: {},
    planService: {},
    releaseService: {},
    familyCommercialService: {},
    parentAccountService,
    parentPreferenceRepository: undefined,
    safeZoneRepository,
    trustSetRoleResolver: { async resolveActor(familyId, deviceId) { return { familyId, deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 }; } },
    deviceChildBindingRepository: {
      async resolveBinding(familyId, deviceId) {
        return familyId === 'family-a' && ['child-device', 'device-a'].includes(deviceId)
          ? { outcome: 'BOUND', childProfileId: 'child-profile-a' }
          : { outcome: 'UNBOUND' };
      },
    },
    childProfileRegistryRepository: {
      async resolveMembership(familyId, childProfileId) {
        return familyId === 'family-a' && childProfileId === 'child-profile-a'
          ? 'MEMBER'
          : 'NOT_MEMBER_OR_NOT_FOUND';
      },
    },
    // Threaded only when the test wants the "wired" configuration; the
    // "not wired" case below still passes safeZonePolicyAuthorizer so the
    // ONLY variable under test is deviceSessionService's presence.
    safeZonePolicyAuthorizer,
    platformAdminComplimentaryGrantService: {},
    complimentaryEntitlementService: undefined,
    freeAccessAccountRepository: {},
    freeAccessAdminService: {},
    platformAdminSettlementService: {},
    removalDecisionAuthority,
    protectiveAuthorityResolver: undefined,
  };
}

test('buildServer registers removal-decision routes (reachable, not 404)', async () => {
  const app = buildServer(buildStubDeps({ withDeviceSessionService: true }));
  try {
    // No session cookie at all -- proves the route exists and runs its own
    // auth logic (401), rather than Fastify falling through to its default
    // not-found handler (404) because the route was never registered.
    const response = await app.inject({ method: 'GET', url: '/api/parent/families/family-a/removal-decisions' });
    assert.equal(response.statusCode, 401);
    assert.notEqual(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('buildServer Safe Zone reads use active Parent session role without a device bearer', async () => {
  const app = buildServer(buildStubDeps({ withDeviceSessionService: true }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/safe-zones',
      headers: { cookie: 'pca_family_session=session-a' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { safeZones: [] });
  } finally {
    await app.close();
  }
});

test('buildServer wires device Safe Zone delivery to the authenticated recipient only', async () => {
  const app = buildServer(buildStubDeps({ withDeviceSessionService: true }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/runtime-sync/safe-zones?familyId=attacker&deviceId=attacker',
      headers: { authorization: 'Bearer devtoken-a' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.deepEqual(response.json(), { safeZones: [{
      zoneId: 'zone-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 1, revision: 1, deliveryState: 'PENDING_OFFLINE',
      updatedAtUtc: response.json().safeZones[0].updatedAtUtc,
    }], nextCursor: null });
  } finally {
    await app.close();
  }
});

test('buildServer wires Parent Safe Zone writes to the durable child-profile binding resolver', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  const bindingCalls = [];
  const creates = [];
  deps.deviceRepository = {
    async findDeviceForFamily(familyId, deviceId) {
      return familyId === 'family-a' && deviceId === 'child-device' ? { familyId, deviceId } : null;
    },
  };
  deps.deviceChildBindingRepository = {
    async resolveBinding(familyId, deviceId) {
      bindingCalls.push({ familyId, deviceId });
      return familyId === 'family-a' && deviceId === 'child-device'
        ? { outcome: 'BOUND', childProfileId: 'child-profile-a' }
        : { outcome: 'UNBOUND' };
    },
  };
  deps.safeZoneRepository = {
    ...deps.safeZoneRepository,
    async create(input) {
      creates.push(input);
      return { zoneId: 'zone-a', ...input, revision: 1, deliveryState: 'PENDING_OFFLINE' };
    },
  };
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/families/family-a/safe-zones',
      headers: {
        cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a',
        authorization: 'Bearer devtoken-a',
        'x-pca-csrf-token': 'csrf-a',
      },
      payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
    });
    assert.equal(response.statusCode, 201, JSON.stringify(response.json()));
    assert.equal(bindingCalls.length, 2, 'binding is checked both before authorization and at the final persistence boundary');
    assert.deepEqual(bindingCalls, [
      { familyId: 'family-a', deviceId: 'child-device' },
      { familyId: 'family-a', deviceId: 'child-device' },
    ]);
    assert.equal(creates.length, 1);
    assert.equal(creates[0].recipientEndpointId, 'child-device');
  } finally {
    await app.close();
  }
});

test('buildServer wires accepted Trust Set authority into protection-status writes', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  const resolverCalls = [];
  const writes = [];
  deps.trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls.push([familyId, deviceId, dskKeyId]);
      return { deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
    },
  };
  deps.deviceProtectionStatusRepository = {
    async upsert(input) { writes.push(input); },
  };
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: 'Bearer devtoken-a' },
      payload: { protectionLevel: 'PROTECTED' },
    });
    assert.equal(response.statusCode, 204);
    assert.deepEqual(resolverCalls, [['family-a', 'device-a', 'dsk-a']]);
    assert.equal(writes.length, 1);
    assert.deepEqual({
      deviceId: writes[0].deviceId,
      familyId: writes[0].familyId,
      protectionLevel: writes[0].protectionLevel,
    }, { deviceId: 'device-a', familyId: 'family-a', protectionLevel: 'PROTECTED' });
  } finally {
    await app.close();
  }
});

test('buildServer wires accepted Trust Set DSK authority before protection-alert ledger reads', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  const resolverCalls = [];
  let ledgerReads = 0;
  deps.trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls.push([familyId, deviceId, dskKeyId]);
      return { deviceId, role: 'OWNER', trustSetEpoch: 2, keyEpoch: 1 };
    },
  };
  deps.protectionAlertLedger = {
    async listForParentDevice() { ledgerReads += 1; return []; },
  };
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/protection-alerts',
      headers: {
        cookie: 'pca_family_session=session-a',
        authorization: 'Bearer devtoken-a',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(resolverCalls, [['family-a', 'device-a', 'dsk-a']]);
    assert.equal(ledgerReads, 1);
  } finally {
    await app.close();
  }
});

test('buildServer wires accepted Trust Set authority into Web Rules reads', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  const resolverCalls = [];
  let ruleReads = 0;
  deps.deviceSessionService.requireActorDeviceInFamily = async (rawToken, expectedFamilyId) => {
    if (rawToken !== 'devtoken-a') throw new RuntimeSyncAuthError('UNAUTHORIZED');
    return { deviceId: 'device-a', familyId: expectedFamilyId, dskKeyId: 'dsk-a' };
  };
  deps.trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls.push([familyId, deviceId, dskKeyId]);
      return { deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 };
    },
  };
  deps.webRuleAuthorization = { async authorize() { return { verdict: 'ALLOW' }; } };
  deps.webRuleService = {
    async listParentRules() { ruleReads += 1; return []; },
    async setParentRule() { throw new Error('not used in read test'); },
    async removeParentRule() { throw new Error('not used in read test'); },
  };
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/children/child-a/web-rules',
      headers: {
        cookie: 'pca_family_session=session-a',
        authorization: 'Bearer devtoken-a',
      },
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.json()));
    assert.deepEqual(resolverCalls, [['family-a', 'device-a', 'dsk-a']]);
    assert.equal(ruleReads, 1);
  } finally {
    await app.close();
  }
});

test('buildServer wires accepted Trust Set authority into FamilyAudit delivery', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  const ledger = new InMemoryFamilyAuditEventLedger(() => new Date('2026-10-10T00:00:00.000Z'));
  const resolverCalls = [];
  deps.familyAuditEventLedger = ledger;
  deps.deviceSessionService.requireActorDeviceInFamily = async (rawToken, expectedFamilyId) => {
    if (rawToken !== 'devtoken-a') throw new RuntimeSyncAuthError('UNAUTHORIZED');
    return { deviceId: 'device-a', familyId: expectedFamilyId, dskKeyId: 'dsk-a' };
  };
  deps.trustSetRoleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls.push([familyId, deviceId, dskKeyId]);
      return { deviceId, role: 'OWNER', trustSetEpoch: 2, keyEpoch: 1 };
    },
  };
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/audit-events',
      headers: { cookie: 'pca_family_session=session-a', authorization: 'Bearer devtoken-a' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { envelopes: [] });
    assert.deepEqual(resolverCalls, [['family-a', 'device-a', 'dsk-a']]);
  } finally {
    await app.close();
  }
});

test('buildServer without deviceSessionService: Safe Zone session reads remain available', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  deps.deviceSessionService = undefined;
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/safe-zones',
      headers: { cookie: 'pca_family_session=session-a', authorization: 'Bearer devtoken-a' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { safeZones: [] });
  } finally {
    await app.close();
  }
});
