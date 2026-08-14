process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ef'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { createRequireServiceSession } from '../../dist/auth/fastifyAuthPlugin.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { createRequirePlatformAdminSession } from '../../dist/platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { createInMemoryPlatformAdminAuthRepository } from '../support/inMemoryPlatformAdminAuthRepository.mjs';
import { createInMemoryPlatformAdminAlertPort } from '../support/inMemoryPlatformAdminAlertPort.mjs';

/**
 * PCA-ADD-PA-002/010: proves a Platform Administration session token is
 * structurally rejected by the EXISTING family-plane requireServiceSession
 * preHandler, and a family-plane service_sessions token is structurally
 * rejected by the NEW requirePlatformAdminSession preHandler -- both
 * routes registered on the SAME Fastify app, mirroring
 * test/auth/fastifyAuthPlugin.test.mjs's/test/platformadmin's own
 * single-app-instance harness pattern rather than requiring a full
 * backend/test/server.test.mjs-style server spin-up.
 */
async function buildCrossRealmHarness() {
  const familyAuthService = new AuthService(createInMemoryAuthRepository());
  const platformAdminRepository = createInMemoryPlatformAdminAuthRepository();
  const platformAdminAuthService = new PlatformAdminAuthService(platformAdminRepository, createInMemoryPlatformAdminAlertPort());
  const platformAdminAccountService = new PlatformAdminAccountService(platformAdminRepository);

  const app = Fastify({ logger: false });
  app.get('/family-protected', { preHandler: createRequireServiceSession(familyAuthService) }, async (request) => ({ accountId: request.accountId }));
  app.get(
    '/platform-admin-protected',
    { preHandler: createRequirePlatformAdminSession(platformAdminAuthService) },
    async (request) => ({ adminId: request.platformAdminId }),
  );

  const { rawToken: familyToken } = await familyAuthService.issueSession(verifyTestOnlyIdentity(`subject-${randomUUID()}`));

  const email = `cross-realm-${randomUUID()}@example.test`;
  const password = 'correct horse battery staple';
  const account = await platformAdminAccountService.createAccount('Cross Realm', hashAdminEmail(email), password, 'APP_OWNER', 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, loadMfaEncryptionKey());
  platformAdminRepository._setMfaStateForTest(account.adminId, { status: 'ACTIVE', totpSecretCiphertext: ciphertext, totpSecretNonce: nonce, activatedAt: new Date(), createdAt: new Date() });
  const code = computeTotp(secret, Date.now());
  const { rawToken: platformAdminToken } = await platformAdminAuthService.login(email, password, code);

  return { app, familyToken, platformAdminToken };
}

test('a Platform Administration session token is rejected by the family-plane requireServiceSession preHandler', async () => {
  const { app, platformAdminToken } = await buildCrossRealmHarness();
  const response = await app.inject({ method: 'GET', url: '/family-protected', headers: { authorization: `Bearer ${platformAdminToken}` } });
  assert.equal(response.statusCode, 401);
});

test('a family-plane service_sessions token is rejected by the new requirePlatformAdminSession preHandler', async () => {
  const { app, familyToken } = await buildCrossRealmHarness();
  const response = await app.inject({ method: 'GET', url: '/platform-admin-protected', headers: { authorization: `Bearer ${familyToken}` } });
  assert.equal(response.statusCode, 401);
});

test('sanity: each token IS accepted by its own plane\'s preHandler', async () => {
  const { app, familyToken, platformAdminToken } = await buildCrossRealmHarness();
  const familyResponse = await app.inject({ method: 'GET', url: '/family-protected', headers: { authorization: `Bearer ${familyToken}` } });
  const platformAdminResponse = await app.inject({ method: 'GET', url: '/platform-admin-protected', headers: { authorization: `Bearer ${platformAdminToken}` } });
  assert.equal(familyResponse.statusCode, 200);
  assert.equal(platformAdminResponse.statusCode, 200);
});
