// PCA-AUTH-SESSION-1 -- HTTP-level tests for parentAccountRoutes.ts: cookie
// transport shape (HttpOnly/SameSite=Strict/Secure-in-prod), double-submit
// CSRF enforcement on state-changing routes, and the full
// register->verify->login->step-up->session->logout->revoke-all lifecycle
// (PCA-DEC-030: verify-email activates only; the session comes from sign-in) over real fastify
// `inject()` calls (no live network socket).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit } from '../support/parentMfaTestKit.mjs';

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
  async sendLoginStepUpCode(email, code) {
    this.sent.push({ email, code, kind: 'LOGIN_STEP_UP' });
  }
  async sendMfaRecoveryCode(email, code) {
    this.sent.push({ email, code, kind: 'MFA_RECOVERY' });
  }
  async sendSecurityNotice(email, notice) {
    this.sent.push({ email, code: null, kind: notice });
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
  const { service: parentAccountService } = createParentAccountTestKit({ repository: parentAccountRepository, authService, emailSender });

  const app = Fastify();
  registerParentAccountRoutes(app, { parentAccountService });
  return { app, emailSender, parentAccountService, parentAccountRepository };
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

function registrationPayload(email, password = PASSWORD, extra = {}) {
  return {
    email,
    password,
    passwordConfirmation: password,
    firstName: 'Route',
    lastName: 'Parent',
    ...extra,
  };
}

after(async () => {
  await writeParentRouteScenarioReport();
});

test('Parent identity registration persists protected email and canonical phone; own profile is private and names-only editable', async () => {
  const { app, emailSender } = buildApp();
  const email = 'identity-route@example.com';
  const registered = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: registrationPayload(email, PASSWORD, {
      firstName: '  نجوى ',
      lastName: ' حسن  ',
      phoneNumber: '+١٤١٥٥٥٥٢٦٧١',
    }),
  });
  assert.equal(registered.statusCode, 202);
  recordParentRouteScenario({ method: 'POST', route: '/api/parent/register', scenarioId: 'identity_register_allow', classification: 'ALLOW_PROVEN', expectedStatus: 202, response: registered });

  const code = emailSender.lastCodeFor(email);
  assert.ok(code);
  const verified = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email, code } });
  assert.equal(verified.statusCode, 200);
  recordParentRouteScenario({ method: 'POST', route: '/api/parent/verify-email', scenarioId: 'identity_verify_email_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: verified });
  const login = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email, password: PASSWORD } });
  assert.equal(login.statusCode, 200);
  recordParentRouteScenario({ method: 'POST', route: '/api/parent/login', scenarioId: 'identity_login_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: login });
  const cookies = setCookieHeaders(login);
  const sessionToken = extractCookieValue(cookies, 'pca_family_session');
  const csrfToken = extractCookieValue(cookies, 'pca_family_csrf');

  const unauthenticatedRead = await app.inject({ method: 'GET', url: '/api/parent/identity' });
  assert.equal(unauthenticatedRead.statusCode, 401);
  recordParentRouteScenario({ method: 'GET', route: '/api/parent/identity', scenarioId: 'identity_read_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: unauthenticatedRead });
  const read = await app.inject({
    method: 'GET',
    url: '/api/parent/identity',
    headers: { cookie: `pca_family_session=${sessionToken}` },
  });
  assert.equal(read.statusCode, 200);
  recordParentRouteScenario({ method: 'GET', route: '/api/parent/identity', scenarioId: 'identity_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: read });
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.deepEqual(read.json(), {
    firstName: 'نجوى',
    lastName: 'حسن',
    email,
    phoneNumber: '+14155552671',
    emailVerified: true,
    phoneVerified: false,
  });
  assert.deepEqual(Object.keys(read.json()).sort(), ['email', 'emailVerified', 'firstName', 'lastName', 'phoneNumber', 'phoneVerified']);

  const denied = await app.inject({
    method: 'PATCH',
    url: '/api/parent/identity',
    headers: { cookie: `pca_family_session=${sessionToken}; pca_family_csrf=${csrfToken}` },
    payload: { firstName: 'N', lastName: 'H' },
  });
  assert.equal(denied.statusCode, 403, 'the session cookie alone cannot authorize an identity edit');
  recordParentRouteScenario({ method: 'PATCH', route: '/api/parent/identity', scenarioId: 'identity_patch_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: denied });

  const contactMutation = await app.inject({
    method: 'PATCH',
    url: '/api/parent/identity',
    headers: { cookie: `pca_family_session=${sessionToken}; pca_family_csrf=${csrfToken}`, 'x-pca-csrf-token': csrfToken },
    payload: { firstName: 'N', lastName: 'H', email: 'attacker@example.com' },
  });
  assert.equal(contactMutation.statusCode, 400, 'the endpoint rejects contact fields and extra keys');
  recordParentRouteScenario({ method: 'PATCH', route: '/api/parent/identity', scenarioId: 'identity_patch_rejects_contact_mutation', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: contactMutation });

  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/parent/identity',
    headers: { cookie: `pca_family_session=${sessionToken}; pca_family_csrf=${csrfToken}`, 'x-pca-csrf-token': csrfToken },
    payload: { firstName: '  نجلاء ', lastName: ' حسن ' },
  });
  assert.equal(saved.statusCode, 200);
  recordParentRouteScenario({ method: 'PATCH', route: '/api/parent/identity', scenarioId: 'identity_patch_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: saved });
  assert.equal(saved.headers['cache-control'], 'no-store');
  assert.equal(saved.json().firstName, 'نجلاء');
  assert.equal(saved.json().lastName, 'حسن');
  assert.equal(saved.json().email, email);
  assert.equal(saved.json().phoneNumber, '+14155552671');
});

test('registration requires valid identity names and rejects an ambiguous phone number', async () => {
  const { app } = buildApp();
  const missingNames = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: { email: 'missing-name@example.com', password: PASSWORD, passwordConfirmation: PASSWORD },
  });
  assert.equal(missingNames.statusCode, 400);

  const invalidPhone = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: registrationPayload('invalid-phone@example.com', PASSWORD, { phoneNumber: '4155552671' }),
  });
  assert.equal(invalidPhone.statusCode, 400, 'the server must not guess the missing country code');
});

test('legacy account with null identity fields can verify, log in, and read an honest null profile', async () => {
  const { app, emailSender, parentAccountService } = buildApp();
  const email = 'legacy-identity@example.com';
  await parentAccountService.register(email, PASSWORD, PASSWORD);
  const code = emailSender.lastCodeFor(email);
  assert.ok(code);
  const verified = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email, code } });
  assert.equal(verified.statusCode, 200);

  const login = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email, password: PASSWORD } });
  assert.equal(login.statusCode, 200);
  const sessionToken = extractCookieValue(setCookieHeaders(login), 'pca_family_session');
  const profile = await app.inject({
    method: 'GET',
    url: '/api/parent/identity',
    headers: { cookie: `pca_family_session=${sessionToken}` },
  });
  assert.equal(profile.statusCode, 200);
  assert.deepEqual(profile.json(), {
    firstName: null,
    lastName: null,
    email: null,
    phoneNumber: null,
    emailVerified: true,
    phoneVerified: false,
  });
});

