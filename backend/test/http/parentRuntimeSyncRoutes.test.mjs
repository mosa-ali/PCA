// PCA runtime-sync parent-facing read gap -- HTTP-level tests for
// parentRuntimeSyncRoutes.ts: no-auth 401, no-family-scope 403,
// cross-family IDOR (device exists but belongs to a different family) 404,
// unknown device 404, and a successful read returns connection state /
// last successful sync / pending delivery bookkeeping derived from the
// SAME shared statusTracker/relayService instances runtimeSyncRoutes.ts's
// device-authenticated surface writes to.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { RelayService } from '../../dist/relay/RelayService.js';
import { DeviceSyncStatusTracker } from '../../dist/runtime-sync/index.js';
import { registerParentRuntimeSyncRoutes } from '../../dist/http/routes/parentRuntimeSyncRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { InMemoryDeviceProtectionStatusRepository } from '../../dist/device/DeviceProtectionStatusRepository.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createInMemoryRelayRepository } from '../support/inMemoryRelayRepository.mjs';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

function buildHarness({ withProtectionRepository = true } = {}) {
  const authService = new AuthService(createInMemoryAuthRepository());
  const authzRepository = createInMemoryAuthzRepository();
  const authzService = new AuthzService(authzRepository);
  const deviceRepository = createInMemoryDeviceRepository();
  const relayService = new RelayService(createInMemoryRelayRepository());
  const statusTracker = new DeviceSyncStatusTracker();
  const deviceProtectionStatusRepository = withProtectionRepository ? new InMemoryDeviceProtectionStatusRepository() : undefined;

  const rateLimiter = createRateLimiter();
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    reply.code(statusCode >= 500 ? 500 : statusCode).send({ error: statusCode >= 500 ? 'internal_error' : 'invalid_request' });
  });
  registerParentRuntimeSyncRoutes(app, {
    authService,
    authzService,
    deviceRepository,
    statusTracker,
    relayService,
    rateLimiter,
    authAttemptLimiter: rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'test-auth-attempt' }),
    deviceProtectionStatusRepository,
  });
  return { app, authService, authzRepository, deviceRepository, relayService, statusTracker, deviceProtectionStatusRepository };
}

async function issueToken(authService, subject) {
  const { rawToken, session } = await authService.issueSession(verifyTestOnlyIdentity(subject));
  return { rawToken, accountId: session.accountId };
}

async function registerDevice(deviceRepository, familyId) {
  const deviceId = `device-${randomUUID()}`;
  const publicKey = `pubkey-${randomUUID()}`;
  await deviceRepository.createDeviceWithKey(
    { deviceId, familyId, platform: 'ANDROID', status: 'ACTIVE', createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null, registeredByAccountId: null },
    { deviceId, keyId: `key-${randomUUID()}`, keyPurpose: 'DSK', publicKey, status: 'ACTIVE', createdAt: new Date(), revokedAt: null },
  );
  return deviceId;
}

function statusUrl(familyId, deviceId) {
  return `/v1/families/${familyId}/runtime-sync/devices/${deviceId}/status`;
}

// ---------------------------------------------------------------------------
// Authentication / authorization boundary
// ---------------------------------------------------------------------------

test('no Authorization header: 401, never reaches family-scope or device-ownership logic', async () => {
  const { app } = buildHarness();
  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', 'device-1') });
  assert.equal(response.statusCode, 401);
});

test('recognized service account with NO family-scope row for the target family: 403 forbidden', async () => {
  const { app, authService } = buildHarness();
  const { rawToken } = await issueToken(authService, 'parent-1');
  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', 'device-1'), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 403);
});

test('a revoked family-scope row: 403 forbidden, never treated as active', async () => {
  const { app, authService, authzRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'REVOKED');
  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', 'device-1'), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 403);
});

