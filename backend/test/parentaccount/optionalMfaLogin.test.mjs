import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';

const EMAIL = 'parent-browser-auth@example.test';
const PASSWORD = 'correct horse battery staple';
const TOTP_STEP_MS = 30_000;

function harness() {
  const clock = createTestClock();
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, clock.now);
  const repository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new TestSandboxEmailSender();
  const kit = createParentAccountTestKit({ repository, authService, emailSender, now: clock.now });
  return { ...kit, clock, authRepository, repository, emailSender };
}

async function registerAndVerify(h) {
  await h.service.register(EMAIL, PASSWORD, PASSWORD, { accountType: 'PARENT_GUARDIAN', estimatedChildCount: 1 });
  await h.service.verifyEmail(EMAIL, h.emailSender.lastCodeFor(EMAIL));
}

test('first login automatically trusts browser; known browser skips OTP, unknown browser uses email OTP during grace', async () => {
  const h = harness();
  await registerAndVerify(h);

  const first = await h.service.login(EMAIL, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal(typeof first.rawDailyLoginGrantToken, 'string');
  assert.equal(first.mfa.status, 'GRACE');
  assert.equal(first.mfa.graceExpiresAt.getTime(), h.clock.ms() + PARENT_MFA_GRACE_MS);

  const known = await h.service.login(EMAIL, PASSWORD, first.rawDailyLoginGrantToken);
  assert.equal(known.status, 'AUTHENTICATED');
  assert.equal(known.familyId, first.familyId);

  const unknown = await h.service.login(EMAIL, PASSWORD);
  assert.deepEqual(unknown, { status: 'STEP_UP_REQUIRED' });
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'LOGIN_STEP_UP').length, 1);
  const stepUp = await h.service.completeLoginStepUp(EMAIL, h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP'));
  assert.equal(stepUp.status, 'AUTHENTICATED');
  assert.equal(typeof stepUp.rawDailyLoginGrantToken, 'string');
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'FIRST_LOGIN').length, 1);
  assert.equal(h.emailSender.kindsFor(EMAIL).filter((kind) => kind === 'LOGIN_SUCCESSFUL').length, 2);
  assert.equal(h.mfaRepository._events.filter((event) => event.eventType === 'PARENT_LOGIN_SUCCESS').length, 3);
});

test('expired grace requires TOTP enrollment; active MFA remains known-browser password-only and unknown-browser email OTP plus TOTP', async () => {
  const h = harness();
  await registerAndVerify(h);
  const first = await h.service.login(EMAIL, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');

  h.clock.advance(PARENT_MFA_GRACE_MS);
  assert.equal((await h.service.login(EMAIL, PASSWORD, first.rawDailyLoginGrantToken)).status, 'STEP_UP_REQUIRED', 'expired browser grant is treated as unknown');
  const expired = await h.service.completeLoginStepUp(EMAIL, h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP'));
  assert.equal(expired.status, 'MFA_SETUP_REQUIRED');
  const enrollmentCredential = { kind: 'TICKET', rawTicket: expired.rawEnrollmentTicket };
  const setup = await h.service.beginMfaEnrollment(enrollmentCredential, EMAIL, PASSWORD);
  h.clock.advance(TOTP_STEP_MS);
  const enrolled = await h.service.confirmMfaEnrollment(enrollmentCredential, EMAIL, totpFor(setup.secretBase32, h.clock.ms()));
  assert.equal(enrolled.status, 'ENROLLED_SESSION_ESTABLISHED');
  assert.equal(typeof enrolled.rawDailyLoginGrantToken, 'string');

  h.clock.advance(TOTP_STEP_MS);
  const known = await h.service.login(EMAIL, PASSWORD, enrolled.rawDailyLoginGrantToken);
  assert.equal(known.status, 'AUTHENTICATED');
  const unknown = await h.service.login(EMAIL, PASSWORD);
  assert.equal(unknown.status, 'STEP_UP_REQUIRED');
  const totp = totpFor(setup.secretBase32, h.clock.ms());
  const verified = await h.service.completeLoginStepUp(EMAIL, h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP'), totp);
  assert.equal(verified.status, 'AUTHENTICATED');
});

test('an invalid email OTP cannot consume the valid TOTP counter for an unknown-browser login', async () => {
  const h = harness();
  await registerAndVerify(h);
  const first = await h.service.login(EMAIL, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');

  h.clock.advance(PARENT_MFA_GRACE_MS);
  const expired = await h.service.login(EMAIL, PASSWORD, first.rawDailyLoginGrantToken);
  assert.equal(expired.status, 'STEP_UP_REQUIRED');
  const setupRequired = await h.service.completeLoginStepUp(EMAIL, h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP'));
  assert.equal(setupRequired.status, 'MFA_SETUP_REQUIRED');

  const ticket = { kind: 'TICKET', rawTicket: setupRequired.rawEnrollmentTicket };
  const setup = await h.service.beginMfaEnrollment(ticket, EMAIL, PASSWORD);
  h.clock.advance(TOTP_STEP_MS);
  const enrolled = await h.service.confirmMfaEnrollment(ticket, EMAIL, totpFor(setup.secretBase32, h.clock.ms()));
  assert.equal(enrolled.status, 'ENROLLED_SESSION_ESTABLISHED');

  h.clock.advance(TOTP_STEP_MS);
  const unknown = await h.service.login(EMAIL, PASSWORD);
  assert.equal(unknown.status, 'STEP_UP_REQUIRED');
  const emailCode = h.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP');
  const wrongEmailCode = emailCode === '000000' ? '000001' : '000000';
  const totp = totpFor(setup.secretBase32, h.clock.ms());

  await assert.rejects(h.service.completeLoginStepUp(EMAIL, wrongEmailCode, totp));
  const result = await h.service.completeLoginStepUp(EMAIL, emailCode, totp);
  assert.equal(result.status, 'AUTHENTICATED');
});
