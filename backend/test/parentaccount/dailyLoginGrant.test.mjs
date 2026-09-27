// Legacy daily-login grants and emailed login step-up codes are not factors in
// the completed Parent login policy. Grants may remain in storage for cleanup,
// but cannot change the email + password / active-TOTP contract.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';

const EMAIL = 'daily-login@example.test';
const PASSWORD = 'correct horse battery staple';

function buildHarness() {
  const clock = createTestClock();
  const authRepository = createInMemoryAuthRepository();
  const repository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new TestSandboxEmailSender();
  const authService = new AuthService(authRepository, clock.now);
  const kit = createParentAccountTestKit({ repository, authService, emailSender, now: clock.now });
  return { ...kit, clock, repository, emailSender };
}

async function registerAndVerify(h) {
  await h.service.register(EMAIL, PASSWORD, PASSWORD);
  await h.service.verifyEmail(EMAIL, h.emailSender.lastCodeFor(EMAIL));
}

test('first sign-in establishes browser trust and the MFA grace window; an unrecognized legacy grant cannot bypass email step-up', async () => {
  const h = buildHarness();
  await registerAndVerify(h);
  const first = await h.service.login(EMAIL, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal(first.mfa.status, 'GRACE');
  assert.equal(first.mfa.graceExpiresAt.getTime(), h.clock.ms() + PARENT_MFA_GRACE_MS);
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'LOGIN_STEP_UP').length, 0);
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'FIRST_LOGIN').length, 1);
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'LOGIN_SUCCESSFUL').length, 0);

  // A well-shaped but unknown legacy token is not trusted and requires email OTP.
  const withLegacyGrant = await h.service.login(EMAIL, PASSWORD, 'A'.repeat(43));
  assert.equal(withLegacyGrant.status, 'STEP_UP_REQUIRED');
  const steppedUp = await h.service.completeLoginStepUp(EMAIL, h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP'));
  assert.equal(steppedUp.status, 'AUTHENTICATED');
  assert.equal(steppedUp.familyId, first.familyId);
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'LOGIN_SUCCESSFUL').length, 1);
});

test('legacy grants and email OTP cannot replace an enrolled TOTP factor', async () => {
  const h = buildHarness();
  await registerAndVerify(h);
  const session = await h.service.login(EMAIL, PASSWORD);
  const credential = { kind: 'SESSION', rawSessionToken: session.rawSessionToken };
  const started = await h.service.beginMfaEnrollment(credential, EMAIL, PASSWORD);
  await h.service.confirmMfaEnrollment(credential, EMAIL, totpFor(started.secretBase32, h.clock.ms()));
  h.clock.advance(30_000);

  assert.equal((await h.service.login(EMAIL, PASSWORD, 'A'.repeat(43))).status, 'STEP_UP_REQUIRED');
  const emailCode = h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP');
  assert.deepEqual(await h.service.completeLoginStepUp(EMAIL, emailCode), { status: 'MFA_REQUIRED' });
  assert.equal((await h.service.completeLoginStepUp(EMAIL, emailCode, totpFor(started.secretBase32, h.clock.ms()))).status, 'AUTHENTICATED');
});
