// PCA-DEC-030 registration boundary: register -> verify-email ACTIVATES the
// account only (no session, no family). The first real sign-in (password +
// emailed step-up code) is what establishes the session, starts the one
// 3-day MFA grace window, and provisions the family server-side with the
// signing-in account as its ADMINISTRATOR. Parent Genesis (the client-held
// device-key ceremony) no longer exists.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit } from '../support/parentMfaTestKit.mjs';

const FIXED_NOW = new Date('2026-08-15T00:00:00Z');
const EMAIL = 'e2e-owner@example.com';
const PASSWORD = 'a genuinely long password';

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }

  async sendVerificationCode(email, code) {
    this.sent.push({ email, code, kind: 'VERIFICATION' });
  }
  async sendLoginStepUpCode(email, code) {
    this.sent.push({ email, code, kind: 'LOGIN_STEP_UP' });
  }
  async sendPasswordResetCode(email, code) {
    this.sent.push({ email, code, kind: 'PASSWORD_RESET' });
  }
  async sendMfaRecoveryCode(email, code) {
    this.sent.push({ email, code, kind: 'MFA_RECOVERY' });
  }
  async sendSecurityNotice(email, notice) {
    this.sent.push({ email, code: null, kind: notice });
  }

  lastCodeFor(email, kind) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email && this.sent[i].kind === kind) return this.sent[i].code;
    }
    return null;
  }

  kindsFor(email) {
    return this.sent.filter((entry) => entry.email === email).map((entry) => entry.kind);
  }
}

test('E2E: register -> verify-email activates only; the first sign-in establishes the session, starts grace and provisions the family as ADMINISTRATOR', async () => {
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, () => FIXED_NOW);
  const authzRepository = createInMemoryAuthzRepository();
  const scopeGrants = [];
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
    grantFamilyScope: (serviceAccountId, familyId) => {
      scopeGrants.push({ serviceAccountId, familyId });
      return authzRepository._grantScope(serviceAccountId, familyId, 'ACTIVE');
    },
  });
  const emailSender = new RecordingEmailSender();
  const { service: parentAccountService } = createParentAccountTestKit({
    repository: parentAccountRepository,
    authService,
    emailSender,
    now: () => FIXED_NOW,
  });

  const app = Fastify({ logger: false });
  registerParentAccountRoutes(app, { parentAccountService });

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/parent/register',
    payload: { email: EMAIL, password: PASSWORD, passwordConfirmation: PASSWORD },
  });
  assert.equal(registerResponse.statusCode, 202, registerResponse.body);

  const code = emailSender.lastCodeFor(EMAIL, 'VERIFICATION');
  assert.ok(code, 'a verification code must have been sent');
  const verifyResponse = await app.inject({
    method: 'POST',
    url: '/api/parent/verify-email',
    payload: { email: EMAIL, code },
  });
  assert.equal(verifyResponse.statusCode, 200);
  assert.deepEqual(verifyResponse.json(), { status: 'VERIFIED', sessionEstablished: false });
  assert.equal(verifyResponse.cookies.length, 0, 'verify-email must not establish a session');
  assert.deepEqual(emailSender.kindsFor(EMAIL), ['VERIFICATION', 'ACCOUNT_ACTIVATED']);
  assert.equal(scopeGrants.length, 0, 'verification never creates a family or grants a family scope');

  const loginResponse = await app.inject({ method: 'POST', url: '/api/parent/login', payload: { email: EMAIL, password: PASSWORD } });
  assert.equal(loginResponse.statusCode, 200);
  assert.deepEqual(loginResponse.json(), { sessionEstablished: false, stepUpRequired: true });
  assert.equal(loginResponse.cookies.length, 0);

  const stepUpResponse = await app.inject({
    method: 'POST',
    url: '/api/parent/login/step-up',
    payload: { email: EMAIL, code: emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP') },
  });
  assert.equal(stepUpResponse.statusCode, 200, stepUpResponse.body);
  const body = stepUpResponse.json();
  assert.equal(body.sessionEstablished, true);
  assert.equal(typeof body.familyId, 'string', 'the family is provisioned server-side at the first sign-in');
  assert.equal(body.role, 'ADMINISTRATOR');
  assert.deepEqual(body.mfa, { status: 'GRACE', graceExpiresAt: new Date(FIXED_NOW.getTime() + PARENT_MFA_GRACE_MS).toISOString() });
  assert.equal(emailSender.kindsFor(EMAIL).filter((kind) => kind === 'FIRST_LOGIN').length, 1, 'exactly one FIRST_LOGIN security notice is sent');
  assert.equal(scopeGrants.length, 1);
  assert.equal(scopeGrants[0].familyId, body.familyId, 'the provisioned family scope is granted to the signing-in service account');

  const sessionCookie = stepUpResponse.cookies.find((cookie) => cookie.name === 'pca_family_session');
  assert.ok(sessionCookie, 'the sign-in establishes the service session');

  const sessionResponse = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { cookie: `pca_family_session=${sessionCookie.value}` } });
  assert.equal(sessionResponse.statusCode, 200);
  const session = sessionResponse.json();
  assert.equal(session.familyId, body.familyId);
  assert.equal(session.role, 'ADMINISTRATOR');
  assert.equal('genesisAvailable' in session, false, 'Genesis is gone: no genesisAvailable flag');
});
