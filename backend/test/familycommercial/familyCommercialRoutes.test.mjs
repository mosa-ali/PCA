// PCA-MYKIDS-BILL-2 -- HTTP-level tests for familyCommercialRoutes.ts:
// family scoping, authority-unavailable handling, Owner authorized via an
// injected trusted resolver, Administrator/Viewer denied, cross-family
// denial (IDOR), platform-admin-shaped tokens rejected, and payment-method
// safe serialization.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { FamilyCommercialService } from '../../dist/familycommercial/FamilyCommercialService.js';
import { registerFamilyCommercialRoutes } from '../../dist/http/routes/familyCommercialRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryEntitlementRepository } from '../support/inMemoryEntitlementRepository.mjs';
import { createInMemoryChangeRequestRepository } from '../support/inMemoryChangeRequestRepository.mjs';
import { createStubChangeRequestService } from '../support/stubChangeRequestService.mjs';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

function fakeRunQuery(fn) {
  return fn(undefined);
}

const FIXED_NOW = new Date('2026-06-01T00:00:00Z');

/** Configurable FamilyCommercialAuthorityResolver test double -- lets a test declare exactly which (familyId, actorDeviceId) pairs are OWNER_AUTHORIZED/ROLE_DENIED/AUTHORITY_UNAVAILABLE, independent of the real (tests-only) TrustSet-backed implementation exercised in test/billing/familyCommercialAuthorityResolver.test.mjs. */
function buildResolver(map) {
  return {
    resolveOwnerAuthority(familyId, actorDeviceId) {
      const key = `${familyId}:${actorDeviceId}`;
      return map.get(key) ?? { status: 'AUTHORITY_UNAVAILABLE' };
    },
  };
}

function buildHarness({ resolver } = {}) {
  const authService = new AuthService(createInMemoryAuthRepository());
  const authzRepository = createInMemoryAuthzRepository();
  const entitlementRepository = createInMemoryEntitlementRepository();
  entitlementRepository._seedDefaults('FREE_STARTER', 1, 1, FIXED_NOW);
  const changeRequestRepository = createInMemoryChangeRequestRepository();
  const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
  const changeRequestService = createStubChangeRequestService(changeRequestRepository, () => FIXED_NOW);
  const subscriptionsByFamily = new Map();
  const subscriptionRepository = {
    async findActiveForAccount(_conn, accountRef) { return subscriptionsByFamily.get(accountRef) ?? null; },
    async updateAutoRenew(_conn, subscriptionId, autoRenew) {
      for (const [accountRef, row] of subscriptionsByFamily) {
        if (row.subscriptionId === subscriptionId) subscriptionsByFamily.set(accountRef, { ...row, autoRenew });
      }
    },
  };
  const paymentMethodRepository = {
    async listForAccount(_conn, accountRef) {
      if (accountRef !== 'family-A') return [];
      return [{ paymentMethodId: 'pm-1', accountRef, provider: 'SANDBOX', providerPaymentMethodRef: 'ref-1', brand: 'VISA', displayLabel: 'Visa •••• 4242', last4: '4242', expiryMonth: 12, expiryYear: 2030, status: 'ACTIVE', createdAt: FIXED_NOW }];
    },
  };
  const invoiceReadRepository = { async listForFamily() { return []; }, async findForFamily() { return null; }, async listLines() { return []; } };
  const familyCommercialService = new FamilyCommercialService(entitlementService, changeRequestRepository, changeRequestService, subscriptionRepository, paymentMethodRepository, invoiceReadRepository, () => FIXED_NOW, fakeRunQuery);

  const rateLimiter = createRateLimiter();
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    reply.code(statusCode >= 500 ? 500 : statusCode).send({ error: statusCode >= 500 ? 'internal_error' : 'invalid_request' });
  });
  registerFamilyCommercialRoutes(app, {
    familyCommercialService,
    authService,
    authzRepository,
    familyCommercialAuthorityResolver: resolver ?? buildResolver(new Map()),
    rateLimiter,
    authAttemptLimiter: rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'test-auth-attempt' }),
  });
  return { app, authService, authzRepository, changeRequestRepository, subscriptionsByFamily };
}

async function issueToken(authService, subject) {
  const { rawToken, session } = await authService.issueSession(verifyTestOnlyIdentity(subject));
  return { rawToken, accountId: session.accountId };
}

// ---------------------------------------------------------------------------
// Family scoping / platform-admin rejection
// ---------------------------------------------------------------------------

test('no Authorization header: 401, never reaches family-scope logic', async () => {
  const { app } = buildHarness();
  const response = await app.inject({ method: 'GET', url: '/v1/families/family-A/commercial/entitlement' });
  assert.equal(response.statusCode, 401);
});

