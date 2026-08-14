process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'cd'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { createRequirePlatformAdminSession } from '../../dist/platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { createInMemoryPlatformAdminAuthRepository } from '../support/inMemoryPlatformAdminAuthRepository.mjs';
import { createInMemoryPlatformAdminAlertPort } from '../support/inMemoryPlatformAdminAlertPort.mjs';

async function buildHarness() {
  const repository = createInMemoryPlatformAdminAuthRepository();
  const authService = new PlatformAdminAuthService(repository, createInMemoryPlatformAdminAlertPort());
  const accountService = new PlatformAdminAccountService(repository);
  const app = Fastify({ logger: false });
  app.get('/protected', { preHandler: createRequirePlatformAdminSession(authService) }, async (request) => ({
    adminId: request.platformAdminId,
    roles: request.platformAdminRoles,
  }));

  const email = `plugin-${randomUUID()}@example.test`;
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('Plugin Test', hashAdminEmail(email), password, 'APP_OWNER', 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, loadMfaEncryptionKey());
  repository._setMfaStateForTest(account.adminId, { status: 'ACTIVE', totpSecretCiphertext: ciphertext, totpSecretNonce: nonce, activatedAt: new Date(), createdAt: new Date() });
  const code = computeTotp(secret, Date.now());
  const { rawToken } = await authService.login(email, password, code);
  return { app, authService, rawToken, adminId: account.adminId };
}

test('missing Authorization header is rejected with generic 401', async () => {
  const { app } = await buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
});

test('malformed Authorization header (no Bearer prefix) rejected the same way', async () => {
  const { app } = await buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: 'Basic abc123' } });
  assert.equal(response.statusCode, 401);
});

test('oversized Authorization header rejected without reaching token validation', async () => {
  const { app } = await buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: 'Bearer ' + 'A'.repeat(10_000) } });
  assert.equal(response.statusCode, 401);
});

test('unknown token rejected with generic 401', async () => {
  const { app } = await buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer pa_${'A'.repeat(43)}` } });
  assert.equal(response.statusCode, 401);
});

test('valid Platform Administration session is accepted and identity attached to the request', async () => {
  const { app, rawToken, adminId } = await buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.adminId, adminId);
  assert.ok(body.roles.includes('APP_OWNER'));
});

test('revoked token is rejected with generic 401', async () => {
  const { app, authService, rawToken } = await buildHarness();
  await authService.logout(rawToken);
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 401);
});

test('raw token never appears in the 401 response body', async () => {
  const { app } = await buildHarness();
  const token = `pa_${'A'.repeat(43)}`;
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.payload.includes(token), false);
});
