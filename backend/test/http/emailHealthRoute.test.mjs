// PCA-DW-W2-15F -- /health/email readiness probe.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

function noop() {}
async function asyncNoop() {}

/** Mirrors test/http/buildServerRateLimiting.test.mjs's stub shape -- only /health/email is exercised below. */
function buildStubDeps(emailProviderAdapter) {
  return {
    emailProviderAdapter,
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

test('/health/email is NOT registered at all when emailProviderAdapter is omitted', async () => {
  const app = buildServer(buildStubDeps(undefined));
  try {
    const response = await app.inject({ method: 'GET', url: '/health/email' });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('/health/email reports 200/ok when a real provider is configured', async () => {
  const app = buildServer(buildStubDeps({ providerName: 'SMTP' }));
  try {
    const response = await app.inject({ method: 'GET', url: '/health/email' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok', provider: 'SMTP' });
  } finally {
    await app.close();
  }
});

test('/health/email reports 503/no_provider_configured for RejectingEmailProviderAdapter -- never a false "ok"', async () => {
  const app = buildServer(buildStubDeps({ providerName: 'REJECTING_NO_PROVIDER_CONFIGURED' }));
  try {
    const response = await app.inject({ method: 'GET', url: '/health/email' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'no_provider_configured', provider: 'REJECTING_NO_PROVIDER_CONFIGURED' });
  } finally {
    await app.close();
  }
});

test('/health/email never exposes host/credential/config details -- only status + provider name', async () => {
  const app = buildServer(buildStubDeps({ providerName: 'SMTP' }));
  try {
    const response = await app.inject({ method: 'GET', url: '/health/email' });
    assert.deepEqual(Object.keys(response.json()).sort(), ['provider', 'status']);
  } finally {
    await app.close();
  }
});
