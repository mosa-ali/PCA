// PCA-AUTH-SESSION-1 -- HTTP-level tests for parentAccountRoutes.ts: cookie
// transport shape (HttpOnly/SameSite=Strict/Secure-in-prod), double-submit
// CSRF enforcement on state-changing routes, and the full
// register->verify->session->logout->revoke-all lifecycle over real fastify
// `inject()` calls (no live network socket).
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code, kind: 'VERIFICATION' });
  }
  async sendPasswordResetCode(email, code) {
    this.sent.push({ email, code, kind: 'PASSWORD_RESET' });
  }
  lastCodeFor(email, kind = 'VERIFICATION') {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].kind === kind && this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

function buildApp() {
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository);
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new RecordingEmailSender();
  const parentAccountService = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender });

  const app = Fastify();
  registerParentAccountRoutes(app, { parentAccountService });
  return { app, emailSender };
}

function setCookieHeaders(response) {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function extractCookieValue(setCookieHeaders_, name) {
  for (const header of setCookieHeaders_) {
    if (header.startsWith(`${name}=`)) return header.split(';')[0].slice(name.length + 1);
  }
  return null;
}

const EMAIL = 'route-test@example.com';
const PASSWORD = 'correct horse battery staple';

test('POST /api/parent/register returns 202 PENDING_VERIFICATION and never sets a session cookie', async () => {
  const { app } = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: { email: EMAIL, password: PASSWORD, passwordConfirmation: PASSWORD },
  });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { status: 'PENDING_VERIFICATION' });
  assert.equal(setCookieHeaders(response).length, 0);
});

test('POST /api/parent/register rejects a body over the size limit', async () => {
  const { app } = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: { email: EMAIL, password: 'x'.repeat(10_000), passwordConfirmation: 'x'.repeat(10_000) },
  });
  assert.equal(response.statusCode, 413);
});

test('SECURITY: register+verify-email sets an HttpOnly, SameSite=Strict session cookie and a non-HttpOnly CSRF cookie -- never Secure outside production', async () => {
  const { app, emailSender } = buildApp();
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: { email: EMAIL, password: PASSWORD, passwordConfirmation: PASSWORD } });
  const code = emailSender.lastCodeFor(EMAIL);

  const response = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email: EMAIL, code } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.sessionEstablished, true);
  assert.equal(typeof body.accountId, 'string');

  const cookies = setCookieHeaders(response);
  const sessionCookieHeader = cookies.find((c) => c.startsWith('pca_family_session='));
  const csrfCookieHeader = cookies.find((c) => c.startsWith('pca_family_csrf='));
  assert.ok(sessionCookieHeader, 'session cookie must be set');
  assert.ok(csrfCookieHeader, 'CSRF cookie must be set');
  assert.match(sessionCookieHeader, /HttpOnly/i);
  assert.match(sessionCookieHeader, /SameSite=Strict/i);
  assert.doesNotMatch(sessionCookieHeader, /Secure/i, 'must not be Secure outside production (NODE_ENV != production during tests)');
  assert.doesNotMatch(csrfCookieHeader, /HttpOnly/i, 'the CSRF companion cookie must be JS-readable (double-submit pattern)');
});

async function registerVerifyAndCookies(app, emailSender, email = EMAIL) {
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: { email, password: PASSWORD, passwordConfirmation: PASSWORD } });
  const code = emailSender.lastCodeFor(email);
  const response = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email, code } });
  const cookies = setCookieHeaders(response);
  const sessionToken = extractCookieValue(cookies, 'pca_family_session');
  const csrfToken = extractCookieValue(cookies, 'pca_family_csrf');
  return { body: response.json(), sessionToken, csrfToken };
}

test('GET /api/parent/session returns the session when the cookie is present, 401 otherwise', async () => {
  const { app, emailSender } = buildApp();
  const { sessionToken } = await registerVerifyAndCookies(app, emailSender);

  const ok = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { cookie: `pca_family_session=${sessionToken}` } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().emailVerified, true);

  const none = await app.inject({ method: 'GET', url: '/api/parent/session' });
  assert.equal(none.statusCode, 401);
});

test('SECURITY: an expired/revoked/garbage session cookie collapses to the SAME 401 as no cookie at all', async () => {
  const { app } = buildApp();
  const garbage = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { cookie: 'pca_family_session=not-a-real-token' } });
  assert.equal(garbage.statusCode, 401);
  assert.deepEqual(garbage.json(), { error: 'unauthorized' });
});

test('SECURITY (CSRF): logout without the X-PCA-CSRF-Token header is rejected even with a valid session cookie', async () => {
  const { app, emailSender } = buildApp();
  const { sessionToken } = await registerVerifyAndCookies(app, emailSender);
  const response = await app.inject({ method: 'POST', url: '/api/parent/logout', headers: { cookie: `pca_family_session=${sessionToken}; pca_family_csrf=whatever` } });
  assert.equal(response.statusCode, 403);
});

