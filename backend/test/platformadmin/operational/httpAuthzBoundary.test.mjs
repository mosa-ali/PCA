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
