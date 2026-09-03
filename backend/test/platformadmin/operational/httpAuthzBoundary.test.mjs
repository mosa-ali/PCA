/**
 * PCA-PA-3B -- HTTP-level auth/RBAC boundary test for this lane's routes,
 * using a real Fastify instance and the REAL `createRequirePlatformAdminSession`
 * preHandler + REAL route handlers, with only `PlatformAdminAuthService`
 * faked (a plain object satisfying its `validateSession` call shape --
 * no DB needed for session lookup in this test). This proves the session
 * (401) and RBAC (403) boundaries this lane's routes enforce actually fire
 * at the HTTP layer, not just at the underlying policy-matrix level
 * (see privilegeGate.test.mjs for that layer).
 *
 * Deliberately stops short of asserting a 200 success body: every list
 * route's success path reaches a real MySQL query (`runInTransaction`/
 * `getPool()`, requiring `PCA_DATABASE_URL`), which this sandbox does not
 * have available -- see this lane's final report's DB/CLEAN_ROOM fields.
 * The 401/403 paths below all return BEFORE any DB call, so they are
 * fully exercisable without a database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerPlatformAdminDashboardRoutes } from '../../../dist/http/routes/platformadmin/dashboardRoutes.js';
import { registerPlatformAdminBillingReadRoutes } from '../../../dist/http/routes/platformadmin/billingReadRoutes.js';
import { registerPlatformAdminAuditRoutes } from '../../../dist/http/routes/platformadmin/auditRoutes.js';
import { createRateLimiter } from '../../../dist/http/rateLimit.js';

function buildFakeAuthService(sessionsByToken) {
  return {
    async validateSession(rawToken) {
      const session = sessionsByToken.get(rawToken);
      if (!session) {
        const { PlatformAdminAuthError } = await import('../../../dist/platformadmin/auth/PlatformAdminAuthService.js');
        throw new PlatformAdminAuthError();
      }
      return session;
    },
  };
}

function buildApp(sessionsByToken) {
  const app = Fastify({ logger: false });
  const authService = buildFakeAuthService(sessionsByToken);
  const rateLimiter = createRateLimiter();
  registerPlatformAdminDashboardRoutes(app, { platformAdminAuthService: authService, rateLimiter });
  registerPlatformAdminBillingReadRoutes(app, { platformAdminAuthService: authService, rateLimiter });
  registerPlatformAdminAuditRoutes(app, { platformAdminAuthService: authService, rateLimiter });
  return app;
}

function registerSession(sessionsByToken, roles) {
  const token = `pa_${randomUUID()}`;
  sessionsByToken.set(token, {
    adminId: `admin-${randomUUID()}`,
    roles,
    sessionId: `session-${randomUUID()}`,
    sessionExpiresAt: new Date(Date.now() + 60_000),
  });
  return token;
}

test('GET /platform-admin/dashboard with no Authorization header -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'GET', url: '/platform-admin/dashboard' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
  await app.close();
});

test('GET /platform-admin/dashboard with an unknown/invalid token -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'GET', url: '/platform-admin/dashboard', headers: { authorization: 'Bearer pa_not-a-real-token' } });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('GET /platform-admin/billing/plans (bare, browse-all) with no Authorization header -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/plans' });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('GET /platform-admin/billing/plans (bare, browse-all): SUPPORT_ADMIN session is 403 (no billing-record read access)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/plans', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('GET /platform-admin/billing/plans (bare, browse-all): PLATFORM_ADMIN session is 403 (no billing-record read access, price-book-view only)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/plans', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/billing/plans (bare, browse-all) with a valid session and role clears the RBAC gate (further failure, if any, is the expected DB-unavailable error in this sandbox, not an authorization rejection)', async () => {
  for (const role of ['APP_OWNER', 'FINANCE_ADMIN', 'AUDITOR_READ_ONLY']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/plans', headers: { authorization: `Bearer ${token}` } });
    assert.notEqual(response.statusCode, 401, `role ${role} should not be 401`);
    assert.notEqual(response.statusCode, 403, `role ${role} should not be 403`);
    await app.close();
  }
});

test('GET /platform-admin/billing/plans (bare, browse-all) with a malformed pagination query does not 401/403 (bounded fallback, not rejection)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/plans?limit=not-a-number&offset=-99', headers: { authorization: `Bearer ${token}` } });
  assert.notEqual(response.statusCode, 401);
  assert.notEqual(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/billing/plans/:planCode (existing exact-code route) is unaffected by the new bare route: SUPPORT_ADMIN is still 403', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = Fastify({ logger: false });
  const authService = buildFakeAuthService(sessions);
  const rateLimiter = createRateLimiter();
  const { registerPlatformAdminPlanRoutes } = await import('../../../dist/http/routes/platformadmin/planRoutes.js');
  const { PlanService } = await import('../../../dist/billing/plan.js');
  // RBAC (`requireBillingOperation`) runs BEFORE the repository is ever
  // touched, so a repository stub that is never called is sufficient here --
  // same no-DB-needed reasoning as this file's other 403 tests.
  const planService = new PlanService({});
  registerPlatformAdminBillingReadRoutes(app, { platformAdminAuthService: authService, rateLimiter });
  registerPlatformAdminPlanRoutes(app, { platformAdminAuthService: authService, planService, rateLimiter });
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/plans/SOME_CODE', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/billing/subscriptions: SUPPORT_ADMIN session is 403 (no billing-record read access)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/subscriptions', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('GET /platform-admin/billing/refunds: PLATFORM_ADMIN session is 403 (no billing-record read access, price-book-view only)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/refunds', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/dashboard: any recognized role (including SUPPORT_ADMIN/AUDITOR_READ_ONLY) clears the RBAC gate (VIEW_PLATFORM_DASHBOARD is ALLOW-all) -- request proceeds past 401/403 (further failure, if any, is the expected DB-unavailable error in this sandbox, not an authorization rejection)', async () => {
  for (const role of ['APP_OWNER', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({ method: 'GET', url: '/platform-admin/dashboard', headers: { authorization: `Bearer ${token}` } });
    assert.notEqual(response.statusCode, 401, `role ${role} should not be 401`);
    assert.notEqual(response.statusCode, 403, `role ${role} should not be 403 (VIEW_PLATFORM_DASHBOARD is ALLOW-all)`);
    await app.close();
  }
});

test('GET /platform-admin/audit with a valid session but a malformed pagination query does not 401/403 (bounded fallback, not rejection)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['AUDITOR_READ_ONLY']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/audit?limit=not-a-number&offset=-99', headers: { authorization: `Bearer ${token}` } });
  assert.notEqual(response.statusCode, 401);
  assert.notEqual(response.statusCode, 403);
  await app.close();
});

// ===========================================================================
// PCA-BILLING-READ-SPLIT-1 -- billing-record fields must not ride out on
// routes gated only by VIEW_SUPPORT_ACCOUNT_METADATA.
//
// VIEW_SUPPORT_ACCOUNT_METADATA is ALLOW for all five roles (rbacPolicy.ts),
// but VIEW_BILLING_RECORDS is DENY for PLATFORM_ADMIN and SUPPORT_ADMIN
// (billing/rbac.ts, whose header states SUPPORT_ADMIN has "no billing read of
// any kind"). Three routes gated on the former were returning billing data:
// GET /platform-admin/accounts (latestSubscription), GET
// /platform-admin/entitlement-requests (quote amount/currency) and GET
// /platform-admin/dashboard (subscription/quote aggregates). The fix omits
// those fields for roles lacking VIEW_BILLING_RECORDS rather than 403ing the
// whole route -- the precedent GET /platform-admin/quotes/pending already set.
//
// These tests reach the SUCCESS path, so the route's read model is stubbed at
// the prototype (this sandbox has no MySQL); every RBAC/serialization decision
// under test is the real route handler's.
// ===========================================================================

const BILLING_READ_ROLES = ['APP_OWNER', 'FINANCE_ADMIN', 'AUDITOR_READ_ONLY'];
const BILLING_DENIED_ROLES = ['PLATFORM_ADMIN', 'SUPPORT_ADMIN'];

/** Replaces one prototype method for the duration of `run`, always restoring it. */
async function withStubbedMethod(target, name, impl, run) {
  const original = target[name];
  target[name] = impl;
  try {
    return await run();
  } finally {
    target[name] = original;
  }
}

