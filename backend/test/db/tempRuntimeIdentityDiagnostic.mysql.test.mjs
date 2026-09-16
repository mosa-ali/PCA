import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { closePool } from '../../dist/db/pool.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

// PCA-DW-W3-E (2026-09-16): the successful-token path of the TEMPORARY
// runtime DB identity diagnostic (src/http/routes/platformadmin/
// tempRuntimeIdentityDiagnostic.ts) really does execute a real query
// against the real pool and returns ONLY the sanctioned fields -- never a
// password, connection string, secret value, admin ID, or table content.

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
// Deliberately excludes '@' and '://' -- CURRENT_USER() legitimately looks
// like "user@host", which is not a leak.
const SENSITIVE_SUBSTRINGS = ['DATABASE_URL', 'password', 'PASSWORD', 'mysql://'];

test('the correct token returns exactly currentUser/activeDatabase/mysqlVersion/tlsVersion/tlsCipher, nothing else, and never leaks connection material', async () => {
  const token = 'a-real-one-time-diagnostic-token-for-this-test-only';
  process.env[TOKEN_ENV_VAR] = token;
  try {
    const app = buildServer(buildStubDeps());
    try {
      const res = await app.inject({ method: 'GET', url: ROUTE, headers: { 'x-pca-diagnostic-token': token } });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.deepEqual(Object.keys(body).sort(), ['activeDatabase', 'currentUser', 'mysqlVersion', 'tlsCipher', 'tlsVersion'].sort());
      assert.equal(typeof body.currentUser, 'string');
      assert.ok(body.currentUser.length > 0);
      assert.equal(typeof body.activeDatabase, 'string');
      assert.match(body.mysqlVersion, /^\d+\.\d+/);
      for (const forbidden of SENSITIVE_SUBSTRINGS) {
        assert.equal(res.body.includes(forbidden), false, `response body must never contain "${forbidden}"`);
      }
    } finally {
      await app.close();
    }
  } finally {
    delete process.env[TOKEN_ENV_VAR];
  }
});

test.after(async () => {
  await closePool();
});