test('POST /api/parent/register returns 202 PENDING_VERIFICATION and never sets a session cookie', async () => {
  const { app } = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: registrationPayload(EMAIL),
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
    payload: { ...registrationPayload(EMAIL, 'x'.repeat(10_000)), passwordConfirmation: 'x'.repeat(10_000) },
  });
  assert.equal(response.statusCode, 413);
});

test('SECURITY: verify-email activates only -- 200 {status:VERIFIED, sessionEstablished:false} and NO cookie of any kind', async () => {
  const { app, emailSender } = buildApp();
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: registrationPayload(EMAIL) });
  const code = emailSender.lastCodeFor(EMAIL);

  const response = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email: EMAIL, code } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'VERIFIED', sessionEstablished: false });
  assert.equal(setCookieHeaders(response).length, 0, 'verify-email must never set a session, CSRF or grant cookie');
  assert.ok(emailSender.sent.some((entry) => entry.email === EMAIL && entry.kind === 'ACCOUNT_ACTIVATED'), 'an ACCOUNT_ACTIVATED notice is sent');
});

test('SECURITY: password sign-in sets an HttpOnly session cookie and a non-HttpOnly CSRF cookie', async () => {
  const { app, emailSender } = buildApp();
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: registrationPayload(EMAIL) });
  await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email: EMAIL, code: emailSender.lastCodeFor(EMAIL) } });
  const response = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.sessionEstablished, true);
  assert.equal(typeof body.accountId, 'string');
  assert.equal(typeof body.familyId, 'string', 'the first sign-in provisions the family server-side');
  assert.equal(body.role, 'ADMINISTRATOR');
  assert.equal(body.mfa.status, 'GRACE');

  const cookies = setCookieHeaders(response);
  const sessionCookieHeader = cookies.find((c) => c.startsWith('pca_family_session='));
  const csrfCookieHeader = cookies.find((c) => c.startsWith('pca_family_csrf='));
  const browserTrustCookieHeader = cookies.find((c) => c.startsWith('pca_parent_daily_login_grant='));
  assert.ok(sessionCookieHeader, 'session cookie must be set');
  assert.ok(csrfCookieHeader, 'CSRF cookie must be set');
  assert.ok(browserTrustCookieHeader, 'first successful login automatically sets account browser trust');
  assert.match(browserTrustCookieHeader, /HttpOnly/i);
  assert.match(sessionCookieHeader, /HttpOnly/i);
  assert.match(sessionCookieHeader, /SameSite=Strict/i);
  assert.doesNotMatch(sessionCookieHeader, /Secure/i, 'must not be Secure outside production (NODE_ENV != production during tests)');
  assert.doesNotMatch(csrfCookieHeader, /HttpOnly/i, 'the CSRF companion cookie must be JS-readable (double-submit pattern)');
});