test('a platform-admin-shaped bearer token (foreign to AuthService) is rejected with the same generic 401 -- this route mounts only requireServiceSession(AuthService), never PlatformAdminAuthService', async () => {
  const { app } = buildHarness();
  const response = await app.inject({
    method: 'GET',
    url: '/v1/families/family-A/commercial/entitlement',
    headers: { authorization: `Bearer ${'P'.repeat(43)}` },
  });
  assert.equal(response.statusCode, 401);
});

test('recognized service account with NO family-scope row for the target family: 403 forbidden', async () => {
  const { app, authService } = buildHarness();
  const { rawToken } = await issueToken(authService, 'owner-1');
  const response = await app.inject({ method: 'GET', url: '/v1/families/family-A/commercial/entitlement', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 403);
});

test('cross-family IDOR: a caller scoped to family A cannot read family B\'s entitlement by supplying familyId=family-B', async () => {
  const { app, authService, authzRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const response = await app.inject({ method: 'GET', url: '/v1/families/family-B/commercial/entitlement', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 403);
});

test('active family scope: entitlement read succeeds', async () => {
  const { app, authService, authzRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const response = await app.inject({ method: 'GET', url: '/v1/families/family-A/commercial/entitlement', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.managedDeviceLimit, 1);
  assert.equal(body.tier, 'FREE_STARTER');
});

// ---------------------------------------------------------------------------
// Owner-authority gate on mutations
// ---------------------------------------------------------------------------

test('AUTHORITY_UNAVAILABLE is NEVER treated as authorized -- device-limit request creation is denied with a distinguishable code', async () => {
  const resolver = buildResolver(new Map()); // empty map => every lookup is AUTHORITY_UNAVAILABLE
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5, actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE');
});

test('Administrator role: ROLE_DENIED, generic 403 (never distinguishable from a random deny, never treated as Owner)', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-admin', { status: 'ROLE_DENIED' }]]));
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken, accountId } = await issueToken(authService, 'admin-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  authzRepository._addLicense(accountId, 'ACTIVE', null);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5, actorDeviceId: 'dev-admin' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, undefined);
});

test('Viewer role: ROLE_DENIED, generic 403', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-viewer', { status: 'ROLE_DENIED' }]]));
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken, accountId } = await issueToken(authService, 'viewer-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  authzRepository._addLicense(accountId, 'ACTIVE', null);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 3, actorDeviceId: 'dev-viewer' },
  });
  assert.equal(response.statusCode, 403);
});

test('Owner authorized via injected trusted resolver: device-limit request is created (license present)', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  authzRepository._addLicense(accountId, 'ACTIVE', null);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5, actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().targetLimit, 5);
});

test('Owner authorized but NO active license: device-limit (billable) request denied 403; parent-member (non-billable) request still succeeds', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  // Deliberately NO _addLicense call.
  const deviceResponse = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { limitType: 'MANAGED_DEVICE_LIMIT', targetLimit: 5, actorDeviceId: 'dev-owner' },
  });
  assert.equal(deviceResponse.statusCode, 403);

  const parentResponse = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 3, actorDeviceId: 'dev-owner' },
  });
  assert.equal(parentResponse.statusCode, 201);
});

test('cross-family IDOR on cancel: family B cannot cancel family A\'s request', async () => {
  const resolver = buildResolver(new Map([
    ['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }],
    ['family-B:dev-owner-b', { status: 'OWNER_AUTHORIZED' }],
  ]));
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken: tokenA, accountId: accountA } = await issueToken(authService, 'owner-a');
  authzRepository._grantScope(accountA, 'family-A', 'ACTIVE');
  const created = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/requests',
    headers: { authorization: `Bearer ${tokenA}` },
    payload: { limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 3, actorDeviceId: 'dev-owner' },
  });
  assert.equal(created.statusCode, 201);
  const { requestId } = created.json();

  const { rawToken: tokenB, accountId: accountB } = await issueToken(authService, 'owner-b');
  authzRepository._grantScope(accountB, 'family-B', 'ACTIVE');
  const cancelResponse = await app.inject({
    method: 'POST',
    url: `/v1/families/family-B/commercial/requests/${requestId}/cancel`,
    headers: { authorization: `Bearer ${tokenB}` },
    payload: { actorDeviceId: 'dev-owner-b' },
  });
  // family-B has no scope-row visibility of family-A's request at all --
  // the ownership check inside FamilyCommercialService.cancelRequest maps
  // this to NOT_FOUND (404), same as a made-up id.
  assert.equal(cancelResponse.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Subscription auto-renew cancel/resume (migrations/0031_billing_
// subscription_auto_renew.sql) -- same Owner-gate + family-scope discipline
// as the increase-request mutations above.
// ---------------------------------------------------------------------------

function seedActiveSubscription(subscriptionsByFamily, familyId, subscriptionId, autoRenew) {
  subscriptionsByFamily.set(familyId, {
    subscriptionId,
    accountRef: familyId,
    planId: 'plan-1',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    paymentMethodId: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    canceledAt: null,
    autoRenew,
  });
}

test('auto-renew cancel: Owner authorized turns auto_renew off and returns an auditEventId; a subsequent subscription read reflects it', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository, subscriptionsByFamily } = buildHarness({ resolver });
  seedActiveSubscription(subscriptionsByFamily, 'family-A', 'sub-a', true);
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');

  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/subscription/auto-renew/cancel',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json().auditEventId, 'string');
  assert.ok(response.json().auditEventId.length > 0);

  const readResponse = await app.inject({
    method: 'GET',
    url: '/v1/families/family-A/commercial/subscription',
    headers: { authorization: `Bearer ${rawToken}` },
  });
  assert.equal(readResponse.json().autoRenew, false);
});

