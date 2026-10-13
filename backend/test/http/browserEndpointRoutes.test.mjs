import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { registerBrowserEndpointRoutes } from '../../dist/http/routes/browserEndpointRoutes.js';
import { registerPairingRoutes } from '../../dist/http/routes/pairingRoutes.js';
import { BrowserEndpointService } from '../../dist/device/BrowserEndpointService.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { createInMemoryDeviceRepository } from '../support/inMemoryDeviceRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';

function key() {
  return randomBytes(32).toString('base64url');
}

const FAMILY = 'family-browser-http-1';
const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

function assertPrivateNoStore(response) {
  assert.equal(response.headers['cache-control'], 'private, no-store');
}

function buildAuthService(validAccountsByToken) {
  return {
    async validateSession(rawToken) {
      const accountId = validAccountsByToken.get(rawToken);
      if (!accountId) throw Object.assign(new Error('unauthorized'), { name: 'AuthError' });
      return accountId;
    },
  };
}

function buildApp({ withService = true, roles = { [ACCOUNT_A]: 'ADMINISTRATOR', [ACCOUNT_B]: 'ADMINISTRATOR' } } = {}) {
  const deviceRepository = createInMemoryDeviceRepository();
  const authzRepository = createInMemoryAuthzRepository();
  authzRepository._grantScope(ACCOUNT_A, FAMILY, 'ACTIVE');
  authzRepository._grantScope(ACCOUNT_B, FAMILY, 'ACTIVE');
  const authzService = new AuthzService(authzRepository);
  const tokens = new Map([
    ['token-a', ACCOUNT_A],
    ['token-b', ACCOUNT_B],
  ]);
  const authService = buildAuthService(tokens);
  const parentAccountService = {
    async consumeSensitiveStepUp(accountId, familyId, operation, token) {
      return familyId === FAMILY &&
        operation === 'family.security.settings.change' &&
        token === `valid-step-up-${accountId === ACCOUNT_A ? 'a' : 'b'}`;
    },
  };
  const familyMembershipRepository = {
    async findActiveRoleByServiceAccountId(accountId, familyId) {
      return familyId === FAMILY ? roles[accountId] ?? null : null;
    },
  };
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const browserEndpointService = withService ? new BrowserEndpointService(deviceRepository, now) : undefined;
  const pairingService = new PairingService(deviceRepository, now);

  const app = Fastify();
  const rateLimiter = createRateLimiter();
  const authAttemptLimiter = rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'test-auth-attempt' });
  registerBrowserEndpointRoutes(app, { browserEndpointService, authService, authzService, familyMembershipRepository, rateLimiter, authAttemptLimiter });
  registerPairingRoutes(app, { pairingService, authService, authzService, parentAccountService, familyMembershipRepository, rateLimiter, authAttemptLimiter });
  return { app, deviceRepository };
}

async function pairingConfirmBody(app, deviceId, token, stepUpToken) {
  const view = await app.inject({
    method: 'GET', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(view.statusCode, 200);
  return {
    expectedDskFingerprint: view.json().dskFingerprint,
    expectedDekFingerprint: view.json().dekFingerprint,
    ...(stepUpToken === undefined ? {} : { stepUpToken }),
  };
}

test('the route is not registered at all when no browserEndpointService is configured (404, not merely 401)', async () => {
  const { app } = buildApp({ withService: false });
  try {
    const response = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      payload: { dskPublicKey: key() },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('registration without a service session is rejected with 401, never recorded', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      payload: { dskPublicKey: key() },
    });
    assert.equal(response.statusCode, 401);
    assertPrivateNoStore(response);
  } finally {
    await app.close();
  }
});

test('a malformed public key is rejected with 400', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: 'not a real key' },
    });
    assert.equal(response.statusCode, 400);
    assertPrivateNoStore(response);
  } finally {
    await app.close();
  }
});

test('pairing status for an unknown device is not cached', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'GET', url: `/v1/families/${FAMILY}/pairing-requests/missing-device`,
      headers: { authorization: 'Bearer token-a' },
    });
    assert.equal(response.statusCode, 404);
    assertPrivateNoStore(response);
  } finally {
    await app.close();
  }
});

test('a real service-authenticated registration succeeds, records the registering account, and starts PAIRING_PENDING', async () => {
  const { app, deviceRepository } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: key() },
    });
    assert.equal(response.statusCode, 201);
    assertPrivateNoStore(response);
    const body = response.json();
    assert.equal(body.status, 'PAIRING_PENDING');

    const device = await deviceRepository.findDeviceForFamily(FAMILY, body.deviceId);
    assert.equal(device.platform, 'BROWSER');
    assert.equal(device.registeredByAccountId, ACCOUNT_A);
  } finally {
    await app.close();
  }
});

