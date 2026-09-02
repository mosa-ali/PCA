/**
 * HTTP-level test for the platform-admin release-management routes
 * (backend/src/http/routes/platformadmin/releaseRoutes.ts), following the
 * SAME pattern httpAuthzBoundary.test.mjs already uses for this lane: a
 * real Fastify instance, the REAL `createRequirePlatformAdminSession`
 * preHandler + REAL route handlers + REAL `authorizePlatformAdminOperation`
 * RBAC checks, with only `PlatformAdminAuthService` faked (plain object
 * satisfying `validateSession`'s call shape -- no DB needed for session
 * lookup). Unlike that file, this one CAN assert 200/201 success bodies
 * because `ReleaseService` here is wired to the deterministic in-memory
 * `ReleaseRepository` (test/support/inMemoryReleaseRepository.mjs) already
 * used by test/release/service.test.mjs -- no MySQL/`PCA_DATABASE_URL`
 * needed. That also proves the route layer genuinely delegates to
 * `ReleaseService` (real conflict/not-found/rollback semantics observed
 * through the HTTP layer), not just that it returns a canned response.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerPlatformAdminReleaseRoutes } from '../../../dist/http/routes/platformadmin/releaseRoutes.js';
import { ReleaseService } from '../../../dist/release/ReleaseService.js';
import { createInMemoryReleaseRepository } from '../../support/inMemoryReleaseRepository.mjs';
import { createRateLimiter } from '../../../dist/http/rateLimit.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

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
  const repository = createInMemoryReleaseRepository();
  const releaseService = new ReleaseService(repository);
  registerPlatformAdminReleaseRoutes(app, { platformAdminAuthService: authService, releaseService, rateLimiter });
  return app;
}

function publishBody(overrides = {}) {
  return {
    packageType: 'ANDROID_APP',
    platform: 'ANDROID',
    version: '1.0.0',
    artifactDigest: DIGEST_A,
    artifactSizeBytes: 1024,
    signingKeyId: 'signing-key-2026-01',
    signedMetadata: Buffer.from('externally-signed-metadata-blob').toString('base64'),
    ...overrides,
  };
}

// ---- Auth boundary (401) ----

test('POST /platform-admin/releases with no Authorization header -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({ method: 'POST', url: '/platform-admin/releases', payload: publishBody() });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
  await app.close();
});

test('GET /platform-admin/releases/current/ANDROID_APP/ANDROID with an unknown token -> 401', async () => {
  const app = buildApp(new Map());
  const response = await app.inject({
    method: 'GET',
    url: '/platform-admin/releases/current/ANDROID_APP/ANDROID',
    headers: { authorization: 'Bearer pa_not-a-real-token' },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ---- RBAC boundary (403) ----

test('POST /platform-admin/releases: FINANCE_ADMIN session is 403 (ADMINISTER_RELEASE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['FINANCE_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'POST', url: '/platform-admin/releases', headers: { authorization: `Bearer ${token}` }, payload: publishBody() });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { error: 'forbidden' });
  await app.close();
});

test('POST /platform-admin/releases: SUPPORT_ADMIN session is 403 (VIEW_RELEASE allow does not imply ADMINISTER_RELEASE allow)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'POST', url: '/platform-admin/releases', headers: { authorization: `Bearer ${token}` }, payload: publishBody() });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('GET /platform-admin/releases/current/ANDROID_APP/ANDROID: FINANCE_ADMIN session is 403 (VIEW_RELEASE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['FINANCE_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'GET', url: '/platform-admin/releases/current/ANDROID_APP/ANDROID', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/releases/:releaseId/retire: SUPPORT_ADMIN session is 403 (ADMINISTER_RELEASE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['SUPPORT_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/releases/ANDROID_APP:ANDROID:1.0.0/retire',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('POST /platform-admin/releases/rollback: FINANCE_ADMIN session is 403 (ADMINISTER_RELEASE deny)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['FINANCE_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/releases/rollback',
    headers: { authorization: `Bearer ${token}` },
    payload: { packageType: 'ANDROID_APP', platform: 'ANDROID', targetVersion: '1.0.0' },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

// ---- Authorized access + real delegation to ReleaseService ----

test('POST /platform-admin/releases with PLATFORM_ADMIN session publishes a release (201, DTO reflects the created record, signedMetadata round-trips as base64)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const body = publishBody();
  const response = await app.inject({ method: 'POST', url: '/platform-admin/releases', headers: { authorization: `Bearer ${token}` }, payload: body });
  assert.equal(response.statusCode, 201);
  const dto = response.json();
  assert.equal(dto.releaseId, 'ANDROID_APP:ANDROID:1.0.0');
  assert.equal(dto.state, 'PUBLISHED');
  assert.equal(dto.artifactDigest, DIGEST_A);
  assert.equal(dto.signedMetadata, body.signedMetadata);
  assert.equal(typeof dto.publishedAt, 'string');
  await app.close();
});

test('APP_OWNER can publish, then GET the same release by releaseId returns 200 with matching data (proves the two routes share the same underlying service/repository)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  await app.inject({ method: 'POST', url: '/platform-admin/releases', headers: { authorization: `Bearer ${token}` }, payload: publishBody() });
  const response = await app.inject({
    method: 'GET',
    url: '/platform-admin/releases/ANDROID_APP:ANDROID:1.0.0',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().releaseId, 'ANDROID_APP:ANDROID:1.0.0');
  await app.close();
});

test('GET /platform-admin/releases/:releaseId for an unknown id -> 404 (ReleaseError NOT_FOUND mapped)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['AUDITOR_READ_ONLY']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'GET',
    url: '/platform-admin/releases/ANDROID_APP:ANDROID:9.9.9',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'not_found' });
  await app.close();
});

test('publishing a conflicting release (same identity, different digest) -> 409 (ReleaseError CONFLICT mapped, proves real conflict logic, not a stub)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  await app.inject({ method: 'POST', url: '/platform-admin/releases', headers: { authorization: `Bearer ${token}` }, payload: publishBody() });
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/releases',
    headers: { authorization: `Bearer ${token}` },
    payload: publishBody({ artifactDigest: DIGEST_B }),
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: 'conflict' });
  await app.close();
});

test('publishing with a malformed artifact digest -> 400 (ReleaseError INVALID_INPUT mapped)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/releases',
    headers: { authorization: `Bearer ${token}` },
    payload: publishBody({ artifactDigest: 'not-a-digest' }),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'invalid_request' });
  await app.close();
});

test('GET current release after publishing two versions returns the higher version (numeric ordering), then retire+rollback move the pointer through the real repository', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['APP_OWNER']);
  const app = buildApp(sessions);
  const headers = { authorization: `Bearer ${token}` };

  await app.inject({ method: 'POST', url: '/platform-admin/releases', headers, payload: publishBody({ version: '1.0.0', artifactDigest: DIGEST_A }) });
  await app.inject({ method: 'POST', url: '/platform-admin/releases', headers, payload: publishBody({ version: '2.0.0', artifactDigest: DIGEST_B }) });

  const current = await app.inject({ method: 'GET', url: '/platform-admin/releases/current/ANDROID_APP/ANDROID', headers });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().version, '2.0.0');

  const rollback = await app.inject({
    method: 'POST',
    url: '/platform-admin/releases/rollback',
    headers,
    payload: { packageType: 'ANDROID_APP', platform: 'ANDROID', targetVersion: '1.0.0' },
  });
  assert.equal(rollback.statusCode, 200);
  assert.equal(rollback.json().version, '1.0.0');
  assert.equal(rollback.json().isExplicitRollback, true);

  const currentAfterRollback = await app.inject({ method: 'GET', url: '/platform-admin/releases/current/ANDROID_APP/ANDROID', headers });
  assert.equal(currentAfterRollback.json().version, '1.0.0');

  const retire = await app.inject({ method: 'POST', url: '/platform-admin/releases/ANDROID_APP:ANDROID:1.0.0/retire', headers, payload: {} });
  assert.equal(retire.statusCode, 200);
  assert.equal(retire.json().state, 'RETIRED');

  // retiring the (rolled-back-to) current release falls back to the next-highest PUBLISHED version.
  const currentAfterRetire = await app.inject({ method: 'GET', url: '/platform-admin/releases/current/ANDROID_APP/ANDROID', headers });
  assert.equal(currentAfterRetire.statusCode, 200);
  assert.equal(currentAfterRetire.json().version, '2.0.0');
  await app.close();
});

test('rolling back to a target that was never published -> 404 rollback_target_not_found (ReleaseError ROLLBACK_TARGET_NOT_FOUND mapped)', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({
    method: 'POST',
    url: '/platform-admin/releases/rollback',
    headers: { authorization: `Bearer ${token}` },
    payload: { packageType: 'ANDROID_APP', platform: 'ANDROID', targetVersion: '9.9.9' },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'rollback_target_not_found' });
  await app.close();
});

test('malformed publish body (missing required fields) -> 400 before ever reaching the service', async () => {
  const sessions = new Map();
  const token = registerSession(sessions, ['PLATFORM_ADMIN']);
  const app = buildApp(sessions);
  const response = await app.inject({ method: 'POST', url: '/platform-admin/releases', headers: { authorization: `Bearer ${token}` }, payload: { packageType: 'ANDROID_APP' } });
  assert.equal(response.statusCode, 400);
  await app.close();
});
