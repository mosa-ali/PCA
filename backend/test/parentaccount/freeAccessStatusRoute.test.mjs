// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- HTTP-level tests for the
// new GET /api/parent/free-access-status route added additively to
// parentAccountRoutes.ts. No real MySQL needed: a deterministic in-memory
// FreeAccessAccountRepository fake stands in, mirroring
// test/parentaccount/routes.test.mjs's own in-memory-repository discipline.
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
    this.sent.push({ email, code });
  }
  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

/** Deterministic in-memory fake -- keyed on the SAME accountId the in-memory ParentAccountRepository produces. */
function createInMemoryFreeAccessAccountRepository(parentAccountRepository) {
  return {
    async findByAccountId(accountId) {
      const account = await parentAccountRepository.findById(accountId);
      if (!account) return null;
      return { accountId: account.accountId, status: account.status, disabledAt: account.disabledAt, freeAccess: account.freeAccess };
    },
  };
}

function buildApp({ withFreeAccessRepository = true } = {}) {
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository);
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new RecordingEmailSender();
  const parentAccountService = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender });

  const app = Fastify();
  registerParentAccountRoutes(app, {
    parentAccountService,
    freeAccessAccountRepository: withFreeAccessRepository ? createInMemoryFreeAccessAccountRepository(parentAccountRepository) : undefined,
  });
  return { app, emailSender };
}

async function registerAndVerify(app, emailSender, email) {
  const password = 'a genuinely long password';
  await app.inject({ method: 'POST', url: '/api/parent/register', payload: { email, password, passwordConfirmation: password } });
  const code = emailSender.lastCodeFor(email);
  const verifyResponse = await app.inject({ method: 'POST', url: '/api/parent/verify-email', payload: { email, code } });
  const setCookie = verifyResponse.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const sessionCookie = cookies.find((c) => c.startsWith('pca_family_session='));
  return sessionCookie.split(';')[0];
}

test('GET /api/parent/free-access-status: 401 with no session cookie at all', async () => {
  const { app } = buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/parent/free-access-status' });
  assert.equal(response.statusCode, 401);
});

test('GET /api/parent/free-access-status: 401 with a garbage/unrecognized session cookie', async () => {
  const { app } = buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/parent/free-access-status', headers: { cookie: 'pca_family_session=not-a-real-token' } });
  assert.equal(response.statusCode, 401);
});

test('GET /api/parent/free-access-status: 200 with the derived FreeAccessStatus for a verified account', async () => {
  const { app, emailSender } = buildApp();
  const email = 'free-access-status@example.com';
  const cookie = await registerAndVerify(app, emailSender, email);

  const response = await app.inject({ method: 'GET', url: '/api/parent/free-access-status', headers: { cookie } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(['TIME_LIMITED', 'PERPETUAL'].includes(body.mode));
  assert.ok(['ACTIVE', 'PERPETUAL', 'EXPIRED'].includes(body.status));
  assert.equal(typeof body.grantedAt, 'string');
});

test('GET /api/parent/free-access-status: server clock, never a client-supplied value, decides the result -- passing a bogus query/header changes nothing', async () => {
  const { app, emailSender } = buildApp();
  const email = 'free-access-clock@example.com';
  const cookie = await registerAndVerify(app, emailSender, email);

  const response = await app.inject({
    method: 'GET',
    url: '/api/parent/free-access-status?remainingDays=99999&status=EXPIRED',
    headers: { cookie, 'x-client-clock': '2099-01-01T00:00:00.000Z' },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.notEqual(body.status, 'EXPIRED', 'a freshly-verified account is never EXPIRED regardless of client-supplied hints');
});

test('GET /api/parent/free-access-status: fails closed (503, never a crash or a wrong 200) when the repository dependency has not been wired yet', async () => {
  const { app, emailSender } = buildApp({ withFreeAccessRepository: false });
  const email = 'free-access-unwired@example.com';
  const cookie = await registerAndVerify(app, emailSender, email);

  const response = await app.inject({ method: 'GET', url: '/api/parent/free-access-status', headers: { cookie } });
  assert.equal(response.statusCode, 503);
});
