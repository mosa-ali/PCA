import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServer } from '../../dist/http/buildServer.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

// Regression coverage for the two rate-limiting gaps in buildServer.ts:
//
//   1. `/health/db` was registered with no preHandler at all, while every
//      request it serves checks a connection out of the same capped pool
//      every authenticated route shares to run `SELECT 1`.
//   2. authAttemptLimiter's own documented contract:
//      "Applied before requireServiceSession on every authenticated route."
//
// That was true for `/v1/*` and `/platform-admin/*` (each route module
// receives and attaches `authAttemptLimiter` itself) but NOT for the
// `/api/parent/*` cookie plane or the two `/api/families/*` device routes:
// registerParentAccountRoutes/registerRemovalDecisionRoutes/
// registerChildRequestRoutes/registerChildPolicyRoutes/
// registerEyeProtectionRoutes/registerWebRuleRoutes/
// registerFamilyMemberRoutes/registerFamilyAuditEventRoutes/
// registerProtectionAlertRoutes/registerDashboardRoutes are all wired with
// no limiter at all, while every authenticated route in them performs at
// least one session-validation DB round-trip before any authorization
// decision. These tests exercise the REAL buildServer() composition, not a
// re-implementation of it.

function noop() {}
async function asyncNoop() {}

/** Minimal stubs for every ServerDependencies field; only the ones these assertions touch are meaningfully implemented (the routes under test all deny before reaching the rest). */
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
    // Every authenticated cookie-plane route funnels through readSession.
    // It throws here (no valid session in these tests) -- the point is that
    // the limiter must stop the request BEFORE this DB-backed call is even
    // reached once the budget is exhausted.
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
    // These four route modules return early (registering nothing) when their
    // own optional dependency is absent -- supplied here purely so their
    // routes EXIST and can be shown to be covered by the limiter. None is
    // ever invoked: every request below is denied at the session check.
    familyMemberInvitationService: {},
    familyAuditEventLedger: {},
    protectionAlertLedger: {},
    dashboardAggregatorService: {},
  };
}

const AUTH_ATTEMPT_MAX = 60;

async function inject(app, url, method = 'GET') {
  return app.inject({ method, url });
}

test('/health/db is rate limited (it costs a pooled connection per request) while /health stays unlimited', async () => {
  const app = buildServer(buildStubDeps());
  try {
    for (let i = 0; i < 60; i++) {
      const response = await inject(app, '/health/db');
      // No DB is configured in this unit-test environment, so the probe
      // honestly reports unavailable -- the status that matters here is
      // that it is NOT yet 429.
      assert.equal(response.statusCode, 503, `request ${i + 1} should still be within budget`);
    }
    const limited = await inject(app, '/health/db');
    assert.equal(limited.statusCode, 429);
    assert.deepEqual(limited.json(), { error: 'rate_limited' });

    // Pure liveness (no DB touch) must stay unlimited AND must not share
    // /health/db's bucket -- an orchestrator's liveness probe can never be
    // starved by readiness-probe traffic.
    for (let i = 0; i < 10; i++) {
      assert.equal((await inject(app, '/health')).statusCode, 200);
    }
  } finally {
    await app.close();
  }
});

test('an authenticated /api/parent/* route is charged against the shared auth-attempt budget and 429s past it', async () => {
  const app = buildServer(buildStubDeps());
  try {
    const url = '/api/parent/families/family-a/removal-decisions';
    for (let i = 0; i < AUTH_ATTEMPT_MAX; i++) {
      const response = await inject(app, url);
      // 401: the route ran its own auth logic. Crucially NOT 429 yet, and
      // never 404 (which would mean the route was not registered at all).
      assert.equal(response.statusCode, 401, `request ${i + 1} should still be within budget`);
    }
    const limited = await inject(app, url);
    assert.equal(limited.statusCode, 429);
    assert.deepEqual(limited.json(), { error: 'rate_limited' });
  } finally {
    await app.close();
  }
});

test('the budget is shared across the whole cookie plane, not per-route (one exhausted route limits the next)', async () => {
  const app = buildServer(buildStubDeps());
  try {
    for (let i = 0; i < AUTH_ATTEMPT_MAX; i++) {
      await inject(app, '/api/parent/families/family-a/removal-decisions');
    }
    // A DIFFERENT authenticated cookie-plane route, registered by a
    // different route module, must already be out of budget -- otherwise an
    // attacker just rotates endpoints to keep forcing session lookups.
    for (const url of [
      '/api/parent/families/family-a/audit-events',
      '/api/parent/families/family-a/protection-alerts',
      '/api/parent/families/family-a/dashboard',
      '/api/parent/families/family-a/members/invitations',
      '/api/parent/preferences',
      '/api/parent/session',
    ]) {
      const response = await inject(app, url);
      assert.equal(response.statusCode, 429, url);
    }
  } finally {
    await app.close();
  }
});

test('the /api/families/* device plane is covered too', async () => {
  const app = buildServer(buildStubDeps());
  try {
    const url = '/api/families/family-a/child-requests';
    for (let i = 0; i < AUTH_ATTEMPT_MAX; i++) {
      const response = await inject(app, url, 'POST');
      assert.equal(response.statusCode, 401, `request ${i + 1} should still be within budget`);
    }
    const limited = await inject(app, url, 'POST');
    assert.equal(limited.statusCode, 429);
  } finally {
    await app.close();
  }
});

test('the five self-limited identity endpoints are NOT charged against the shared bucket (they keep their own per-IP+per-email budgets)', async () => {
  const app = buildServer(buildStubDeps());
  try {
    for (let i = 0; i < AUTH_ATTEMPT_MAX + 5; i++) {
      await inject(app, '/api/parent/families/family-a/removal-decisions');
    }
    // Shared bucket is provably exhausted...
    assert.equal((await inject(app, '/api/parent/families/family-a/removal-decisions')).statusCode, 429);
    // ...yet an unauthenticated identity endpoint still answers on its own
    // (narrower, two-dimensional) budget rather than inheriting this one.
    // 400 = its own body validation, i.e. it genuinely ran.
    const login = await app.inject({ method: 'POST', url: '/api/parent/login', payload: {} });
    assert.equal(login.statusCode, 400);
    assert.deepEqual(login.json(), { error: 'invalid_request' });
  } finally {
    await app.close();
  }
});

test('liveness (/health) is never starved by the auth-attempt budget', async () => {
  const app = buildServer(buildStubDeps());
  try {
    for (let i = 0; i < AUTH_ATTEMPT_MAX + 5; i++) {
      await inject(app, '/api/parent/families/family-a/removal-decisions');
    }
    const health = await inject(app, '/health');
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { service: 'pca-backend', status: 'ok' });
  } finally {
    await app.close();
  }
});

test('an unmatched (404) request consumes no budget', async () => {
  const app = buildServer(buildStubDeps());
  try {
    for (let i = 0; i < AUTH_ATTEMPT_MAX + 5; i++) {
      const response = await inject(app, '/api/parent/families/family-a/this-route-does-not-exist');
      assert.equal(response.statusCode, 404, `request ${i + 1}`);
    }
    // A real route on the same plane is still fully within budget.
    assert.equal((await inject(app, '/api/parent/families/family-a/removal-decisions')).statusCode, 401);
  } finally {
    await app.close();
  }
});
