import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { RemovalDecisionError } from '../../dist/familyrbac/RemovalDecisionAuthority.js';

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
  };
  const safeZoneRepository = {
    async list() {
      return [];
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
        async requireActorDeviceInFamily(rawToken, expectedFamilyId) {
          if (rawToken !== 'devtoken-a') throw new RuntimeSyncAuthError('UNAUTHORIZED');
          return { deviceId: 'device-a', familyId: expectedFamilyId };
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

test('buildServer threads deviceSessionService into Safe Zone routes: present -> real authorization, not 503', async () => {
  const app = buildServer(buildStubDeps({ withDeviceSessionService: true }));
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

test('buildServer without deviceSessionService: Safe Zone routes fail closed with 503 (baseline, unchanged)', async () => {
  const deps = buildStubDeps({ withDeviceSessionService: true });
  deps.deviceSessionService = undefined;
  const app = buildServer(deps);
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/parent/families/family-a/safe-zones',
      headers: { cookie: 'pca_family_session=session-a', authorization: 'Bearer devtoken-a' },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'family_authority_unavailable' });
  } finally {
    await app.close();
  }
});
