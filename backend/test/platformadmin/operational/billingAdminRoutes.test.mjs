/**
 * HTTP-level auth/RBAC boundary test for
 * backend/src/http/routes/platformadmin/billingAdminRoutes.ts, following
 * the SAME pattern httpAuthzBoundary.test.mjs/releaseRoutes.test.mjs
 * already use for this lane: a real Fastify instance, the REAL
 * `createRequirePlatformAdminSession` preHandler + REAL route handlers +
 * the REAL `PaymentMethodService`/`SubscriptionService`/`DisputeService`
 * (each backed by its real repository class -- no fakes), with only
 * `PlatformAdminAuthService` faked (a plain object satisfying
 * `validateSession`'s call shape -- no DB needed for session lookup).
 *
 * Deliberately stops short of asserting a 200/201 success body for the
 * "authorized" cases: RBAC (`requireBillingOperation`, called INSIDE each
 * service method, before any repository call) runs before the real
 * MySQL-backed repository is ever touched, so every 401/403 path below is
 * fully exercisable without a database -- but a role that clears the RBAC
 * gate then reaches `runInTransaction`/`getPool()` (`PCA_DATABASE_URL`),
 * which this sandbox does not have available. Those cases assert only
 * "not 401, not 403" (the RBAC gate genuinely cleared), exactly mirroring
 * httpAuthzBoundary.test.mjs's own documented reasoning for this codebase's
 * other billing routes.
 *
 * No cross-family/cross-account IDOR cases: unlike FamilyCommercialService
 * (which resolves accountRef from the caller's OWN authenticated family
 * session), these three services are Platform-Admin-facing by design --
 * accountRef/subscriptionId/disputeId are legitimate operator-supplied
 * parameters, not a family's own scoped identity, so there is no
 * cross-family boundary to test here (the RBAC-role boundary below is the
 * actual authorization boundary this route layer enforces).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerPlatformAdminBillingAdminRoutes } from '../../../dist/http/routes/platformadmin/billingAdminRoutes.js';
import { PaymentMethodService, PaymentMethodRepository } from '../../../dist/billing/paymentMethod.js';
import { SubscriptionService, SubscriptionRepository } from '../../../dist/billing/subscription.js';
import { DisputeService, DisputeRepository } from '../../../dist/billing/dispute.js';
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

function buildApp(sessionsByToken) {
  const app = Fastify({ logger: false });
  const authService = buildFakeAuthService(sessionsByToken);
  const rateLimiter = createRateLimiter();
  const paymentMethodService = new PaymentMethodService(new PaymentMethodRepository());
  const subscriptionService = new SubscriptionService(new SubscriptionRepository());
  const disputeService = new DisputeService(new DisputeRepository());
  registerPlatformAdminBillingAdminRoutes(app, {
    platformAdminAuthService: authService,
    paymentMethodService,
    subscriptionService,
    disputeService,
    rateLimiter,
  });
  return app;
}

function addPaymentMethodBody(overrides = {}) {
  return {
    accountRef: `account-${randomUUID()}`,
    provider: 'TEST_SANDBOX',
    providerPaymentMethodRef: `pm-ref-${randomUUID()}`,
    brand: 'VISA',
    displayLabel: 'Visa ending 4242',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2030,
    ...overrides,
  };
}

function createSubscriptionBody(overrides = {}) {
  return {
    accountRef: `account-${randomUUID()}`,
    planId: `plan-${randomUUID()}`,
    status: 'ACTIVE',
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    paymentMethodId: null,
    ...overrides,
  };
}

function openDisputeBody(overrides = {}) {
  return {
    paymentTransactionId: `txn-${randomUUID()}`,
    evidenceDueAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    ...overrides,
  };
}

// ---- Auth boundary (401) ----

test('POST /platform-admin/billing/payment-methods with no Authorization header -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'POST', url: '/platform-admin/billing/payment-methods', payload: addPaymentMethodBody() });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
  await app.close();
});

test('GET /platform-admin/billing/payment-methods?accountRef=x with an unknown token -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({
    method: 'GET',
    url: '/platform-admin/billing/payment-methods?accountRef=x',
    headers: { authorization: 'Bearer pa_not-a-real-token' },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('POST /platform-admin/billing/subscriptions with no Authorization header -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'POST', url: '/platform-admin/billing/subscriptions', payload: createSubscriptionBody() });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('POST /platform-admin/billing/disputes with no Authorization header -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'POST', url: '/platform-admin/billing/disputes', payload: openDisputeBody() });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ---- RBAC boundary (403): VIEW_PAYMENT_INSTRUMENTS ----

test('POST /platform-admin/billing/payment-methods: SUPPORT_ADMIN session is 403 (ADMINISTER_BILLING_RECORDS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/payment-methods',
    headers: { authorization: `Bearer ${token}` },
    payload: addPaymentMethodBody(),
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('POST /platform-admin/billing/payment-methods: PLATFORM_ADMIN session is 403 (ADMINISTER_BILLING_RECORDS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/payment-methods',
    headers: { authorization: `Bearer ${token}` },
    payload: addPaymentMethodBody(),
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/billing/payment-methods: AUDITOR_READ_ONLY session is 403 (ADMINISTER_BILLING_RECORDS deny -- view access does not imply mutate access; security-review regression test, this role must NEVER be able to create a payment method through this route)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['AUDITOR_READ_ONLY']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/payment-methods',
    headers: { authorization: `Bearer ${token}` },
    payload: addPaymentMethodBody(),
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('GET /platform-admin/billing/payment-methods: SUPPORT_ADMIN session is 403 (VIEW_PAYMENT_INSTRUMENTS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'GET',
    url: '/platform-admin/billing/payment-methods?accountRef=account-x',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/billing/payment-methods with a valid session and an authorized role clears the RBAC gate (further failure, if any, is the expected DB-unavailable error in this sandbox, not an authorization rejection)', async () => {
  for (const role of ['APP_OWNER', 'FINANCE_ADMIN']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({
      method: 'POST',
      url: '/platform-admin/billing/payment-methods',
      headers: { authorization: `Bearer ${token}` },
      payload: addPaymentMethodBody(),
    });
    assert.notEqual(response.statusCode, 401, `role ${role} should not be 401`);
    assert.notEqual(response.statusCode, 403, `role ${role} should not be 403`);
    await app.close();
  }
});

// ---- RBAC boundary (403): ADMINISTER_BILLING_RECORDS ----

test('POST /platform-admin/billing/subscriptions: PLATFORM_ADMIN session is 403 (ADMINISTER_BILLING_RECORDS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/subscriptions',
    headers: { authorization: `Bearer ${token}` },
    payload: createSubscriptionBody(),
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('POST /platform-admin/billing/subscriptions: SUPPORT_ADMIN and AUDITOR_READ_ONLY sessions are 403 (ADMINISTER_BILLING_RECORDS deny -- view access does not imply mutate access)', async () => {
  for (const role of ['SUPPORT_ADMIN', 'AUDITOR_READ_ONLY']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({
      method: 'POST',
      url: '/platform-admin/billing/subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: createSubscriptionBody(),
    });
    assert.equal(response.statusCode, 403, `role ${role} should be 403`);
    await app.close();
  }
});

test('POST /platform-admin/billing/subscriptions/:subscriptionId/cancel: PLATFORM_ADMIN session is 403 (ADMINISTER_BILLING_RECORDS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: `/platform-admin/billing/subscriptions/${randomUUID()}/cancel`,
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/billing/subscriptions with a valid session and an authorized role clears the RBAC gate (further failure, if any, is the expected DB-unavailable error in this sandbox, not an authorization rejection)', async () => {
  for (const role of ['APP_OWNER', 'FINANCE_ADMIN']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({
      method: 'POST',
      url: '/platform-admin/billing/subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: createSubscriptionBody(),
    });
    assert.notEqual(response.statusCode, 401, `role ${role} should not be 401`);
    assert.notEqual(response.statusCode, 403, `role ${role} should not be 403`);
    await app.close();
  }
});

// ---- RBAC boundary (403): ADMINISTER_DISPUTE ----

test('POST /platform-admin/billing/disputes: SUPPORT_ADMIN session is 403 (ADMINISTER_DISPUTE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/disputes',
    headers: { authorization: `Bearer ${token}` },
    payload: openDisputeBody(),
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('POST /platform-admin/billing/disputes: PLATFORM_ADMIN and AUDITOR_READ_ONLY sessions are 403 (ADMINISTER_DISPUTE deny -- view access does not imply mutate access)', async () => {
  for (const role of ['PLATFORM_ADMIN', 'AUDITOR_READ_ONLY']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({
      method: 'POST',
      url: '/platform-admin/billing/disputes',
      headers: { authorization: `Bearer ${token}` },
      payload: openDisputeBody(),
    });
    assert.equal(response.statusCode, 403, `role ${role} should be 403`);
    await app.close();
  }
});

test('POST /platform-admin/billing/disputes/:disputeId/evidence: PLATFORM_ADMIN session is 403 (ADMINISTER_DISPUTE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: `/platform-admin/billing/disputes/${randomUUID()}/evidence`,
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/billing/disputes/:disputeId/resolve: SUPPORT_ADMIN session is 403 (ADMINISTER_DISPUTE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: `/platform-admin/billing/disputes/${randomUUID()}/resolve`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status: 'WON' },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/billing/disputes with a valid session and an authorized role clears the RBAC gate (further failure, if any, is the expected DB-unavailable error in this sandbox, not an authorization rejection)', async () => {
  for (const role of ['APP_OWNER', 'FINANCE_ADMIN']) {
    const sessions = new Map();
    const token = registerSession(sessions, [role]);
    const app = buildApp(sessions);
    const response = await app.inject({
      method: 'POST',
      url: '/platform-admin/billing/disputes',
      headers: { authorization: `Bearer ${token}` },
      payload: openDisputeBody(),
    });
    assert.notEqual(response.statusCode, 401, `role ${role} should not be 401`);
    assert.notEqual(response.statusCode, 403, `role ${role} should not be 403`);
    await app.close();
  }
});

// ---- RBAC boundary (403): VIEW_BILLING_RECORDS (dispute get-by-id) ----

test('GET /platform-admin/billing/disputes/:disputeId: SUPPORT_ADMIN session is 403 (VIEW_BILLING_RECORDS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'GET',
    url: `/platform-admin/billing/disputes/${randomUUID()}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/billing/disputes/:disputeId: PLATFORM_ADMIN session is 403 (VIEW_BILLING_RECORDS deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'GET',
    url: `/platform-admin/billing/disputes/${randomUUID()}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/billing/disputes/:disputeId with a valid session and AUDITOR_READ_ONLY clears the RBAC gate (VIEW_BILLING_RECORDS allow -- further failure, if any, is the expected DB-unavailable error in this sandbox, not an authorization rejection)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['AUDITOR_READ_ONLY']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'GET',
    url: `/platform-admin/billing/disputes/${randomUUID()}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.notEqual(response.statusCode, 401);
  assert.notEqual(response.statusCode, 403);
  await app.close();
});

// ---- Input validation (400s that fire before the service, and thus before DB, regardless of role) ----

test('POST /platform-admin/billing/payment-methods: malformed body (missing required fields) -> 400 before ever reaching the service', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/payment-methods',
    headers: { authorization: `Bearer ${token}` },
    payload: { accountRef: 'account-x' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'invalid_request' });
  await app.close();
});

test('POST /platform-admin/billing/payment-methods: malformed last4 (not 4 digits) -> 400, never echoed back in the error body', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/payment-methods',
    headers: { authorization: `Bearer ${token}` },
    payload: addPaymentMethodBody({ last4: '4242-1234-5678-9010' }),
  });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.deepEqual(body, { error: 'invalid_request' });
  assert.equal(JSON.stringify(body).includes('4242-1234-5678-9010'), false);
  await app.close();
});

test('GET /platform-admin/billing/payment-methods with no accountRef query param -> 400', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/billing/payment-methods', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 400);
  await app.close();
});

test('POST /platform-admin/billing/subscriptions: invalid status enum value -> 400', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/subscriptions',
    headers: { authorization: `Bearer ${token}` },
    payload: createSubscriptionBody({ status: 'NOT_A_REAL_STATUS' }),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'invalid_request' });
  await app.close();
});

test('POST /platform-admin/billing/subscriptions: malformed currentPeriodStart -> 400', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/subscriptions',
    headers: { authorization: `Bearer ${token}` },
    payload: createSubscriptionBody({ currentPeriodStart: 'not-a-date' }),
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});

test('POST /platform-admin/billing/disputes: missing paymentTransactionId -> 400', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/billing/disputes',
    headers: { authorization: `Bearer ${token}` },
    payload: { evidenceDueAt: new Date().toISOString() },
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});

test('POST /platform-admin/billing/disputes/:disputeId/resolve: invalid resolution status -> 400', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: `/platform-admin/billing/disputes/${randomUUID()}/resolve`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status: 'DRAW' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'invalid_request' });
  await app.close();
});
