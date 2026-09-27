import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { registerPlatformAdminAccountsRoutes } from '../../dist/http/routes/platformadmin/accountsRoutes.js';

const FAMILY_ID = 'family-parent-identity-route-1';
const SECRET_MARKERS = ['accountId', 'emailHash', 'protectedDisplayEmail', 'passwordHash', 'mfa', 'recoveryMaterial', 'verificationSecret', 'status', 'emailVerified', 'phoneVerified'];

const IDENTITY = {
  firstName: 'ليلى',
  lastName: 'حسن',
  email: 'layla@example.test',
  phoneNumber: '+14155552671',
  // Unexpected repository/model properties must not widen the route DTO.
  accountId: 'must-not-leak-parent-account-id',
  emailHash: 'sensitive-hash-marker',
  passwordHash: 'sensitive-password-marker',
  emailVerified: true,
  phoneVerified: false,
  familyMemberships: [{ familyId: 'another-family', role: 'ADMINISTRATOR' }],
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  status: 'VERIFIED',
};

function addSession(sessions, roles) {
  const token = `pa_${randomUUID()}`;
  sessions.set(token, {
    adminId: `admin-${randomUUID()}`,
    roles,
    sessionId: `session-${randomUUID()}`,
    sessionExpiresAt: new Date(Date.now() + 60_000),
  });
  return token;
}

function buildApp(sessions, parentIdentityReadModel) {
  const authService = {
    async validateSession(rawToken) {
      const session = sessions.get(rawToken);
      if (session) return session;
      const { PlatformAdminAuthError } = await import('../../dist/platformadmin/auth/PlatformAdminAuthService.js');
      throw new PlatformAdminAuthError();
    },
  };
  const app = Fastify({ logger: false });
  registerPlatformAdminAccountsRoutes(app, {
    platformAdminAuthService: authService,
    rateLimiter: createRateLimiter(),
    parentIdentityReadModel,
  });
  return app;
}

test('Platform parent identity DTO requires authentication and a dedicated PII role before lookup', async () => {
  let lookupCount = 0;
  const parentIdentityReadModel = {
    async getByFamilyId() {
      lookupCount += 1;
      return IDENTITY;
    },
  };
  const app = buildApp(new Map(), parentIdentityReadModel);
  const missing = await app.inject({ method: 'GET', url: `/platform-admin/accounts/${FAMILY_ID}/identity` });
  assert.equal(missing.statusCode, 401);

  for (const role of ['FINANCE_ADMIN', 'AUDITOR_READ_ONLY']) {
    const sessions = new Map();
    const token = addSession(sessions, [role]);
    const deniedApp = buildApp(sessions, parentIdentityReadModel);
    const denied = await deniedApp.inject({
      method: 'GET',
      url: `/platform-admin/accounts/${FAMILY_ID}/identity`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(denied.statusCode, 403, role);
    await deniedApp.close();
  }
  assert.equal(lookupCount, 0, 'unauthenticated and denied roles must not trigger identity lookup');
  await app.close();
});

test('authorized Platform identity route is exact-family scoped, no-store, and whitelist-only', async () => {
  const lookups = [];
  const parentIdentityReadModel = {
    async getByFamilyId(familyId) {
      lookups.push(familyId);
      return familyId === FAMILY_ID ? IDENTITY : null;
    },
  };
  const sessions = new Map();
  const token = addSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions, parentIdentityReadModel);

  const response = await app.inject({
    method: 'GET',
    url: `/platform-admin/accounts/${FAMILY_ID}/identity`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = response.json();
  assert.equal(body.firstName, 'ليلى');
  assert.equal(body.lastName, 'حسن');
  assert.equal(body.email, 'layla@example.test');
  assert.equal(body.phoneNumber, '+14155552671');
  assert.deepEqual(Object.keys(body).sort(), ['email', 'firstName', 'lastName', 'phoneNumber']);
  for (const marker of SECRET_MARKERS) assert.equal(Object.hasOwn(body, marker), false);
  assert.equal(response.body.includes('sensitive-hash-marker'), false);
  assert.equal(response.body.includes('sensitive-password-marker'), false);
  assert.deepEqual(lookups, [FAMILY_ID]);

  const otherAccount = await app.inject({
    method: 'GET',
    url: '/platform-admin/accounts/another-parent/identity',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(otherAccount.statusCode, 404);
  assert.deepEqual(lookups, [FAMILY_ID, 'another-parent']);
  await app.close();
});

test('ambiguous family authority fails closed without exposing candidate identities', async () => {
  const parentIdentityReadModel = {
    async getByFamilyId() {
      const { ParentIdentityAmbiguousError } = await import('../../dist/platformadmin/readmodels/ParentIdentityReadModel.js');
      throw new ParentIdentityAmbiguousError();
    },
  };
  const sessions = new Map();
  const token = addSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions, parentIdentityReadModel);
  const response = await app.inject({
    method: 'GET',
    url: `/platform-admin/accounts/${FAMILY_ID}/identity`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'identity_unavailable' });
  await app.close();
});