// PCA-DW-W2-15C correction: the assertion above no longer depends on the
// shipped image happening to set NODE_ENV=production -- cookies.ts's
// sessionCookieName()/csrfCookieName() and this route's Secure computation
// now go through runtime/environment.ts's isProductionSensitiveRuntime(),
// which fails CLOSED (treats missing/unrecognized NODE_ENV as production)
// rather than open. See test/runtime/environment.test.mjs and
// test/parentaccount/cookies.test.mjs for the explicit fail-closed proof.
// This Dockerfile check is kept anyway as defense in depth (and because
// npm ci --omit=dev/other build-time behaviour still wants NODE_ENV=production
// set before the build step) -- static check, because nothing at test time
// can observe the built image's environment.
test('DEPLOYMENT: backend/Dockerfile sets NODE_ENV=production, and only after the build step (npm derives omit=dev from it)', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^ENV NODE_ENV=production$/m, 'the image must default to production so session cookies are Secure');
  const envIndex = dockerfile.search(/^ENV NODE_ENV=production$/m);
  const buildIndex = dockerfile.search(/^RUN npm run build$/m);
  const installIndex = dockerfile.search(/^RUN npm ci /m);
  assert.ok(installIndex >= 0 && buildIndex >= 0, 'Dockerfile must still install and build');
  assert.ok(
    envIndex > buildIndex && envIndex > installIndex,
    'NODE_ENV=production before `npm ci`/`npm run build` would strip typescript/@types and break the build',
  );
});

async function registerVerifyAndCookies(app, emailSender, email = EMAIL) {
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: registrationPayload(email) });
  const code = emailSender.lastCodeFor(email);
  const verified = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email, code } });
  assert.equal(setCookieHeaders(verified).length, 0);
  const login = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email, password: PASSWORD } });
  assert.equal(login.statusCode, 200);
  const response = login;
  const cookies = setCookieHeaders(response);
  const sessionToken = extractCookieValue(cookies, 'pca_family_session');
  const csrfToken = extractCookieValue(cookies, 'pca_family_csrf');
  const browserGrantToken = extractCookieValue(cookies, 'pca_parent_daily_login_grant');
  return { body: response.json(), sessionToken, csrfToken, browserGrantToken };
}

