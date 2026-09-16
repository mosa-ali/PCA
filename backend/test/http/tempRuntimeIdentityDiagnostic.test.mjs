import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

// PCA-DW-W3-E (2026-09-16): the TEMPORARY runtime DB identity diagnostic
// (src/http/routes/platformadmin/tempRuntimeIdentityDiagnostic.ts) must be
// genuinely absent unless PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN is
// explicitly set (true for every environment, including production, as
// configured today), and a wrong/missing token must 404 -- never 401 --
// so an unauthenticated prober cannot even learn the route exists. The
// successful-token path (which needs a real DB round trip) is covered
// separately in test/db/tempRuntimeIdentityDiagnostic.mysql.test.mjs.

function noop() {}
async function asyncNoop() {}

function buildStubDeps() {
  return {
    authService: { requireServiceSession: asyncNoop },
    authzService: {},
    authzRepository: {},
    invitationService: {},
    enrollmentCoordinator: {},
    pairingService: {},
    deviceSessionService: {
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
    parentAccountService: {
      async readSession() {
        throw new Error('unauthorized');
      },
    },
    parentPreferenceRepository: undefined,
    safeZoneRepository: {},
    safeZonePolicyAuthorizer: {},
    platformAdminComplimentaryGrantService: {},
    complimentaryEntitlementService: undefined,
    freeAccessAccountRepository: {},
    freeAccessAdminService: {},
    platformAdminSettlementService: {},
    removalDecisionAuthority: {
      async listRequests() {
        return [];
      },
    },
    protectiveAuthorityResolver: undefined,
    familyMemberInvitationService: {},
    familyAuditEventLedger: {},
    protectionAlertLedger: {},
    dashboardAggregatorService: {},
  };
}

const TOKEN_ENV_VAR = 'PCA_TEMP_RUNTIME_IDENTITY_DIAGNOSTIC_TOKEN';
const ROUTE = '/platform-admin/internal/temp-runtime-identity';

test('the route does not exist at all when the diagnostic token env var is unset (the default everywhere, including production today)', async () => {
  delete process.env[TOKEN_ENV_VAR];
  const app = buildServer(buildStubDeps());
  try {
    const res = await app.inject({ method: 'GET', url: ROUTE });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('a request with no token header 404s (never 401) once the route is enabled, without ever touching the database', async () => {
  process.env[TOKEN_ENV_VAR] = 'a-fake-diagnostic-token-for-this-test-only';
  try {
    const app = buildServer(buildStubDeps());
    try {
      const res = await app.inject({ method: 'GET', url: ROUTE });
      assert.equal(res.statusCode, 404);
      assert.deepEqual(JSON.parse(res.body), { error: 'not_found' });
    } finally {
      await app.close();
    }
  } finally {
    delete process.env[TOKEN_ENV_VAR];
  }
});

test('a request with the wrong token 404s, without ever touching the database', async () => {
  process.env[TOKEN_ENV_VAR] = 'a-fake-diagnostic-token-for-this-test-only';
  try {
    const app = buildServer(buildStubDeps());
    try {
      const res = await app.inject({ method: 'GET', url: ROUTE, headers: { 'x-pca-diagnostic-token': 'definitely-wrong' } });
      assert.equal(res.statusCode, 404);
    } finally {
      await app.close();
    }
  } finally {
    delete process.env[TOKEN_ENV_VAR];
  }
});
