import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { createRequireServiceSession } from '../../dist/auth/fastifyAuthPlugin.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

function buildHarness() {
  const authService = new AuthService(createInMemoryAuthRepository());
  const app = Fastify({ logger: false });
  app.get('/protected', { preHandler: createRequireServiceSession(authService) }, async (request) => ({
    accountId: request.accountId,
  }));
  app.post('/mutating', { preHandler: createRequireServiceSession(authService) }, async (request) => ({
    accountId: request.accountId,
  }));
  return { app, authService };
}

test('missing Authorization header is rejected with generic 401', async () => {
  const { app } = buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
});

test('malformed Authorization header (no Bearer prefix) rejected with the SAME generic 401', async () => {
  const { app } = buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: 'Basic abc123' } });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'unauthorized' });
});

test('oversized Authorization header rejected without ever reaching token validation', async () => {
  const { app } = buildHarness();
  const response = await app.inject({
    method: 'GET',
    url: '/protected',
    headers: { authorization: 'Bearer ' + 'A'.repeat(10_000) },
  });
  assert.equal(response.statusCode, 401);
});

test('unknown token rejected with generic 401', async () => {
  const { app } = buildHarness();
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${'A'.repeat(43)}` } });
  assert.equal(response.statusCode, 401);
});

test('valid session token is accepted and the account id is attached to the request', async () => {
  const { app, authService } = buildHarness();
  const { rawToken, session } = await authService.issueSession(verifyTestOnlyIdentity('subject-1'));
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${rawToken}` } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { accountId: session.accountId });
});

test('family session cookie authenticates reads, while cookie-authenticated mutations require the matching CSRF cookie and header', async () => {
  const { app, authService } = buildHarness();
  const { rawToken, session } = await authService.issueSession(verifyTestOnlyIdentity('subject-cookie'));
  const csrfToken = 'csrf-test-token';
  const cookie = `pca_family_session=${rawToken}; pca_family_csrf=${csrfToken}`;

  const read = await app.inject({ method: 'GET', url: '/protected', headers: { cookie } });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json(), { accountId: session.accountId });

  const missingCsrf = await app.inject({ method: 'POST', url: '/mutating', headers: { cookie } });
  assert.equal(missingCsrf.statusCode, 403);
  assert.deepEqual(missingCsrf.json(), { error: 'csrf_mismatch' });

  const mutation = await app.inject({
    method: 'POST',
    url: '/mutating',
    headers: { cookie, 'x-pca-csrf-token': csrfToken },
  });
  assert.equal(mutation.statusCode, 200);
  assert.deepEqual(mutation.json(), { accountId: session.accountId });
});

test('revoked token is rejected with generic 401, indistinguishable from an unknown token', async () => {
  const { app, authService } = buildHarness();
  const { rawToken } = await authService.issueSession(verifyTestOnlyIdentity('subject-1'));
  await authService.revokeSession(rawToken);
  const revokedResponse = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${rawToken}` } });
  const unknownResponse = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${'B'.repeat(43)}` } });
  assert.equal(revokedResponse.statusCode, 401);
  assert.deepEqual(revokedResponse.json(), unknownResponse.json());
});

test('raw token never appears in the 401 response body', async () => {
  const { app } = buildHarness();
  const secretLookingToken = 'A'.repeat(43);
  const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer ${secretLookingToken}` } });
  assert.equal(response.payload.includes(secretLookingToken), false);
});