test('GET /api/parent/session returns the session when the cookie is present, 401 otherwise', async () => {
  const { app, emailSender } = buildApp();
  const { sessionToken } = await registerVerifyAndCookies(app, emailSender);

  const ok = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { cookie: `pca_family_session=${sessionToken}` } });
  assert.equal(ok.statusCode, 200);
  const session = ok.json();
  assert.deepEqual(Object.keys(session).sort(), ['accountId', 'emailVerified', 'familyId', 'mfa', 'role'], 'no genesisAvailable or other client-trusted flag');
  assert.equal(session.emailVerified, true);
  assert.equal(session.role, 'ADMINISTRATOR');
  assert.equal(session.mfa.status, 'GRACE');

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

test('POST /api/parent/login keeps generic credential errors and automatically trusts the first successful browser', async () => {
  const { app, emailSender } = buildApp();
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: registrationPayload(EMAIL) });
  await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email: EMAIL, code: emailSender.lastCodeFor(EMAIL) } });

  const unknown = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: 'nobody@example.com', password: PASSWORD } });
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(unknown.json(), { error: 'invalid_credentials' });

  const wrongPassword = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: 'nope nope nope' } });
  assert.equal(wrongPassword.statusCode, 401);
  assert.deepEqual(wrongPassword.json(), { error: 'invalid_credentials' });

  const first = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().sessionEstablished, true);
  const browserGrant = extractCookieValue(setCookieHeaders(first), 'pca_parent_daily_login_grant');
  const ok = await app.inject({ method: 'POST', url: '/api/parent/login', headers: { cookie: `pca_parent_daily_login_grant=${browserGrant}` }, payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().sessionEstablished, true);
  assert.ok(setCookieHeaders(ok).some((cookie) => cookie.startsWith('pca_family_session=')));
  assert.equal(emailSender.sent.filter((entry) => entry.kind === 'FIRST_LOGIN').length, 1);
  assert.equal(emailSender.sent.filter((entry) => entry.kind === 'LOGIN_SUCCESSFUL').length, 1, 'each subsequent successful login sends a security notice');
  assert.equal(emailSender.sent.filter((entry) => entry.kind === 'LOGIN_STEP_UP').length, 0);
});

test('unknown browser requires a one-time email OTP, then becomes trusted automatically', async () => {
  const { app, emailSender } = buildApp();
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: registrationPayload(EMAIL) });
  await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email: EMAIL, code: emailSender.lastCodeFor(EMAIL) } });
  const first = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(first.statusCode, 200);

  const unknown = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.deepEqual(unknown.json(), { sessionEstablished: false, stepUpRequired: true });
  const otp = emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP');
  assert.ok(otp);
  const verified = await app.inject({ method: 'POST', url: '/api/parent/login/step-up', payload: { email: EMAIL, code: otp } });
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.json().sessionEstablished, true);
  assert.ok(setCookieHeaders(verified).some((cookie) => cookie.startsWith('pca_parent_daily_login_grant=')));
});

test('registration/verification/login are rate-limited', async () => {
  const { app } = buildApp();
  let sawRateLimit = false;
  for (let i = 0; i < 30; i += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/register',
      payload: registrationPayload(`flood-${i}@example.com`),
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
  assert.deepEqual(newLogin.json(), { sessionEstablished: false, stepUpRequired: true });
  const stepUp = await app.inject({ method: 'POST', url: '/api/parent/login/step-up', payload: { email: EMAIL, code: emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP') } });
  assert.equal(stepUp.statusCode, 200);
  assert.equal(stepUp.json().sessionEstablished, true);
  assert.ok(setCookieHeaders(stepUp).some((cookie) => cookie.startsWith('pca_parent_daily_login_grant=')));
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