// ---- GET /platform-admin/accounts + /:accountId --------------------------

const STUB_ACCOUNT = {
  familyId: 'family-billing-split-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  statusCapability: 'AVAILABLE',
  status: 'ACTIVE',
  suspendedAt: null,
  suspensionReason: null,
  entitlement: {
    planRef: 'PLAN_REF_ENTITLEMENT',
    parentMemberLimit: 2,
    managedDeviceLimit: 5,
    parentMemberUsedCount: 1,
    managedDeviceActiveCount: 3,
    managedDeviceReservedCount: 0,
    overLimitParentMember: false,
    overLimitManagedDevice: false,
  },
  latestSubscription: {
    subscriptionId: 'sub-secret-id',
    planId: 'plan-secret-id',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
  },
};

async function buildAccountsApp(sessions) {
  const app = Fastify({ logger: false });
  const { registerPlatformAdminAccountsRoutes } = await import('../../../dist/http/routes/platformadmin/accountsRoutes.js');
  registerPlatformAdminAccountsRoutes(app, {
    platformAdminAuthService: buildFakeAuthService(sessions),
    rateLimiter: createRateLimiter(),
  });
  return app;
}

test('GET /platform-admin/accounts: roles DENIED VIEW_BILLING_RECORDS receive no latestSubscription at all', async () => {
  const { AccountsReadModel } = await import('../../../dist/platformadmin/readmodels/AccountsReadModel.js');
  await withStubbedMethod(
    AccountsReadModel.prototype,
    'list',
    async () => ({ items: [STUB_ACCOUNT], total: 1, limit: 25, offset: 0 }),
    async () => {
      for (const role of BILLING_DENIED_ROLES) {
        const sessions = new Map();
        const token = registerSession(sessions, [role]);
        const app = await buildAccountsApp(sessions);
        const response = await app.inject({ method: 'GET', url: '/platform-admin/accounts', headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.statusCode, 200, `role ${role}`);
        const item = response.json().items[0];
        // The key is ABSENT, not null -- null already means "this family has
        // no subscription" and must stay distinguishable.
        assert.equal(Object.hasOwn(item, 'latestSubscription'), false, `role ${role} must not receive latestSubscription`);
        // Support-facing account/entitlement metadata is untouched.
        assert.equal(item.familyId, STUB_ACCOUNT.familyId);
        assert.equal(item.entitlement.managedDeviceLimit, 5);
        // Belt and braces: no billing identifier anywhere in the payload.
        assert.equal(response.body.includes('sub-secret-id'), false, `role ${role} leaked a subscription id`);
        assert.equal(response.body.includes('plan-secret-id'), false, `role ${role} leaked a plan id`);
        await app.close();
      }
    },
  );
});

test('GET /platform-admin/accounts: roles ALLOWED VIEW_BILLING_RECORDS still receive the full latestSubscription', async () => {
  const { AccountsReadModel } = await import('../../../dist/platformadmin/readmodels/AccountsReadModel.js');
  await withStubbedMethod(
    AccountsReadModel.prototype,
    'list',
    async () => ({ items: [STUB_ACCOUNT], total: 1, limit: 25, offset: 0 }),
    async () => {
      for (const role of BILLING_READ_ROLES) {
        const sessions = new Map();
        const token = registerSession(sessions, [role]);
        const app = await buildAccountsApp(sessions);
        const response = await app.inject({ method: 'GET', url: '/platform-admin/accounts', headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.statusCode, 200, `role ${role}`);
        const item = response.json().items[0];
        assert.equal(item.latestSubscription.subscriptionId, 'sub-secret-id', `role ${role}`);
        assert.equal(item.latestSubscription.planId, 'plan-secret-id', `role ${role}`);
        assert.equal(item.latestSubscription.status, 'ACTIVE', `role ${role}`);
        assert.ok(item.latestSubscription.currentPeriodEnd, `role ${role}`);
        await app.close();
      }
    },
  );
});

test('GET /platform-admin/accounts/:accountId applies the same split as the list route', async () => {
  const { AccountsReadModel } = await import('../../../dist/platformadmin/readmodels/AccountsReadModel.js');
  await withStubbedMethod(AccountsReadModel.prototype, 'getById', async () => STUB_ACCOUNT, async () => {
    const denied = new Map();
    const deniedToken = registerSession(denied, ['SUPPORT_ADMIN']);
    const deniedApp = await buildAccountsApp(denied);
    const deniedResponse = await deniedApp.inject({ method: 'GET', url: '/platform-admin/accounts/family-billing-split-1', headers: { authorization: `Bearer ${deniedToken}` } });
    assert.equal(deniedResponse.statusCode, 200);
    assert.equal(Object.hasOwn(deniedResponse.json(), 'latestSubscription'), false);
    await deniedApp.close();

    const allowed = new Map();
    const allowedToken = registerSession(allowed, ['FINANCE_ADMIN']);
    const allowedApp = await buildAccountsApp(allowed);
    const allowedResponse = await allowedApp.inject({ method: 'GET', url: '/platform-admin/accounts/family-billing-split-1', headers: { authorization: `Bearer ${allowedToken}` } });
    assert.equal(allowedResponse.statusCode, 200);
    assert.equal(allowedResponse.json().latestSubscription.planId, 'plan-secret-id');
    await allowedApp.close();
  });
});

// ---- GET /platform-admin/entitlement-requests ----------------------------

const STUB_REQUEST_ROW = {
  requestId: 'req-1',
  familyId: 'family-billing-split-1',
  limitType: 'MANAGED_DEVICE_LIMIT',
  currentLimitAtRequest: 5,
  targetLimit: 10,
  state: 'AWAITING_ADMIN_QUOTE',
  awaitingAdminQuote: true,
  noChargeOverride: false,
  quoteAmountMinor: '123456789',
  quoteCurrencyCode: 'GBP',
  quoteExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

const STUB_REQUEST_RECORD = {
  requestId: 'req-1',
  familyId: 'family-billing-split-1',
  limitType: 'MANAGED_DEVICE_LIMIT',
  currentLimitAtRequest: 5,
  targetLimit: 10,
  state: 'AWAITING_ADMIN_QUOTE',
  awaitingAdminQuote: true,
  noChargeOverride: false,
  quote: {
    quoteKind: 'CUSTOM',
    quoteRef: 'quote-ref-1',
    amountMinor: 123456789n,
    currencyCode: 'GBP',
    priceBookVersion: 3,
    quotedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
  },
  decidedByAdminId: null,
  decisionReason: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

async function buildEntitlementApp(sessions) {
  const app = Fastify({ logger: false });
  const { registerPlatformAdminEntitlementRoutes } = await import('../../../dist/http/routes/platformadmin/entitlementRoutes.js');
  registerPlatformAdminEntitlementRoutes(app, {
    platformAdminAuthService: buildFakeAuthService(sessions),
    // Neither route exercised below touches the entitlement service.
    platformAdminEntitlementService: {},
    changeRequestRepository: { async getById() { return STUB_REQUEST_RECORD; } },
    rateLimiter: createRateLimiter(),
  });
  return app;
}

test('GET /platform-admin/entitlement-requests: roles DENIED VIEW_BILLING_RECORDS receive no quote amount or currency', async () => {
  const { EntitlementRequestsReadModel } = await import('../../../dist/platformadmin/readmodels/EntitlementRequestsReadModel.js');
  await withStubbedMethod(
    EntitlementRequestsReadModel.prototype,
    'list',
    async () => ({ items: [STUB_REQUEST_ROW], total: 1, limit: 25, offset: 0 }),
    async () => {
      for (const role of BILLING_DENIED_ROLES) {
        const sessions = new Map();
        const token = registerSession(sessions, [role]);
        const app = await buildEntitlementApp(sessions);
        const response = await app.inject({ method: 'GET', url: '/platform-admin/entitlement-requests', headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.statusCode, 200, `role ${role}`);
        const item = response.json().items[0];
        assert.equal(Object.hasOwn(item, 'quoteAmountMinor'), false, `role ${role} must not receive quoteAmountMinor`);
        assert.equal(Object.hasOwn(item, 'quoteCurrencyCode'), false, `role ${role} must not receive quoteCurrencyCode`);
        assert.equal(response.body.includes('123456789'), false, `role ${role} leaked the negotiated amount`);
        // Non-monetary request/quote facts survive -- support triage needs them.
        assert.equal(item.requestId, 'req-1');
        assert.equal(item.targetLimit, 10);
        assert.ok(item.quoteExpiresAt);
        await app.close();
      }
    },
  );
});

test('GET /platform-admin/entitlement-requests: roles ALLOWED VIEW_BILLING_RECORDS still receive the amount and currency', async () => {
  const { EntitlementRequestsReadModel } = await import('../../../dist/platformadmin/readmodels/EntitlementRequestsReadModel.js');
  await withStubbedMethod(
    EntitlementRequestsReadModel.prototype,
    'list',
    async () => ({ items: [STUB_REQUEST_ROW], total: 1, limit: 25, offset: 0 }),
    async () => {
      for (const role of BILLING_READ_ROLES) {
        const sessions = new Map();
        const token = registerSession(sessions, [role]);
        const app = await buildEntitlementApp(sessions);
        const response = await app.inject({ method: 'GET', url: '/platform-admin/entitlement-requests', headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.statusCode, 200, `role ${role}`);
        const item = response.json().items[0];
        assert.equal(item.quoteAmountMinor, '123456789', `role ${role}`);
        assert.equal(item.quoteCurrencyCode, 'GBP', `role ${role}`);
        await app.close();
      }
    },
  );
});

test('GET /platform-admin/entitlement-requests/:requestId omits the quote money for billing-denied roles and keeps it for billing-allowed ones', async () => {
  for (const role of BILLING_DENIED_ROLES) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = await buildEntitlementApp(sessions);
    const response = await app.inject({ method: 'GET', url: '/platform-admin/entitlement-requests/req-1', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200, `role ${role}`);
    const quote = response.json().quote;
    assert.equal(Object.hasOwn(quote, 'amountMinor'), false, `role ${role} must not receive quote.amountMinor`);
    assert.equal(Object.hasOwn(quote, 'currencyCode'), false, `role ${role} must not receive quote.currencyCode`);
    assert.equal(quote.quoteRef, 'quote-ref-1');
    assert.equal(response.body.includes('123456789'), false, `role ${role} leaked the negotiated amount`);
    await app.close();
  }

  for (const role of BILLING_READ_ROLES) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = await buildEntitlementApp(sessions);
    const response = await app.inject({ method: 'GET', url: '/platform-admin/entitlement-requests/req-1', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200, `role ${role}`);
    assert.equal(response.json().quote.amountMinor, '123456789', `role ${role}`);
    assert.equal(response.json().quote.currencyCode, 'GBP', `role ${role}`);
    await app.close();
  }
});

// ---- GET /platform-admin/dashboard ---------------------------------------

const GROUPED = (byKey) => ({ capability: 'AVAILABLE', byKey });

const STUB_DASHBOARD_SNAPSHOT = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  accountsTotal: { capability: 'AVAILABLE', value: 7 },
  accountGrowthByMonth: { capability: 'AVAILABLE', rows: [] },
  accountsActiveSuspended: { capability: 'AVAILABLE', active: 7, suspended: 0 },
  parentMemberEntitlementUtilization: { capability: 'AVAILABLE', used: 1, limit: 2 },
  managedDeviceEntitlementUtilization: { capability: 'AVAILABLE', used: 3, limit: 5 },
  managedDeviceEntitlementByPlan: { capability: 'AVAILABLE', rows: [] },
  managedDeviceActive: { capability: 'AVAILABLE', value: 3 },
  managedDeviceReserved: { capability: 'AVAILABLE', value: 0 },
  pendingEntitlementRequests: { capability: 'AVAILABLE', value: 1 },
  entitlementRequestAging: { capability: 'AVAILABLE', open: 1, oldestCreatedAt: null, buckets: { lessThanOneDay: 1, oneToSevenDays: 0, sevenDaysOrMore: 0 } },
  entitlementRequestsByState: GROUPED({ AWAITING_ADMIN_QUOTE: 1 }),
  subscriptionsByStatus: GROUPED({ ACTIVE: 41 }),
  subscriptionsByPlanAndStatus: { capability: 'AVAILABLE', rows: [{ planCode: 'PLAN_X', status: 'ACTIVE', count: 41 }] },
  quotesByStatus: GROUPED({ ISSUED: 13 }),
  invoicesByStatusAndCurrency: { capability: 'AVAILABLE', rows: [] },
  paymentAttemptsByStatusAndCurrency: { capability: 'AVAILABLE', rows: [] },
  refundsByCurrency: { capability: 'AVAILABLE', rows: [] },
  paymentSummaryByCurrency: { capability: 'AVAILABLE', rows: [] },
  openDisputes: { capability: 'AVAILABLE', value: 0 },
  settlementSummary: { capability: 'AVAILABLE', summary: null },
  serviceHealth: { capability: 'AVAILABLE', openReconciliationExceptions: 0, mostRecentBatchStatusByAccount: [] },
  exceptionQueues: { capability: 'AVAILABLE', stuckPaymentAttempts: 2, expiredUnredeemedInvitations: 4, unresolvedReconciliations: 6 },
  operationalSignals: { capability: 'UNAVAILABLE', crashRate: null, capabilityActivationFailures: null, latencyBuckets: null },
};

const DASHBOARD_BILLING_FIELDS = ['subscriptionsByStatus', 'subscriptionsByPlanAndStatus', 'quotesByStatus'];

test('GET /platform-admin/dashboard: subscription/quote aggregates are withheld from roles DENIED VIEW_BILLING_RECORDS', async () => {
  const { DashboardReadModel } = await import('../../../dist/platformadmin/readmodels/DashboardReadModel.js');
  await withStubbedMethod(DashboardReadModel.prototype, 'build', async () => STUB_DASHBOARD_SNAPSHOT, async () => {
    for (const role of BILLING_DENIED_ROLES) {
      const sessions = new Map();
      const token = registerSession(sessions, [role]);
      const app = buildApp(sessions);
      const response = await app.inject({ method: 'GET', url: '/platform-admin/dashboard', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 200, `role ${role}`);
      const body = response.json();
      for (const field of DASHBOARD_BILLING_FIELDS) {
        assert.equal(Object.hasOwn(body, field), false, `role ${role} must not receive ${field}`);
      }
      // These are aggregates over billing_subscriptions/billing_quotes, so the
      // counts themselves must not survive anywhere in the payload.
      assert.equal(response.body.includes('41'), false, `role ${role} leaked a subscription count`);
      assert.equal(response.body.includes('13'), false, `role ${role} leaked a quote count`);
      // The non-financial operational subset is unchanged.
      assert.equal(body.accountsTotal.value, 7);
      assert.equal(body.entitlementRequestsByState.byKey.AWAITING_ADMIN_QUOTE, 1);
      await app.close();
    }
  });
});

test('GET /platform-admin/dashboard: subscription/quote aggregates are still delivered to roles ALLOWED VIEW_BILLING_RECORDS', async () => {
  const { DashboardReadModel } = await import('../../../dist/platformadmin/readmodels/DashboardReadModel.js');
  await withStubbedMethod(DashboardReadModel.prototype, 'build', async () => STUB_DASHBOARD_SNAPSHOT, async () => {
    for (const role of BILLING_READ_ROLES) {
      const sessions = new Map();
      const token = registerSession(sessions, [role]);
      const app = buildApp(sessions);
      const response = await app.inject({ method: 'GET', url: '/platform-admin/dashboard', headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 200, `role ${role}`);
      const body = response.json();
      for (const field of DASHBOARD_BILLING_FIELDS) {
        assert.equal(Object.hasOwn(body, field), true, `role ${role} should receive ${field}`);
      }
      assert.equal(body.subscriptionsByStatus.byKey.ACTIVE, 41, `role ${role}`);
      assert.equal(body.quotesByStatus.byKey.ISSUED, 13, `role ${role}`);
      await app.close();
    }
  });
});

// ===========================================================================
// PCA-STEPUP-ORDER-1 -- a single-use step-up grant must never be consumed by
// a request that is about to be rejected for a reason unrelated to the
// step-up. Consuming first meant a 403/404/400 destroyed the grant, and the
// documented idempotency-key retry then needed a fresh TOTP code from the
// operator's device.
// ===========================================================================

/** Fake auth service that records every consumeStepUp call, so ordering is directly assertable. */
function buildStepUpRecordingAuthService(sessions, { consumeThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    async validateSession(rawToken) {
      const session = sessions.get(rawToken);
      if (!session) {
        const { PlatformAdminAuthError } = await import('../../../dist/platformadmin/auth/PlatformAdminAuthService.js');
        throw new PlatformAdminAuthError();
      }
      return session;
    },
    async consumeStepUp(stepUpId, adminId, sessionId, scope) {
      calls.push({ stepUpId, adminId, sessionId, scope });
      if (consumeThrows) {
        const { PlatformAdminAuthError } = await import('../../../dist/platformadmin/auth/PlatformAdminAuthService.js');
        throw new PlatformAdminAuthError();
      }
    },
    async revokeAllSessions() {
      return { revokedSessionCount: 2 };
    },
  };
}

async function buildAdminUsersApp(authService) {
  const app = Fastify({ logger: false });
  const { registerPlatformAdminAdminUserRoutes } = await import('../../../dist/http/routes/platformadmin/adminUserRoutes.js');
  registerPlatformAdminAdminUserRoutes(app, {
    platformAdminAuthService: authService,
    // Never reached on the 403 paths under test; a real call would be a bug.
    platformAdminAccountService: {
      async createAccount() { throw new Error('account service must not be reached'); },
      async assignRole() { throw new Error('account service must not be reached'); },
      async revokeRole() { throw new Error('account service must not be reached'); },
      async disableAccount() { throw new Error('account service must not be reached'); },
      async reactivateAccount() { throw new Error('account service must not be reached'); },
    },
    rateLimiter: createRateLimiter(),
  });
  return app;
}

const ADMIN_USER_STEP_UP_CASES = [
  { name: 'POST /platform-admin/admin-users (create)', method: 'POST', url: '/platform-admin/admin-users', payload: { displayName: 'X', email: 'x@example.test', password: 'correct horse battery staple', role: 'SUPPORT_ADMIN', stepUpId: 'grant-1' } },
  { name: 'POST /platform-admin/admin-users/:adminId/roles', method: 'POST', url: '/platform-admin/admin-users/target-admin/roles', payload: { role: 'SUPPORT_ADMIN', action: 'GRANT', stepUpId: 'grant-1' } },
  { name: 'POST /platform-admin/admin-users/:adminId/disable', method: 'POST', url: '/platform-admin/admin-users/target-admin/disable', payload: { stepUpId: 'grant-1' } },
  { name: 'POST /platform-admin/admin-users/:adminId/reactivate', method: 'POST', url: '/platform-admin/admin-users/target-admin/reactivate', payload: { stepUpId: 'grant-1' } },
  { name: 'POST /platform-admin/admin-users/:adminId/sessions/revoke-all', method: 'POST', url: '/platform-admin/admin-users/target-admin/sessions/revoke-all', payload: { stepUpId: 'grant-1' } },
];

test('admin-user routes: an unauthorized role is 403ed WITHOUT its single-use step-up grant being consumed', async () => {
  for (const testCase of ADMIN_USER_STEP_UP_CASES) {
    for (const role of ['PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN', 'AUDITOR_READ_ONLY']) {
      const sessions = new Map();
      const token = registerSession(sessions, [role]);
      const authService = buildStepUpRecordingAuthService(sessions);
      const app = await buildAdminUsersApp(authService);
      const response = await app.inject({ method: testCase.method, url: testCase.url, headers: { authorization: `Bearer ${token}` }, payload: testCase.payload });
      assert.equal(response.statusCode, 403, `${testCase.name} / ${role}`);
      assert.equal(authService.calls.length, 0, `${testCase.name} / ${role} burned a step-up grant on a 403`);
      await app.close();
    }
  }
});

test('admin-user routes: a malformed body is 400ed WITHOUT the step-up grant being consumed', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const authService = buildStepUpRecordingAuthService(sessions);
  const app = await buildAdminUsersApp(authService);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/admin-users',
    headers: { authorization: `Bearer ${token}` },
    payload: { displayName: 'X', email: 'not-an-email', password: 'correct horse battery staple', role: 'SUPPORT_ADMIN', stepUpId: 'grant-1' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(authService.calls.length, 0);
  await app.close();
});

test('admin-user routes: an APP_OWNER caller still consumes exactly one ADMIN_ROLE_GRANT-scoped step-up on the authorized path', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const authService = buildStepUpRecordingAuthService(sessions);
  const app = await buildAdminUsersApp(authService);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/admin-users/target-admin/sessions/revoke-all',
    headers: { authorization: `Bearer ${token}` },
    payload: { stepUpId: 'grant-1' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { revokedSessionCount: 2 });
  assert.equal(authService.calls.length, 1);
  assert.equal(authService.calls[0].stepUpId, 'grant-1');
  assert.equal(authService.calls[0].scope, 'ADMIN_ROLE_GRANT');
  await app.close();
});

// ---- POST /billing/admin/refund ------------------------------------------

const REFUND_TRANSACTION = { paymentTransactionId: 'txn-1', provider: 'SANDBOX' };

function validRefundBody(overrides = {}) {
  return {
    paymentTransactionId: 'txn-1',
    amountMinor: '500',
    currencyCode: 'USD',
    reasonCode: 'GOODWILL',
    stepUpId: 'grant-1',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

async function buildRefundApp(authService, { transaction = REFUND_TRANSACTION, resolveThrows = false, orchestration } = {}) {
  const app = Fastify({ logger: false });
  const { registerBillingRefundRoutes } = await import('../../../dist/http/routes/billingRefundRoutes.js');
  const order = [];
  registerBillingRefundRoutes(app, {
    platformAdminAuthService: authService,
    providerRegistry: {
      resolve() {
        if (resolveThrows) throw new Error('unknown provider');
        return {};
      },
    },
    refundOrchestrationService: {
      async initiateRefund() {
        order.push('initiateRefund');
        return orchestration ?? {
          outcome: 'FINALIZED',
          refund: { refundId: 'refund-1', status: 'SUCCEEDED' },
          operation: { providerRefundRef: 'prov-1', refundOperationId: 'op-1' },
        };
      },
    },
    paymentRepository: {
      async findTransactionById() {
        return transaction;
      },
    },
    auditService: { async record() {} },
    rateLimiter: createRateLimiter(),
  });
  return { app, order };
}

/**
 * The refund route's transaction lookup runs inside `runInTransaction`, which
 * needs a real pool. Swap the shared CJS export for the duration of the test
 * (restored in `finally`) so the ORDERING under test -- and nothing else --
 * is what gets exercised.
 */
async function withStubbedRunInTransaction(run) {
  const { createRequire } = await import('node:module');
  const requireCjs = createRequire(import.meta.url);
  const pool = requireCjs('../../../dist/db/pool.js');
  const original = pool.runInTransaction;
  pool.runInTransaction = async (fn) => fn({ /* fake connection, never used by the stubs above */ });
  try {
    return await run();
  } finally {
    pool.runInTransaction = original;
  }
}

test('POST /billing/admin/refund: an unknown payment transaction 404s WITHOUT consuming the step-up grant', async () => {
  await withStubbedRunInTransaction(async () => {
    const sessions = new Map();
    const token = registerSession(sessions, ['FINANCE_ADMIN']);
    const authService = buildStepUpRecordingAuthService(sessions);
    const { app } = await buildRefundApp(authService, { transaction: null });
    const response = await app.inject({ method: 'POST', url: '/billing/admin/refund', headers: { authorization: `Bearer ${token}` }, payload: validRefundBody() });
    assert.equal(response.statusCode, 404);
    assert.equal(authService.calls.length, 0, 'a 404 must not burn the single-use REFUND grant');
    await app.close();
  });
});

test('POST /billing/admin/refund: a non-positive amount 400s WITHOUT consuming the step-up grant', async () => {
  await withStubbedRunInTransaction(async () => {
    const sessions = new Map();
    const token = registerSession(sessions, ['FINANCE_ADMIN']);
    const authService = buildStepUpRecordingAuthService(sessions);
    const { app } = await buildRefundApp(authService);
    const response = await app.inject({ method: 'POST', url: '/billing/admin/refund', headers: { authorization: `Bearer ${token}` }, payload: validRefundBody({ amountMinor: '0' }) });
    assert.equal(response.statusCode, 400);
    assert.equal(authService.calls.length, 0, 'a 400 must not burn the single-use REFUND grant');
    await app.close();
  });
});

test('POST /billing/admin/refund: an unresolvable provider 400s WITHOUT consuming the step-up grant', async () => {
  await withStubbedRunInTransaction(async () => {
    const sessions = new Map();
    const token = registerSession(sessions, ['FINANCE_ADMIN']);
    const authService = buildStepUpRecordingAuthService(sessions);
    const { app } = await buildRefundApp(authService, { resolveThrows: true });
    const response = await app.inject({ method: 'POST', url: '/billing/admin/refund', headers: { authorization: `Bearer ${token}` }, payload: validRefundBody() });
    assert.equal(response.statusCode, 400);
    assert.equal(authService.calls.length, 0, 'a 400 must not burn the single-use REFUND grant');
    await app.close();
  });
});

test('POST /billing/admin/refund: a role without ISSUE_REFUND is 403ed without consuming the grant or touching the provider', async () => {
  await withStubbedRunInTransaction(async () => {
    for (const role of ['SUPPORT_ADMIN', 'PLATFORM_ADMIN', 'AUDITOR_READ_ONLY']) {
      const sessions = new Map();
      const token = registerSession(sessions, [role]);
      const authService = buildStepUpRecordingAuthService(sessions);
      const { app, order } = await buildRefundApp(authService);
      const response = await app.inject({ method: 'POST', url: '/billing/admin/refund', headers: { authorization: `Bearer ${token}` }, payload: validRefundBody() });
      assert.equal(response.statusCode, 403, `role ${role}`);
      assert.equal(authService.calls.length, 0, `role ${role}`);
      assert.deepEqual(order, [], `role ${role}`);
      await app.close();
    }
  });
});

test('POST /billing/admin/refund: the authorized happy path still consumes exactly one REFUND-scoped grant, strictly BEFORE the money-moving call', async () => {
  await withStubbedRunInTransaction(async () => {
    const sessions = new Map();
    const token = registerSession(sessions, ['FINANCE_ADMIN']);
    const authService = buildStepUpRecordingAuthService(sessions);
    const { app, order } = await buildRefundApp(authService);
    const response = await app.inject({ method: 'POST', url: '/billing/admin/refund', headers: { authorization: `Bearer ${token}` }, payload: validRefundBody() });
    assert.equal(response.statusCode, 201);
    assert.equal(authService.calls.length, 1);
    assert.equal(authService.calls[0].scope, 'REFUND');
    assert.deepEqual(order, ['initiateRefund']);
    await app.close();
  });
});

test('POST /billing/admin/refund: a rejected step-up still blocks the refund outright (403, provider never called)', async () => {
  await withStubbedRunInTransaction(async () => {
    const sessions = new Map();
    const token = registerSession(sessions, ['FINANCE_ADMIN']);
    const authService = buildStepUpRecordingAuthService(sessions, { consumeThrows: true });
    const { app, order } = await buildRefundApp(authService);
    const response = await app.inject({ method: 'POST', url: '/billing/admin/refund', headers: { authorization: `Bearer ${token}` }, payload: validRefundBody() });
    assert.equal(response.statusCode, 403);
    assert.equal(authService.calls.length, 1);
    assert.deepEqual(order, [], 'no refund may be initiated without a valid step-up');
    await app.close();
  });
});