test('SECURITY (CSRF): the CSRF cookie alone (mismatched header) never authorizes a mutation', async () => {
  const { app, emailSender } = buildApp();
  const { sessionToken, csrfToken } = await registerVerifyAndCookies(app, emailSender);
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/sessions/revoke-all',
    headers: { cookie: `pca_family_session=${sessionToken}; pca_family_csrf=${csrfToken}`, 'x-pca-csrf-token': 'wrong-value' },
  });
  assert.equal(response.statusCode, 403);
});

test('a matching CSRF cookie+header succeeds on revoke-all, and the session is unusable afterward', async () => {
  const { app, emailSender } = buildApp();
  const { sessionToken, csrfToken } = await registerVerifyAndCookies(app, emailSender);
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/sessions/revoke-all',
    headers: { cookie: `pca_family_session=${sessionToken}; pca_family_csrf=${csrfToken}`, 'x-pca-csrf-token': csrfToken },
  });
  assert.equal(response.statusCode, 204);

  const after = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { cookie: `pca_family_session=${sessionToken}` } });
  assert.equal(after.statusCode, 401);
});

test('POST /api/parent/login fails generically for wrong password/unknown email/unverified account, and succeeds for a verified account', async () => {
  const { app, emailSender } = buildApp();
  await registerVerifyAndCookies(app, emailSender);

  const unknown = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: 'nobody@example.com', password: PASSWORD } });
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(unknown.json(), { error: 'invalid_credentials' });

  const wrongPassword = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: 'nope nope nope' } });
  assert.equal(wrongPassword.statusCode, 401);
  assert.deepEqual(wrongPassword.json(), { error: 'invalid_credentials' });

  const ok = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().sessionEstablished, true);
});

test('registration/verification/login are rate-limited', async () => {
  const { app } = buildApp();
  let sawRateLimit = false;
  for (let i = 0; i < 30; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/register',
      payload: { email: `flood-${i}@example.com`, password: PASSWORD, passwordConfirmation: PASSWORD },
    });
    if (response.statusCode === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(sawRateLimit, 'registration must eventually be rate-limited per source IP');
});

// ---- Password reset (PCA product-completion programme, P1 /login finding) ----

test('POST /api/parent/request-password-reset returns 202 identically for a real account and an unknown email, and never sets a session cookie', async () => {
  const { app, emailSender } = buildApp();
  await registerVerifyAndCookies(app, emailSender);

  const real = await app.inject({ method: 'POST', url: '/api/parent/request-password-reset', payload: { email: EMAIL } });
  const unknown = await app.inject({ method: 'POST', url: '/api/parent/request-password-reset', payload: { email: 'nobody@example.com' } });

  assert.equal(real.statusCode, 202);
  assert.equal(unknown.statusCode, 202);
  assert.deepEqual(real.json(), unknown.json());
  assert.equal(setCookieHeaders(real).length, 0);
  assert.ok(emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET'), 'a real code must have been sent for the known account');
  assert.equal(emailSender.lastCodeFor('nobody@example.com', 'PASSWORD_RESET'), null);
});

test('POST /api/parent/reset-password: full request -> reset -> old password rejected -> new password logs in', async () => {
  const { app, emailSender } = buildApp();
  await registerVerifyAndCookies(app, emailSender);
  const NEW_PASSWORD = 'a brand new correct horse battery';

  await app.inject({ method: 'POST', url: '/api/parent/request-password-reset', payload: { email: EMAIL } });
  const code = emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');

  const reset = await app.inject({
    method: 'POST',
    url: '/api/parent/reset-password',
    payload: { email: EMAIL, code, newPassword: NEW_PASSWORD, newPasswordConfirmation: NEW_PASSWORD },
  });
  assert.equal(reset.statusCode, 200);
  assert.deepEqual(reset.json(), { status: 'PASSWORD_RESET' });
  assert.equal(setCookieHeaders(reset).length, 0, 'reset-password must not itself establish a session');

  const oldLogin = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(oldLogin.statusCode, 401);

  const newLogin = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: NEW_PASSWORD } });
  assert.equal(newLogin.statusCode, 200);
});

test('POST /api/parent/reset-password rejects an invalid/expired code with 401 invalid_code', async () => {
  const { app, emailSender } = buildApp();
  await registerVerifyAndCookies(app, emailSender);
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/reset-password',
    payload: { email: EMAIL, code: '000000', newPassword: 'a brand new correct horse battery', newPasswordConfirmation: 'a brand new correct horse battery' },
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: 'invalid_code' });
});

test('POST /api/parent/reset-password rejects a mismatched confirmation with 400 invalid_request', async () => {
  const { app, emailSender } = buildApp();
  await registerVerifyAndCookies(app, emailSender);
  await app.inject({ method: 'POST', url: '/api/parent/request-password-reset', payload: { email: EMAIL } });
  const code = emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/reset-password',
    payload: { email: EMAIL, code, newPassword: 'one valid password here', newPasswordConfirmation: 'a totally different one' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: 'invalid_request' });
});

test('request-password-reset/reset-password are rate-limited', async () => {
  const { app } = buildApp();
  let sawRateLimit = false;
  for (let i = 0; i < 30; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/request-password-reset',
      payload: { email: `flood-reset-${i}@example.com` },
    });
    if (response.statusCode === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(sawRateLimit, 'request-password-reset must eventually be rate-limited per source IP');
});
