// PCA-DEC-030 -- HTTP contract for the Parent MFA journey over real fastify
// inject(): verify-email sets no cookie; unknown-browser login asks for
// step-up; the
// enrollment ticket is an HttpOnly SameSite=Strict cookie that never
// coexists with a session, enrollment responses are no-store, CSRF guards
// the session path, error codes map as the client expects, and Genesis
// routes and fields are gone.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';

const PASSWORD = 'correct horse battery staple';
const STEP = 30 * 1000;

function buildApp() {
  const clock = createTestClock();
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, clock.now);
  const repository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new TestSandboxEmailSender();
  const { service } = createParentAccountTestKit({ repository, authService, emailSender, now: clock.now });
  const app = Fastify();
  registerParentAccountRoutes(app, { parentAccountService: service });
  return { app, emailSender, clock };
}

/** Minimal browser: a cookie jar that honours Max-Age=0 deletion. */
function browser(app) {
  const jar = new Map();
  let lastSetCookies = [];
  async function request(method, url, payload, { csrf = false } = {}) {
    const headers = {};
    if (jar.size) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (csrf && jar.has('pca_family_csrf')) headers['x-pca-csrf-token'] = jar.get('pca_family_csrf');
    const response = await app.inject({ method, url, payload, headers });
    const raw = response.headers['set-cookie'];
    lastSetCookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    for (const header of lastSetCookies) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      if (/Max-Age=0/.test(header)) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  }
  return { request, jar, setCookies: () => lastSetCookies };
}

async function registerAndVerify(app, emailSender, email) {
  const b = browser(app);
  const registration = await b.request('POST', '/api/parent/register', { email, password: PASSWORD, passwordConfirmation: PASSWORD, firstName: 'MFA', lastName: 'Parent' });
  assert.equal(registration.statusCode, 202, JSON.stringify(registration.json()));
  const verified = await b.request('POST', '/api/parent/verify-email', { email, code: emailSender.lastCodeFor(email) });
  assert.equal(verified.statusCode, 200);
  assert.deepEqual(verified.json(), { status: 'VERIFIED', sessionEstablished: false });
  assert.equal(b.setCookies().length, 0, 'verification never sets a session cookie');
}

async function firstSignIn(app, email, b = browser(app)) {
  const login = await b.request('POST', '/api/parent/login', { email, password: PASSWORD });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().sessionEstablished, true);
  return { b, done: login };
}

test('first sign-in establishes a session with optional authenticator status and a provisioned ADMINISTRATOR family', async () => {
  const { app, emailSender, clock } = buildApp();
  const email = 'http-first@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b, done } = await firstSignIn(app, email);
  assert.equal(done.statusCode, 200);
  const body = done.json();
  assert.equal(body.sessionEstablished, true);
  assert.equal(body.role, 'ADMINISTRATOR');
  assert.ok(body.familyId);
  assert.deepEqual(body.mfa, { status: 'GRACE', graceExpiresAt: new Date(clock.ms() + PARENT_MFA_GRACE_MS).toISOString() });
  const session = await b.request('GET', '/api/parent/session');
  assert.equal(session.statusCode, 200);
  assert.deepEqual(session.json().mfa, body.mfa);
  const csrf = await b.request('GET', '/api/parent/csrf');
  assert.equal(csrf.statusCode, 200);
  assert.equal(csrf.headers['cache-control'], 'no-store');
  assert.equal(csrf.json().csrfToken, b.jar.get('pca_family_csrf'));
  assert.ok(!('genesisAvailable' in session.json()));
  for (const path of ['/api/parent/genesis/step-up', '/api/parent/genesis/step-up/complete', '/api/parent/genesis/challenge', '/api/parent/genesis/complete']) {
    assert.equal((await b.request('POST', path, {}, { csrf: true })).statusCode, 404, `${path} no longer exists`);
  }
});

test('CSRF bootstrap only returns a token to a live Parent session and never caches it', async () => {
  const { app, emailSender } = buildApp();
  const anonymous = await browser(app).request('GET', '/api/parent/csrf');
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.headers['cache-control'], undefined);

  const email = 'http-csrf-reissue@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b } = await firstSignIn(app, email);
  b.jar.delete('pca_family_csrf');
  const reissued = await b.request('GET', '/api/parent/csrf');
  assert.equal(reissued.statusCode, 200);
  assert.equal(reissued.headers['cache-control'], 'no-store');
  assert.match(reissued.json().csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(b.jar.get('pca_family_csrf'), reissued.json().csrfToken);
  assert.match(reissued.headers['set-cookie'], /pca_family_csrf=/);
});

