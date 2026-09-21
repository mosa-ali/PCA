// The registration boundary intentionally stops before family genesis.
// PCA-DEC-020-R1 requires a separate, client-held DSK ceremony; email
// verification and a service session must never manufacture cryptographic
// authority. The complete atomic genesis ceremony is covered by
// security/genesisTransaction.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';

const FIXED_NOW = new Date('2026-08-15T00:00:00Z');
const EMAIL = 'e2e-owner@example.com';
const PASSWORD = 'a genuinely long password';

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }

  async sendVerificationCode(email, code) {
    this.sent.push({ email, code });
  }
  async sendLoginStepUpCode(email, code) {
    this.sent.push({ email, code });
  }

  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

test('E2E: register -> verify-email establishes identity only; genesis remains a separate DSK ceremony', async () => {
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, () => FIXED_NOW);
  const authzRepository = createInMemoryAuthzRepository();
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
    grantFamilyScope: (serviceAccountId, familyId) => authzRepository._grantScope(serviceAccountId, familyId, 'ACTIVE'),
  });
  const emailSender = new RecordingEmailSender();
  const parentAccountService = new ParentAccountService({
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

  const code = emailSender.lastCodeFor(EMAIL);
  assert.ok(code, 'a verification code must have been sent');
  const verifyResponse = await app.inject({
    method: 'POST',
    url: '/api/parent/verify-email',
    payload: { email: EMAIL, code },
  });
  assert.equal(verifyResponse.statusCode, 200);
  const verifyBody = verifyResponse.json();
  assert.equal(verifyBody.sessionEstablished, true);
  assert.equal(verifyBody.familyId, null);

  const rawSessionCookie = verifyResponse.cookies.find((cookie) => cookie.name === 'pca_family_session');
  assert.ok(rawSessionCookie, 'identity verification must still establish the approved service session');
});