test('end-to-end via real HTTP: the registering account cannot confirm its own endpoint, but a different account can', async () => {
  const { app } = buildApp();
  try {
    const registerResponse = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: key() },
    });
    const { deviceId } = registerResponse.json();

    const selfConfirm = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}/confirm`,
      headers: { authorization: 'Bearer token-a' },
      payload: await pairingConfirmBody(app, deviceId, 'token-a', 'valid-step-up-a'),
    });
    assert.equal(selfConfirm.statusCode, 403);
    assertPrivateNoStore(selfConfirm);
    assert.equal(selfConfirm.json().error, 'self_approval_denied');

    const otherConfirm = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}/confirm`,
      headers: { authorization: 'Bearer token-b' },
      payload: await pairingConfirmBody(app, deviceId, 'token-b', 'valid-step-up-b'),
    });
    assert.equal(otherConfirm.statusCode, 200);
    assertPrivateNoStore(otherConfirm);
    assert.equal(otherConfirm.json().status, 'PAIRED');
  } finally {
    await app.close();
  }
});

test('pairing confirmation requires a fresh sensitive-action TOTP grant before state changes', async () => {
  const { app } = buildApp();
  try {
    const registered = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: key() },
    });
    const { deviceId } = registered.json();

    const missingStepUp = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}/confirm`,
      headers: { authorization: 'Bearer token-b' },
      payload: await pairingConfirmBody(app, deviceId, 'token-b'),
    });
    assert.equal(missingStepUp.statusCode, 403);
    assertPrivateNoStore(missingStepUp);
    assert.deepEqual(missingStepUp.json(), { error: 'step_up_required' });

    const stillPending = await app.inject({
      method: 'GET', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}`,
      headers: { authorization: 'Bearer token-b' },
    });
    assert.equal(stillPending.json().status, 'PAIRING_PENDING');
    assertPrivateNoStore(stillPending);
  } finally {
    await app.close();
  }
});

test('pairing confirmation rejects absent fingerprint expectations without changing lifecycle state', async () => {
  const { app } = buildApp();
  try {
    const registered = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: key() },
    });
    const { deviceId } = registered.json();
    const rejected = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}/confirm`,
      headers: { authorization: 'Bearer token-b' },
      payload: { stepUpToken: 'valid-step-up-b' },
    });
    assert.equal(rejected.statusCode, 400);
    assertPrivateNoStore(rejected);
    assert.deepEqual(rejected.json(), { error: 'invalid_request' });
    const view = await app.inject({
      method: 'GET', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}`,
      headers: { authorization: 'Bearer token-b' },
    });
    assert.equal(view.json().status, 'PAIRING_PENDING');
  } finally {
    await app.close();
  }
});

test('family membership roles: VIEWER can read pairing status but cannot register or confirm a browser endpoint', async () => {
  const { app } = buildApp({ roles: { [ACCOUNT_A]: 'VIEWER', [ACCOUNT_B]: 'ADMINISTRATOR' } });
  try {
    const deniedRegistration = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: key() },
    });
    assert.equal(deniedRegistration.statusCode, 403);
    assertPrivateNoStore(deniedRegistration);

    const registered = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-b' },
      payload: { dskPublicKey: key() },
    });
    assert.equal(registered.statusCode, 201);
    const { deviceId } = registered.json();

    const readable = await app.inject({
      method: 'GET', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}`,
      headers: { authorization: 'Bearer token-a' },
    });
    assert.equal(readable.statusCode, 200);
    assertPrivateNoStore(readable);

    const deniedConfirmation = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}/confirm`,
      headers: { authorization: 'Bearer token-a' },
    });
    assert.equal(deniedConfirmation.statusCode, 403);
    assertPrivateNoStore(deniedConfirmation);
    assert.equal(deniedConfirmation.json().error, 'forbidden');
  } finally {
    await app.close();
  }
});

test('registering the same public key twice is rejected with 409, never a duplicate device', async () => {
  const { app } = buildApp();
  try {
    const sharedKey = key();
    const first = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-a' },
      payload: { dskPublicKey: sharedKey },
    });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/browser-endpoints`,
      headers: { authorization: 'Bearer token-b' },
      payload: { dskPublicKey: sharedKey },
    });
    assert.equal(second.statusCode, 409);
    assertPrivateNoStore(second);
  } finally {
    await app.close();
  }
});
