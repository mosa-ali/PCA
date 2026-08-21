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

function buildAuthService(validAccountsByToken) {
  return {
    async validateSession(rawToken) {
      const accountId = validAccountsByToken.get(rawToken);
      if (!accountId) throw Object.assign(new Error('unauthorized'), { name: 'AuthError' });
      return accountId;
    },
  };
}

function buildApp({ withService = true } = {}) {
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
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const browserEndpointService = withService ? new BrowserEndpointService(deviceRepository, now) : undefined;
  const pairingService = new PairingService(deviceRepository, now);

  const app = Fastify();
  const rateLimiter = createRateLimiter();
  const authAttemptLimiter = rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'test-auth-attempt' });
  registerBrowserEndpointRoutes(app, { browserEndpointService, authService, authzService, rateLimiter, authAttemptLimiter });
  registerPairingRoutes(app, { pairingService, authService, authzService, rateLimiter, authAttemptLimiter });
  return { app, deviceRepository };
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
    });
    assert.equal(selfConfirm.statusCode, 403);
    assert.equal(selfConfirm.json().error, 'self_approval_denied');

    const otherConfirm = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/pairing-requests/${deviceId}/confirm`,
      headers: { authorization: 'Bearer token-b' },
    });
    assert.equal(otherConfirm.statusCode, 200);
    assert.equal(otherConfirm.json().status, 'PAIRED');
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
  } finally {
    await app.close();
  }
});