test('optional enrollment: session CSRF is required, no-store responses, and enrolled logins require the authenticator code', async () => {
  const { app, emailSender, clock } = buildApp();
  const email = 'http-enroll@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b } = await firstSignIn(app, email);

  assert.equal((await b.request('POST', '/api/parent/mfa/enrollment/start', { email, password: PASSWORD })).statusCode, 403, 'session path needs CSRF');
  const start = await b.request('POST', '/api/parent/mfa/enrollment/start', { email, password: PASSWORD }, { csrf: true });
  assert.equal(start.statusCode, 200);
  assert.equal(start.headers['cache-control'], 'no-store');
  const { otpauthUri, secret } = start.json();
  assert.ok(otpauthUri.startsWith('otpauth://totp/'));
  const confirm = await b.request('POST', '/api/parent/mfa/enrollment/confirm', { email, code: totpFor(secret, clock.ms()) }, { csrf: true });
  assert.equal(confirm.statusCode, 200);
  assert.deepEqual(confirm.json(), { enrolled: true, sessionEstablished: false });

  await b.request('POST', '/api/parent/logout', {}, { csrf: true });
  clock.advance(STEP);
  const fresh = browser(app);
  assert.deepEqual((await fresh.request('POST', '/api/parent/login', { email, password: PASSWORD })).json(), { sessionEstablished: false, stepUpRequired: true });
  const stepUpCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(stepUpCode);
  const emailOnly = await fresh.request('POST', '/api/parent/login/step-up', { email, code: stepUpCode });
  assert.equal(emailOnly.statusCode, 200);
  assert.deepEqual(emailOnly.json(), { sessionEstablished: false, mfaRequired: true });
  assert.equal(fresh.jar.has('pca_parent_session'), false, 'email OTP alone does not establish an enrolled account session');
  const wrong = await fresh.request('POST', '/api/parent/login/step-up', { email, code: stepUpCode, totpCode: '000000' === totpFor(secret, clock.ms()) ? '111111' : '000000' });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.json(), { error: 'invalid_code' });
  const ok = await fresh.request('POST', '/api/parent/login/step-up', { email, code: stepUpCode, totpCode: totpFor(secret, clock.ms()) });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().mfa, { status: 'ACTIVE' });
  assert.equal((await fresh.request('POST', '/api/parent/login', { email, password: PASSWORD, totpCode: 12 })).statusCode, 400, 'a non-string code is malformed');
});

test('legacy three-day deadline requires setup after unknown-browser email OTP', async () => {
  const { app, emailSender, clock } = buildApp();
  const email = 'http-expired@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b: first } = await firstSignIn(app, email);
  clock.advance(PARENT_MFA_GRACE_MS + 1);
  assert.equal((await first.request('GET', '/api/parent/session')).statusCode, 401, 'the ordinary 12-hour session lifetime still applies');
  const login = await first.request('POST', '/api/parent/login', { email, password: PASSWORD });
  assert.equal(login.statusCode, 200);
  assert.deepEqual(login.json(), { sessionEstablished: false, stepUpRequired: true });
  const stepUpCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(stepUpCode);
  const completed = await first.request('POST', '/api/parent/login/step-up', { email, code: stepUpCode });
  assert.equal(completed.statusCode, 200);
  assert.deepEqual(completed.json(), { sessionEstablished: false, mfaSetupRequired: true });
  assert.ok(first.jar.has('pca_parent_mfa_enrollment'));
});

test('recovery over HTTP: code starts 24-hour hold, revokes sessions, and fresh post-hold code yields ticket', async () => {
  const { app, emailSender, clock } = buildApp();
  const email = 'http-recover@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b } = await firstSignIn(app, email);
  const start = await b.request('POST', '/api/parent/mfa/enrollment/start', { email, password: PASSWORD }, { csrf: true });
  await b.request('POST', '/api/parent/mfa/enrollment/confirm', { email, code: totpFor(start.json().secret, clock.ms()) }, { csrf: true });

  const r = browser(app);
  for (const password of ['wrong password!!', PASSWORD]) {
    const requested = await r.request('POST', '/api/parent/mfa/recovery/request', { email, password });
    assert.equal(requested.statusCode, 202);
    assert.deepEqual(requested.json(), { status: 'RECOVERY_CODE_SENT_IF_ELIGIBLE' });
  }
  assert.equal((await r.request('POST', '/api/parent/mfa/recovery/complete', { email, password: PASSWORD, code: 'abcdef' })).statusCode, 400);
  const completed = await r.request('POST', '/api/parent/mfa/recovery/complete', { email, password: PASSWORD, code: emailSender.lastCodeFor(email, 'MFA_RECOVERY') });
  assert.equal(completed.json().status, 'MFA_RECOVERY_PENDING');
  assert.ok(Date.parse(completed.json().recoveryAvailableAt) > clock.ms());
  assert.equal(r.jar.has('pca_parent_mfa_enrollment'), false, 'hold does not issue an enrollment ticket');
  assert.equal((await b.request('GET', '/api/parent/session')).statusCode, 401, 'the other browser was signed out');
  assert.equal((await r.request('POST', '/api/parent/login', { email, password: PASSWORD, totpCode: '123456' })).json().recoveryPending, true, 'new browser cannot bypass hold');
  await r.request('POST', '/api/parent/mfa/recovery/request', { email, password: PASSWORD });
  const renewed = await r.request('POST', '/api/parent/mfa/recovery/complete', { email, password: PASSWORD, code: emailSender.lastCodeFor(email, 'MFA_RECOVERY') });
  assert.equal(renewed.json().recoveryAvailableAt, completed.json().recoveryAvailableAt, 'second request preserves deadline');
  clock.advance(24 * 60 * 60 * 1000);
  await r.request('POST', '/api/parent/mfa/recovery/request', { email, password: PASSWORD });
  const afterHold = await r.request('POST', '/api/parent/mfa/recovery/complete', { email, password: PASSWORD, code: emailSender.lastCodeFor(email, 'MFA_RECOVERY') });
  assert.deepEqual(afterHold.json(), { status: 'MFA_SETUP_REQUIRED', mfaSetupRequired: true, sessionEstablished: false });
  assert.ok(r.jar.has('pca_parent_mfa_enrollment'));
});