test('auto-renew resume: Owner authorized turns auto_renew back on -- cancel and resume are symmetric, not a one-way terminal transition', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository, subscriptionsByFamily } = buildHarness({ resolver });
  seedActiveSubscription(subscriptionsByFamily, 'family-A', 'sub-a', false);
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');

  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/subscription/auto-renew/resume',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json().auditEventId, 'string');

  const readResponse = await app.inject({
    method: 'GET',
    url: '/v1/families/family-A/commercial/subscription',
    headers: { authorization: `Bearer ${rawToken}` },
  });
  assert.equal(readResponse.json().autoRenew, true);
});

test('auto-renew cancel: idempotent -- calling it twice in a row both succeed (200) and the final state is still autoRenew=false', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository, subscriptionsByFamily } = buildHarness({ resolver });
  seedActiveSubscription(subscriptionsByFamily, 'family-A', 'sub-a', true);
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');

  for (let i = 0; i < 2; i++) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/families/family-A/commercial/subscription/auto-renew/cancel',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { actorDeviceId: 'dev-owner' },
    });
    assert.equal(response.statusCode, 200, `call ${i + 1} must succeed, never error on a repeat`);
  }
  assert.equal(subscriptionsByFamily.get('family-A').autoRenew, false);
});

test('auto-renew cancel: AUTHORITY_UNAVAILABLE is never treated as authorized (distinguishable 403, no mutation applied)', async () => {
  const resolver = buildResolver(new Map()); // empty map => every lookup is AUTHORITY_UNAVAILABLE
  const { app, authService, authzRepository, subscriptionsByFamily } = buildHarness({ resolver });
  seedActiveSubscription(subscriptionsByFamily, 'family-A', 'sub-a', true);
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');

  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/subscription/auto-renew/cancel',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE');
  assert.equal(subscriptionsByFamily.get('family-A').autoRenew, true, 'a denied request must never mutate the subscription');
});

test('auto-renew cancel: a FREE_STARTER family with no active subscription row gets 404, never a fabricated success', async () => {
  const resolver = buildResolver(new Map([['family-A:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository } = buildHarness({ resolver });
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');

  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-A/commercial/subscription/auto-renew/cancel',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 404);
});

test('cross-family IDOR on auto-renew: a caller scoped to family A cannot toggle family B\'s subscription by supplying familyId=family-B', async () => {
  const resolver = buildResolver(new Map([['family-B:dev-owner', { status: 'OWNER_AUTHORIZED' }]]));
  const { app, authService, authzRepository, subscriptionsByFamily } = buildHarness({ resolver });
  seedActiveSubscription(subscriptionsByFamily, 'family-B', 'sub-b', true);
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE'); // scoped to A only, never B

  const response = await app.inject({
    method: 'POST',
    url: '/v1/families/family-B/commercial/subscription/auto-renew/cancel',
    headers: { authorization: `Bearer ${rawToken}` },
    payload: { actorDeviceId: 'dev-owner' },
  });
  assert.equal(response.statusCode, 403, 'no ACTIVE family-scope row for family-B -- rejected before the Owner gate or the service is ever reached');
  assert.equal(subscriptionsByFamily.get('family-B').autoRenew, true, 'family B\'s subscription must be untouched');
});

// ---------------------------------------------------------------------------
// Payment-method safe serialization
// ---------------------------------------------------------------------------

test('payment-method read never serializes anything beyond the allowlisted safe fields (no PAN/CVV/secret can leak even if present upstream)', async () => {
  const { app, authService, authzRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'owner-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const response = await app.inject({ method: 'GET', url: '/v1/families/family-A/commercial/payment-methods', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const { paymentMethods } = response.json();
  assert.equal(paymentMethods.length, 1);
  const allowedKeys = new Set(['paymentMethodId', 'brand', 'last4', 'expiryMonth', 'expiryYear', 'displayLabel']);
  for (const key of Object.keys(paymentMethods[0])) {
    assert.ok(allowedKeys.has(key), `unexpected payment-method field leaked to the wire: ${key}`);
  }
});