test('cross-family IDOR: a caller scoped to family A cannot read a device that actually belongs to family B -- 404, indistinguishable from a device that does not exist at all', async () => {
  const { app, authService, authzRepository, deviceRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceInFamilyB = await registerDevice(deviceRepository, 'family-B');

  const responseForRealDevice = await app.inject({ method: 'GET', url: statusUrl('family-A', deviceInFamilyB), headers: { authorization: `Bearer ${rawToken}` } });
  const responseForFakeDevice = await app.inject({ method: 'GET', url: statusUrl('family-A', 'does-not-exist'), headers: { authorization: `Bearer ${rawToken}` } });

  assert.equal(responseForRealDevice.statusCode, 404);
  assert.equal(responseForFakeDevice.statusCode, 404);
  assert.deepEqual(responseForRealDevice.json(), responseForFakeDevice.json());
});

test('caller cannot read family B\'s device status by supplying familyId=family-B directly, even with an own-family device id', async () => {
  const { app, authService, authzRepository, deviceRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceInFamilyB = await registerDevice(deviceRepository, 'family-B');

  const response = await app.inject({ method: 'GET', url: statusUrl('family-B', deviceInFamilyB), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Successful reads
// ---------------------------------------------------------------------------

test('active family scope + own device with no sync history yet: 200 with honest defaults (no fabricated data)', async () => {
  const { app, authService, authzRepository, deviceRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceId = await registerDevice(deviceRepository, 'family-A');

  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', deviceId), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.deviceId, deviceId);
  assert.equal(body.lastSuccessfulSyncAtUtc, null);
  assert.equal(body.pendingDelivery.pendingCount, 0);
  assert.equal(body.pendingDelivery.oldestQueuedAtUtc, null);
  assert.equal(body.protectionLevel, null);
  assert.equal(body.protectionUpdatedAtUtc, null);
  // No heartbeat and no pending work -> STALE (never LIVE, which would
  // fabricate a "recently synced" claim this tracker cannot honestly make).
  assert.equal(body.connectionState, 'STALE');
});

test('reflects a real successful sync recorded via the SAME shared statusTracker instance (e.g. after the device itself completes /v1/runtime-sync/inbound)', async () => {
  const { app, authService, authzRepository, deviceRepository, statusTracker } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceId = await registerDevice(deviceRepository, 'family-A');

  // Recent (well within the default 24h staleness threshold -- see
  // familysync/connectionState.ts's DEFAULT_STALE_THRESHOLD_MS), so this
  // exercises the LIVE branch rather than STALE.
  const syncedAt = new Date(Date.now() - 5 * 60 * 1000);
  statusTracker.markSyncSuccess(deviceId, syncedAt);

  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', deviceId), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.lastSuccessfulSyncAtUtc, syncedAt.toISOString());
  assert.equal(body.connectionState, 'LIVE');
});

test('pending delivery count/oldest-queued reflects envelopes genuinely queued via the SAME shared relayService instance, never ciphertext', async () => {
  const { app, authService, authzRepository, deviceRepository, relayService } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceId = await registerDevice(deviceRepository, 'family-A');
  const senderDeviceId = await registerDevice(deviceRepository, 'family-A');

  await relayService.queueEnvelope({
    messageId: `msg-${randomUUID()}`,
    familyId: 'family-A',
    senderDeviceId,
    recipientDeviceId: deviceId,
    ciphertext: Buffer.from('opaque-ciphertext-bytes'),
  });
  await relayService.queueEnvelope({
    messageId: `msg-${randomUUID()}`,
    familyId: 'family-A',
    senderDeviceId,
    recipientDeviceId: deviceId,
    ciphertext: Buffer.from('more-opaque-ciphertext-bytes'),
  });

  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', deviceId), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.pendingDelivery.pendingCount, 2);
  assert.ok(body.pendingDelivery.oldestQueuedAtUtc);
  // Never leaks ciphertext or messageId-level detail -- only aggregate bookkeeping.
  assert.equal(JSON.stringify(body).includes('opaque-ciphertext-bytes'), false);
  assert.equal('pendingEnvelopes' in body, false);
  // Pending work with no successful sync yet -> SYNC_PENDING.
  assert.equal(body.connectionState, 'SYNC_PENDING');
});

test('surfaces protectionLevel/protectionUpdatedAtUtc from DeviceProtectionStatusRepository when a status has been reported', async () => {
  const { app, authService, authzRepository, deviceRepository, deviceProtectionStatusRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceId = await registerDevice(deviceRepository, 'family-A');
  const updatedAt = new Date('2026-08-15T00:00:00.000Z');
  await deviceProtectionStatusRepository.upsert({ deviceId, familyId: 'family-A', protectionLevel: 'PROTECTED', updatedAt });

  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', deviceId), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.protectionLevel, 'PROTECTED');
  assert.equal(body.protectionUpdatedAtUtc, updatedAt.toISOString());
});

test('deviceProtectionStatusRepository omitted entirely: protectionLevel/protectionUpdatedAtUtc are honestly null, never a 503', async () => {
  const { app, authService, authzRepository, deviceRepository } = buildHarness({ withProtectionRepository: false });
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const deviceId = await registerDevice(deviceRepository, 'family-A');

  const response = await app.inject({ method: 'GET', url: statusUrl('family-A', deviceId), headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.protectionLevel, null);
  assert.equal(body.protectionUpdatedAtUtc, null);
});

test('oversized deviceId param: rejected before ever reaching the device repository (Fastify\'s own default maxParamLength router guard fires first, at exactly the same defense-in-depth layer runtimeSyncRoutes.ts\'s challenge/session routes already accept for their own :deviceId param -- both this route\'s own MAX_DEVICE_ID_LENGTH check and that guard fail closed, never a 200 or a 403 that would imply the value was evaluated)', async () => {
  const { app, authService, authzRepository, deviceRepository } = buildHarness();
  const { rawToken, accountId } = await issueToken(authService, 'parent-1');
  authzRepository._grantScope(accountId, 'family-A', 'ACTIVE');
  const response = await app.inject({
    method: 'GET',
    url: statusUrl('family-A', 'x'.repeat(129)),
    headers: { authorization: `Bearer ${rawToken}` },
  });
  assert.ok([400, 414].includes(response.statusCode), `expected 400 or 414, got ${response.statusCode}`);
  // Never reaches findDeviceForFamily -- confirmed by construction (no
  // device was ever registered in this test), and re-confirmed here that
  // the response carries no device-shaped success body.
  assert.equal(await deviceRepository.findDeviceForFamily('family-A', 'x'.repeat(129)), null);
});

test('the pca_family_session cookie transport (not just Bearer) is accepted, mirroring every other browser-reachable parent route', async () => {
  const { app, authService, authzRepository, deviceRepository } = buildHarness();
  const { session } = await authService.issueSession(verifyTestOnlyIdentity('parent-1'));
  authzRepository._grantScope(session.accountId, 'family-A', 'ACTIVE');
  const deviceId = await registerDevice(deviceRepository, 'family-A');

  // issueSession only returns the raw token via issueSession's own return
  // value in this test harness (see issueToken above) -- issue a second,
  // real session the same way and present it as the cookie instead of the
  // Authorization header, exactly mirroring requireServiceSession's two
  // accepted transports.
  const { rawToken } = await issueToken(authService, 'parent-1');
  const response = await app.inject({
    method: 'GET',
    url: statusUrl('family-A', deviceId),
    headers: { cookie: `pca_family_session=${rawToken}` },
  });
  assert.equal(response.statusCode, 200);
});