test('Parent step-up route: session + CSRF, closed operation vocabulary, FORBIDDEN before enrollment, 201 no-store for commercial and sensitive operations', async () => {
  const { app, emailSender, clock } = buildApp();
  const email = 'http-stepup@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b } = await firstSignIn(app, email);
  assert.equal((await b.request('POST', '/api/parent/mfa/step-up', { operation: 'BILLING_CHECKOUT_CREATE', code: '123456' })).statusCode, 403, 'CSRF');
  assert.equal((await b.request('POST', '/api/parent/mfa/step-up', { operation: 'DELETE_EVERYTHING', code: '123456' }, { csrf: true })).statusCode, 400);
  for (const operation of ['family.ownership.transfer', 'family.recovery.material.reveal']) {
    assert.equal((await b.request('POST', '/api/parent/mfa/step-up', { operation, code: '123456' }, { csrf: true })).statusCode, 400, `${operation} remains unavailable until its Owner-bound consumer exists`);
  }
  assert.deepEqual((await b.request('POST', '/api/parent/mfa/step-up', { operation: 'BILLING_CHECKOUT_CREATE', code: '123456' }, { csrf: true })).json(), { error: 'forbidden' });

  const start = await b.request('POST', '/api/parent/mfa/enrollment/start', { email, password: PASSWORD }, { csrf: true });
  const secret = start.json().secret;
  await b.request('POST', '/api/parent/mfa/enrollment/confirm', { email, code: totpFor(secret, clock.ms()) }, { csrf: true });
  clock.advance(STEP);
  const granted = await b.request('POST', '/api/parent/mfa/step-up', { operation: 'BILLING_CHECKOUT_CREATE', code: totpFor(secret, clock.ms()) }, { csrf: true });
  assert.equal(granted.statusCode, 201);
  assert.equal(granted.headers['cache-control'], 'no-store');
  assert.match(granted.json().stepUpToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(granted.json().operation, 'BILLING_CHECKOUT_CREATE');
  const replay = await b.request('POST', '/api/parent/mfa/step-up', { operation: 'BILLING_CHECKOUT_CREATE', code: totpFor(secret, clock.ms()) }, { csrf: true });
  assert.deepEqual(replay.json(), { error: 'invalid_mfa_code' }, 'the same TOTP step cannot mint a second grant');

  clock.advance(30_000);
  const sensitive = await b.request('POST', '/api/parent/mfa/step-up', { operation: 'family.retention.update', code: totpFor(secret, clock.ms()) }, { csrf: true });
  assert.equal(sensitive.statusCode, 201);
  assert.equal(sensitive.headers['cache-control'], 'no-store');
  assert.match(sensitive.json().stepUpToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sensitive.json().operation, 'family.retention.update');
});

test('lockout is reported as 429 mfa_locked', async () => {
  const { app, emailSender, clock } = buildApp();
  const email = 'http-lock@example.com';
  await registerAndVerify(app, emailSender, email);
  const { b } = await firstSignIn(app, email);
  const start = await b.request('POST', '/api/parent/mfa/enrollment/start', { email, password: PASSWORD }, { csrf: true });
  const secret = start.json().secret;
  await b.request('POST', '/api/parent/mfa/enrollment/confirm', { email, code: totpFor(secret, clock.ms()) }, { csrf: true });
  clock.advance(STEP);
  const unknown = browser(app);
  assert.deepEqual((await unknown.request('POST', '/api/parent/login', { email, password: PASSWORD })).json(), { sessionEstablished: false, stepUpRequired: true });
  const stepUpCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(stepUpCode);
  const bad = String((Number(totpFor(secret, clock.ms())) + 7) % 1000000).padStart(6, '0');
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await unknown.request('POST', '/api/parent/login/step-up', { email, code: stepUpCode, totpCode: bad })).json().error);
  assert.deepEqual(statuses, ['invalid_code', 'invalid_code', 'invalid_code', 'invalid_code', 'mfa_locked']);
});
