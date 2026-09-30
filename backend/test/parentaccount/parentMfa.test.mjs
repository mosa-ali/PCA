// Parent account journey after Genesis removal:
// register -> verify -> password login (family provisioned)
// -> authenticator enrollment -> TOTP on every explicit login, plus
// lockout, recovery, notifications, secret hygiene and the ADMINISTRATOR +
// fresh-TOTP commercial step-up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { PARENT_MFA_GRACE_MS, PARENT_MFA_RECOVERY_HOLD_MS, PARENT_PASSWORD_FAILURE_POLICY } from '../../dist/parentaccount/policy.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';

const PASSWORD = 'correct horse battery staple';
const HOUR = 60 * 60 * 1000;
const STEP = 30 * 1000;

function harness() {
  const clock = createTestClock();
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, clock.now);
  const repository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new TestSandboxEmailSender();
  const kit = createParentAccountTestKit({ repository, authService, emailSender, now: clock.now });
  return { ...kit, clock, authService, authRepository, repository, emailSender };
}

async function registerAndVerify(h, email) {
  await h.service.register(email, PASSWORD, PASSWORD, { accountType: 'PARENT_GUARDIAN', estimatedChildCount: 1 });
  const outcome = await h.service.verifyEmail(email, h.emailSender.lastCodeFor(email));
  assert.deepEqual(outcome, { status: 'VERIFIED' });
}

/** Email + password directly authenticate accounts without an active TOTP. */
async function loginWithEmailCode(h, email, legacyDailyGrant) {
  return h.service.login(email, PASSWORD, legacyDailyGrant);
}

/** Enrolls via the given credential and returns the base32 secret the authenticator app would hold. */
async function enroll(h, email, credential) {
  const started = await h.service.beginMfaEnrollment(credential, email, PASSWORD);
  assert.match(started.otpauthUri, /^otpauth:\/\/totp\/PCA%20Parent%3A/);
  assert.match(started.otpauthUri, /issuer=PCA%20Parent/);
  assert.ok(started.otpauthUri.includes(`secret=${started.secretBase32}`));
  const outcome = await h.service.confirmMfaEnrollment(credential, email, totpFor(started.secretBase32, h.clock.ms()));
  return { secret: started.secretBase32, outcome };
}

async function enrolledAccount(h, email) {
  await registerAndVerify(h, email);
  const session = await loginWithEmailCode(h, email);
  const { secret, outcome } = await enroll(h, email, { kind: 'SESSION', rawSessionToken: session.rawSessionToken });
  h.clock.advance(STEP);
  return { secret, session: { ...session, rawDailyLoginGrantToken: outcome.rawDailyLoginGrantToken } };
}

test('verification activates the account only: no session, no family, ACCOUNT_ACTIVATED notice', async () => {
  const h = harness();
  const email = 'verify@example.com';
  await registerAndVerify(h, email);
  const account = await h.repository.findByEmailHash((await import('../../dist/parentaccount/emailHash.js')).hashParentEmail(email));
  assert.equal(account.status, 'VERIFIED');
  assert.equal(account.familyId, null);
  assert.equal(await h.mfaRepository.findState(account.accountId), null, 'grace must not start at verification');
  assert.deepEqual(h.emailSender.kindsFor(email), ['VERIFICATION', 'ACCOUNT_ACTIVATED']);
});

test('first login starts the one-time MFA deadline, provisions Administrator, and sends one security notice per login', async () => {
  const h = harness();
  const email = 'first@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.ok(first.familyId);
  assert.equal(first.role, 'ADMINISTRATOR');
  assert.equal(first.mfa.status, 'GRACE');

  h.clock.advance(HOUR);
  const second = await loginWithEmailCode(h, email, first.rawDailyLoginGrantToken);
  assert.equal(second.familyId, first.familyId, 'a second login never creates a second family');
  assert.equal(second.mfa.status, 'GRACE');
  assert.equal(h.emailSender.kindsFor(email).filter((kind) => kind === 'FIRST_LOGIN').length, 1);
  assert.equal(h.emailSender.kindsFor(email).filter((kind) => kind === 'LOGIN_SUCCESSFUL').length, 1);
  const events = h.mfaRepository._events.map((event) => event.eventType);
  assert.equal(events.filter((type) => type === 'PARENT_LOGIN_SUCCESS').length, 2);
  assert.equal(events.filter((type) => type === 'FAMILY_PROVISIONED').length, 1);
});

test('known-browser login cannot restart the deadline and expired MFA posture requires setup', async () => {
  const h = harness();
  const email = 'cap@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  h.clock.advance(PARENT_MFA_GRACE_MS - 2 * HOUR);
  assert.equal((await loginWithEmailCode(h, email, first.rawDailyLoginGrantToken)).status, 'STEP_UP_REQUIRED', 'the 24-hour browser grant has expired');
  const late = await h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'));
  assert.equal(late.status, 'AUTHENTICATED');
  assert.equal(late.mfa.graceExpiresAt.getTime(), first.mfa.graceExpiresAt.getTime());
  h.clock.advance(2 * HOUR + 1);
  const expired = await h.service.login(email, PASSWORD, late.rawDailyLoginGrantToken);
  assert.equal(expired.status, 'MFA_SETUP_REQUIRED');
});

test('Parent session is usable during grace and cannot be read after its session expiry', async () => {
  const h = harness();
  const email = 'grace@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  const session = await h.service.readSession(first.rawSessionToken);
  assert.equal(session.mfa.status, 'GRACE');
  h.clock.advance(12 * HOUR + 1);
  await assert.rejects(h.service.readSession(first.rawSessionToken), (error) => error.code === 'UNAUTHORIZED');
});

test('after three days, a trusted browser receives mandatory TOTP setup rather than a Parent session', async () => {
  const h = harness();
  const email = 'expired@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  h.clock.advance(PARENT_MFA_GRACE_MS + 1);
  assert.equal((await h.service.login(email, PASSWORD, first.rawDailyLoginGrantToken)).status, 'STEP_UP_REQUIRED');
  const afterDeadline = await h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'));
  assert.equal(afterDeadline.status, 'MFA_SETUP_REQUIRED');
  const credential = { kind: 'TICKET', rawTicket: afterDeadline.rawEnrollmentTicket };
  const { outcome } = await enroll(h, email, credential);
  assert.equal(outcome.status, 'ENROLLED_SESSION_ESTABLISHED');
  assert.equal(outcome.mfa.status, 'ACTIVE');
});

test('enrollment: wrong password or wrong email is refused; wrong code keeps the account unenrolled; success notifies and revokes browser grants', async () => {
  const h = harness();
  const email = 'enroll@example.com';
  await registerAndVerify(h, email);
  const session = await loginWithEmailCode(h, email);
  const credential = { kind: 'SESSION', rawSessionToken: session.rawSessionToken };
  await assert.rejects(h.service.beginMfaEnrollment(credential, email, 'wrong password!!'), (error) => error.code === 'UNAUTHORIZED');
  await assert.rejects(h.service.beginMfaEnrollment(credential, 'someone-else@example.com', PASSWORD), (error) => error.code === 'UNAUTHORIZED');
  const started = await h.service.beginMfaEnrollment(credential, email, PASSWORD);
  const wrong = totpFor(started.secretBase32, h.clock.ms()) === '000000' ? '111111' : '000000';
  await assert.rejects(h.service.confirmMfaEnrollment(credential, email, wrong), (error) => error.code === 'MFA_INVALID');
  assert.equal((await h.service.readSession(session.rawSessionToken)).mfa.status, 'GRACE');
  const confirmed = await h.service.confirmMfaEnrollment(credential, email, totpFor(started.secretBase32, h.clock.ms()));
  assert.equal(confirmed.status, 'ENROLLED');
  assert.equal(typeof confirmed.rawDailyLoginGrantToken, 'string');
  assert.equal((await h.service.readSession(session.rawSessionToken)).mfa.status, 'ACTIVE', 'the enrolling session is kept');
  assert.ok(h.emailSender.kindsFor(email).includes('MFA_ENROLLED'));
  h.clock.advance(STEP);
  assert.equal((await h.service.login(email, PASSWORD, confirmed.rawDailyLoginGrantToken)).status, 'AUTHENTICATED', 'the enrolling browser is automatically re-trusted');
  await assert.rejects(h.service.beginMfaEnrollment(credential, email, PASSWORD), (error) => error.code === 'UNAUTHORIZED', 'an ACTIVE factor is replaced only through recovery');
});

test('known browser uses password only; unknown browser requires email OTP plus active TOTP with replay protection', async () => {
  const h = harness();
  const email = 'every@example.com';
  const { secret, session } = await enrolledAccount(h, email);
  const known = await h.service.login(email, PASSWORD, session.rawDailyLoginGrantToken);
  assert.equal(known.status, 'AUTHENTICATED');
  assert.equal(known.mfa.status, 'ACTIVE');
  await assert.rejects(h.service.login(email, 'wrong password!!', session.rawDailyLoginGrantToken), (error) => error.code === 'UNAUTHORIZED', 'browser trust never rescues a wrong password');

  const unknown = await h.service.login(email, PASSWORD);
  assert.equal(unknown.status, 'STEP_UP_REQUIRED');
  const emailCode = h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(emailCode);
  assert.deepEqual(await h.service.completeLoginStepUp(email, emailCode), { status: 'MFA_REQUIRED' }, 'active TOTP is required in addition to email OTP');
  const code = totpFor(secret, h.clock.ms());
  const signedIn = await h.service.completeLoginStepUp(email, emailCode, code);
  assert.equal(signedIn.status, 'AUTHENTICATED');
  assert.equal(signedIn.mfa.status, 'ACTIVE');
  await assert.rejects(h.service.completeLoginStepUp(email, emailCode, code), (error) => error.code === 'UNAUTHORIZED', 'the email OTP cannot be replayed');

  // Logout revokes this session; the original trust token remains a separate
  // account-bound login assurance credential until expiry or revocation.
  await h.service.logout(signedIn.rawSessionToken);
  await assert.rejects(h.service.readSession(signedIn.rawSessionToken), (error) => error.code === 'UNAUTHORIZED');
});

test('TOTP lockout: 5 wrong codes lock the factor for 15 minutes, even against a correct code', async () => {
  const h = harness();
  const email = 'lock@example.com';
  const { secret } = await enrolledAccount(h, email);
  const wrong = (offset) => String((Number(totpFor(secret, h.clock.ms())) + 500000 + offset) % 1000000).padStart(6, '0');
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await h.service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
    await assert.rejects(h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'), wrong(i)), (error) => error.code === 'MFA_INVALID');
  }
  assert.equal((await h.service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  await assert.rejects(h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'), wrong(9)), (error) => error.code === 'MFA_LOCKED');
  assert.equal((await h.service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  await assert.rejects(h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'), totpFor(secret, h.clock.ms())), (error) => error.code === 'MFA_LOCKED');
  h.clock.advance(15 * 60 * 1000 + STEP);
  assert.equal((await h.service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  assert.equal((await h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'), totpFor(secret, h.clock.ms()))).status, 'AUTHENTICATED');
  const types = h.mfaRepository._events.map((event) => event.eventType);
  assert.ok(types.includes('MFA_LOCKED'));
});

test('recovery: valid password and email code immediately revoke old authority and permit replacement TOTP enrollment', async () => {
  const h = harness();
  const email = 'recover@example.com';
  const { secret, session } = await enrolledAccount(h, email);
  const otherBrowser = await h.service.login(email, PASSWORD, session.rawDailyLoginGrantToken);
  h.clock.advance(STEP);
  const commercialGrant = await h.service.issueCommercialStepUp(session.rawSessionToken, 'BILLING_CHECKOUT_CREATE', totpFor(secret, h.clock.ms()));
  h.clock.advance(STEP);

  await h.service.requestMfaRecovery(email, 'wrong password!!');
  await h.service.requestMfaRecovery('nobody@example.com', PASSWORD);
  assert.equal(h.emailSender.lastCodeFor(email, 'MFA_RECOVERY'), null, 'nothing is sent without the right password');
  await h.service.requestMfaRecovery(email, PASSWORD);
  const code = h.emailSender.lastCodeFor(email, 'MFA_RECOVERY');
  assert.match(code, /^\d{6}$/);

  await assert.rejects(h.service.completeMfaRecovery(email, 'wrong password!!', code), (error) => error.code === 'UNAUTHORIZED');
  const wrongCode = code === '000000' ? '111111' : '000000';
  await assert.rejects(h.service.completeMfaRecovery(email, PASSWORD, wrongCode), (error) => error.code === 'UNAUTHORIZED');
  assert.equal(PARENT_MFA_RECOVERY_HOLD_MS, 0, 'owner policy removes the waiting period');
  const completed = await h.service.completeMfaRecovery(email, PASSWORD, code);
  assert.equal(completed.status, 'MFA_SETUP_REQUIRED');
  assert.equal('recoveryAvailableAt' in completed, false, 'recovery no longer exposes a hold deadline');
  await assert.rejects(h.service.completeMfaRecovery(email, PASSWORD, code), (error) => error.code === 'UNAUTHORIZED', 'a recovery code is single-use');

  for (const token of [session.rawSessionToken, otherBrowser.rawSessionToken]) {
    await assert.rejects(h.service.readSession(token), (error) => error.code === 'UNAUTHORIZED', 'every existing session is signed out');
  }
  assert.equal((await h.commercialOwnerAuthority.authorize((await h.repository.findById(session.accountId)).serviceAccountId, session.familyId, 'BILLING_CHECKOUT_CREATE', commercialGrant.stepUpToken)), 'STEP_UP_REQUIRED', 'sensitive commercial operations are denied during recovery');
  const otherDeviceLogin = await h.service.login(email, PASSWORD, session.rawDailyLoginGrantToken);
  assert.equal(otherDeviceLogin.status, 'STEP_UP_REQUIRED', 'the old trusted-browser grant no longer authorizes login');
  assert.ok(h.emailSender.kindsFor(email).includes('MFA_RESET'), 'a recovery security notice is sent immediately');
  assert.equal((await h.mfaRepository.findState(session.accountId)).status, 'NOT_ENROLLED', 'the old factor is disabled before replacement setup');

  const { secret: newSecret, outcome } = await enroll(h, email, { kind: 'TICKET', rawTicket: completed.rawEnrollmentTicket });
  assert.equal(outcome.status, 'ENROLLED_SESSION_ESTABLISHED', 'the recovering browser keeps a session');
  assert.notEqual(newSecret, secret);
  h.clock.advance(STEP);
  assert.equal((await h.service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  await assert.rejects(h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'), totpFor(secret, h.clock.ms())), (error) => error.code === 'MFA_INVALID', 'the lost authenticator is revoked');
  assert.equal((await h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'), totpFor(newSecret, h.clock.ms()))).status, 'AUTHENTICATED');
  for (const token of [session.rawSessionToken, otherBrowser.rawSessionToken]) await assert.rejects(h.service.readSession(token), (error) => error.code === 'UNAUTHORIZED', 'old sessions stay revoked after enrollment');
});

test('recovery code is short-lived, single-use and attempt-limited', async () => {
  const expired = harness();
  const email = 'expired-recovery@example.com';
  await enrolledAccount(expired, email);
  await expired.service.requestMfaRecovery(email, PASSWORD);
  const expiredCode = expired.emailSender.lastCodeFor(email, 'MFA_RECOVERY');
  expired.clock.advance(15 * 60 * 1000);
  await assert.rejects(expired.service.completeMfaRecovery(email, PASSWORD, expiredCode), (error) => error.code === 'UNAUTHORIZED');

  const attempts = harness();
  const attemptsEmail = 'attempts-recovery@example.com';
  await enrolledAccount(attempts, attemptsEmail);
  await attempts.service.requestMfaRecovery(attemptsEmail, PASSWORD);
  const validCode = attempts.emailSender.lastCodeFor(attemptsEmail, 'MFA_RECOVERY');
  const wrong = validCode === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 8; attempt += 1) await assert.rejects(attempts.service.completeMfaRecovery(attemptsEmail, PASSWORD, wrong), (error) => error.code === 'UNAUTHORIZED');
  await assert.rejects(attempts.service.completeMfaRecovery(attemptsEmail, PASSWORD, validCode), (error) => error.code === 'UNAUTHORIZED', 'the eighth wrong attempt exhausts this code');
});

test('password login locks on five account failures in 15 minutes and expires after one hour', async () => {
  const h = harness();
  const email = 'password-lock@example.com';
  await registerAndVerify(h, email);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(h.service.login(email, `wrong password ${attempt}`), (error) => error.code === 'UNAUTHORIZED');
  }
  await assert.rejects(h.service.login(email, 'wrong password fifth'), (error) => error.code === 'UNAUTHORIZED', 'fifth failure stays a generic denial');
  await assert.rejects(h.service.login(email, PASSWORD), (error) => error.code === 'PASSWORD_LOGIN_LOCKED', 'correct password cannot bypass an active lock');
  await assert.rejects(h.service.login(email, 'still wrong'), (error) => error.code === 'UNAUTHORIZED', 'wrong password stays generic during the lock');
  const account = await h.repository.findByEmailHash(hashParentEmail(email));
  assert.equal(account.passwordFailedAttemptCount, 5);
  assert.equal(account.passwordLoginLockedUntil.getTime(), h.clock.ms() + PARENT_PASSWORD_FAILURE_POLICY.lockMs);
  h.clock.advance(PARENT_PASSWORD_FAILURE_POLICY.lockMs);
  assert.equal((await h.service.login(email, PASSWORD)).status, 'AUTHENTICATED', 'login is available after the one-hour lock expires');
});

test('password failures use a rolling window and a successful password auth clears the sequence', async () => {
  const h = harness();
  const email = 'password-window@example.com';
  await registerAndVerify(h, email);
  for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(h.service.login(email, 'wrong password'), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await h.service.login(email, PASSWORD)).status, 'AUTHENTICATED', 'correct password before threshold is accepted');
  for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(h.service.login(email, 'wrong password'), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await h.service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED', 'correct password clears the four-failure sequence');

  const other = harness();
  const otherEmail = 'password-rolling-window@example.com';
  await registerAndVerify(other, otherEmail);
  for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(other.service.login(otherEmail, 'wrong password'), (error) => error.code === 'UNAUTHORIZED');
  other.clock.advance(PARENT_PASSWORD_FAILURE_POLICY.windowMs);
  for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(other.service.login(otherEmail, 'wrong password'), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await other.service.login(otherEmail, PASSWORD)).status, 'AUTHENTICATED', 'failures outside the rolling window do not accumulate');
});

test('password locks are account-scoped; wrong email OTP, TOTP, and recovery code do not add password failures', async () => {
  const h = harness();
  const emailA = 'password-scope-a@example.com';
  const emailB = 'password-scope-b@example.com';
  await registerAndVerify(h, emailA);
  await registerAndVerify(h, emailB);
  for (let attempt = 0; attempt < 5; attempt += 1) await assert.rejects(h.service.login(emailA, 'wrong password'), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await h.service.login(emailB, PASSWORD)).status, 'AUTHENTICATED', 'account A cannot lock account B');
  await assert.rejects(h.service.login(emailA, PASSWORD), (error) => error.code === 'PASSWORD_LOGIN_LOCKED');

  const mfa = harness();
  const mfaEmail = 'password-mfa-separation@example.com';
  const { secret } = await enrolledAccount(mfa, mfaEmail);
  assert.equal((await mfa.service.login(mfaEmail, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const emailOtp = mfa.emailSender.lastCodeFor(mfaEmail, 'LOGIN_STEP_UP');
  const wrongEmailOtp = emailOtp === '000000' ? '111111' : '000000';
  await assert.rejects(mfa.service.completeLoginStepUp(mfaEmail, wrongEmailOtp, totpFor(secret, mfa.clock.ms())), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await mfa.repository.findByEmailHash(hashParentEmail(mfaEmail))).passwordFailedAttemptCount, 0, 'email OTP failures do not spend the password budget');
  const activeTotp = totpFor(secret, mfa.clock.ms());
  const wrongTotp = String((Number(activeTotp) + 1) % 1000000).padStart(6, '0');
  await assert.rejects(mfa.service.completeLoginStepUp(mfaEmail, emailOtp, wrongTotp), (error) => error.code === 'MFA_INVALID');
  assert.equal((await mfa.repository.findByEmailHash(hashParentEmail(mfaEmail))).passwordFailedAttemptCount, 0, 'wrong TOTP does not spend the password budget');

  await mfa.service.requestMfaRecovery(mfaEmail, PASSWORD);
  const recoveryCode = mfa.emailSender.lastCodeFor(mfaEmail, 'MFA_RECOVERY');
  const wrongRecoveryCode = recoveryCode === '000000' ? '111111' : '000000';
  await assert.rejects(mfa.service.completeMfaRecovery(mfaEmail, PASSWORD, wrongRecoveryCode), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await mfa.repository.findByEmailHash(hashParentEmail(mfaEmail))).passwordFailedAttemptCount, 0, 'recovery-code failures stay separate from password failures');
});

test('password reset remains available during lock, clears it, revokes old authority, and preserves TOTP', async () => {
  const h = harness();
  const email = 'locked-password-reset@example.com';
  const { secret, session } = await enrolledAccount(h, email);
  const secondSession = await h.service.login(email, PASSWORD, session.rawDailyLoginGrantToken);
  h.clock.advance(STEP);
  const stepUp = await h.service.issueCommercialStepUp(session.rawSessionToken, 'BILLING_CHECKOUT_CREATE', totpFor(secret, h.clock.ms()));
  h.clock.advance(STEP);
  for (let attempt = 0; attempt < 5; attempt += 1) await assert.rejects(h.service.login(email, 'wrong password'), (error) => error.code === 'UNAUTHORIZED');
  await assert.rejects(h.service.login(email, PASSWORD), (error) => error.code === 'PASSWORD_LOGIN_LOCKED');

  await h.service.requestPasswordReset(email);
  const resetCode = h.emailSender.lastCodeFor(email, 'PASSWORD_RESET');
  const newPassword = 'Another secure password 8!';
  assert.equal((await h.service.resetPassword(email, resetCode, newPassword, newPassword)).status, 'PASSWORD_RESET');
  assert.ok(h.emailSender.kindsFor(email).includes('PASSWORD_CHANGED'));
  const account = await h.repository.findByEmailHash(hashParentEmail(email));
  assert.equal(account.passwordFailedAttemptCount, 0);
  assert.equal(account.passwordFailureWindowStartedAt, null);
  assert.equal(account.passwordLoginLockedUntil, null);
  assert.equal((await h.mfaService.posture(account.accountId)).status, 'ACTIVE', 'password reset preserves the TOTP factor');
  for (const rawSessionToken of [session.rawSessionToken, secondSession.rawSessionToken]) {
    await assert.rejects(h.service.readSession(rawSessionToken), (error) => error.code === 'UNAUTHORIZED');
  }
  await assert.rejects(h.service.login(email, PASSWORD), (error) => error.code === 'UNAUTHORIZED', 'old password is rejected');
  assert.equal((await h.service.login(email, newPassword, session.rawDailyLoginGrantToken)).status, 'STEP_UP_REQUIRED', 'old trusted-browser grant was revoked');
  assert.equal(await h.commercialOwnerAuthority.authorize(account.serviceAccountId, session.familyId, 'BILLING_CHECKOUT_CREATE', stepUp.stepUpToken), 'STEP_UP_REQUIRED', 'old sensitive step-up grant was revoked');
  const loginStepUp = h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.equal((await h.service.completeLoginStepUp(email, loginStepUp, totpFor(secret, h.clock.ms()))).status, 'AUTHENTICATED', 'new password and existing TOTP work after reset');
});

test('account isolation: one account\'s ticket, code or session never enrolls or authenticates another', async () => {
  const h = harness();
  await registerAndVerify(h, 'a@example.com');
  await registerAndVerify(h, 'b@example.com');
  const a = await loginWithEmailCode(h, 'a@example.com');
  const b = await loginWithEmailCode(h, 'b@example.com');
  assert.notEqual(a.familyId, b.familyId, 'each account gets its own family');
  await assert.rejects(
    h.service.beginMfaEnrollment({ kind: 'SESSION', rawSessionToken: a.rawSessionToken }, 'b@example.com', PASSWORD),
    (error) => error.code === 'UNAUTHORIZED',
  );
  const { secret } = await enroll(h, 'a@example.com', { kind: 'SESSION', rawSessionToken: a.rawSessionToken });
  h.clock.advance(STEP);
  assert.equal((await h.service.readSession(b.rawSessionToken)).mfa.status, 'GRACE', 'B is unaffected by A enrolling');
  assert.equal((await h.service.login('b@example.com', PASSWORD, b.rawDailyLoginGrantToken)).status, 'AUTHENTICATED', "A's authenticator means nothing to B");
});

test('the TOTP secret is never stored in clear and never logged; the otpauth URI is never persisted', async () => {
  const h = harness();
  const email = 'hygiene@example.com';
  const lines = [];
  const originals = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(' '));
  }
  let secret;
  let accountId;
  try {
    await registerAndVerify(h, email);
    const session = await loginWithEmailCode(h, email);
    accountId = session.accountId;
    ({ secret } = await enroll(h, email, { kind: 'SESSION', rawSessionToken: session.rawSessionToken }));
  } finally {
    for (const [level, fn] of Object.entries(originals)) console[level] = fn;
  }
  const state = h.mfaRepository._stateForTest(accountId);
  const stored = JSON.stringify(state, (_key, value) => (value && value.type === 'Buffer' ? Buffer.from(value.data).toString('latin1') : value));
  assert.ok(!stored.includes(secret), 'base32 secret absent from persisted state');
  const { base32Decode } = await import('../../dist/platformadmin/auth/totp.js');
  assert.ok(!state.totpSecretCiphertext.includes(base32Decode(secret)), 'raw secret bytes absent from the ciphertext');
  assert.ok(!stored.includes('otpauth'), 'no otpauth URI persisted');
  const logged = lines.join('\n');
  assert.ok(!logged.includes(secret) && !logged.includes('otpauth'), 'neither the secret nor the URI is ever logged');
});

test('COMMERCIAL_OWNER_AUTHORITY = ADMINISTRATOR + fresh TOTP step-up: single-use, scoped, short-lived, and never the login code', async () => {
  const h = harness();
  const email = 'owner@example.com';
  const { secret, session: known } = await enrolledAccount(h, email);
  const login = await h.service.login(email, PASSWORD, known.rawDailyLoginGrantToken);
  const account = await h.repository.findById(login.accountId);
  const serviceAccountId = account.serviceAccountId;

  assert.equal(await h.commercialOwnerAuthority.authorize(serviceAccountId, login.familyId, 'BILLING_CHECKOUT_CREATE', undefined), 'STEP_UP_REQUIRED', 'a normal session alone is not enough');

  const usedCode = totpFor(secret, h.clock.ms());
  await h.service.issueCommercialStepUp(login.rawSessionToken, 'BILLING_CHECKOUT_CREATE', usedCode);
  await assert.rejects(h.service.issueCommercialStepUp(login.rawSessionToken, 'BILLING_CHECKOUT_CREATE', usedCode), (error) => error.code === 'MFA_INVALID', 'a TOTP counter cannot be reused for another step-up');
  h.clock.advance(STEP);
  const grant = await h.service.issueCommercialStepUp(login.rawSessionToken, 'BILLING_CHECKOUT_CREATE', totpFor(secret, h.clock.ms()));
  assert.equal(await h.commercialOwnerAuthority.authorize(serviceAccountId, login.familyId, 'FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL', grant.stepUpToken), 'STEP_UP_REQUIRED', 'scoped to one operation');
  assert.equal(await h.commercialOwnerAuthority.authorize(serviceAccountId, login.familyId, 'BILLING_CHECKOUT_CREATE', grant.stepUpToken), 'OWNER_AUTHORIZED');
  assert.equal(await h.commercialOwnerAuthority.authorize(serviceAccountId, login.familyId, 'BILLING_CHECKOUT_CREATE', grant.stepUpToken), 'STEP_UP_REQUIRED', 'replay is refused');

  h.clock.advance(STEP);
  const expiring = await h.service.issueCommercialStepUp(login.rawSessionToken, 'FAMILY_COMMERCIAL_AUTO_RENEW_RESUME', totpFor(secret, h.clock.ms()));
  h.clock.advance(5 * 60 * 1000 + 1);
  assert.equal(await h.commercialOwnerAuthority.authorize(serviceAccountId, login.familyId, 'FAMILY_COMMERCIAL_AUTO_RENEW_RESUME', expiring.stepUpToken), 'STEP_UP_REQUIRED', 'expired step-up is refused');

  const wrong = String((Number(totpFor(secret, h.clock.ms())) + 1) % 1000000).padStart(6, '0');
  await assert.rejects(h.service.issueCommercialStepUp(login.rawSessionToken, 'BILLING_CHECKOUT_CREATE', wrong), (error) => error.code === 'MFA_INVALID');
  const types = h.mfaRepository._events.map((event) => [event.eventType, event.detail]);
  assert.ok(types.some(([type, detail]) => type === 'STEP_UP_GRANTED' && detail === 'BILLING_CHECKOUT_CREATE'));
  assert.ok(types.some(([type, detail]) => type === 'STEP_UP_CONSUMED' && detail === 'BILLING_CHECKOUT_CREATE'));
  assert.ok(types.some(([type]) => type === 'STEP_UP_FAILED'));
});

test('commercial step-up denials: Viewer, Child, wrong-family Administrator, disabled account, not yet enrolled', async () => {
  const h = harness();
  const { secret, session: adminKnown } = await enrolledAccount(h, 'admin@example.com');
  const admin = await h.service.login('admin@example.com', PASSWORD, adminKnown.rawDailyLoginGrantToken);
  const adminAccount = await h.repository.findById(admin.accountId);
  h.clock.advance(STEP);
  const grant = await h.service.issueCommercialStepUp(admin.rawSessionToken, 'FAMILY_COMMERCIAL_REQUEST_CREATE', totpFor(secret, h.clock.ms()));

  // Another family's fully-enrolled Administrator cannot act on this family, even holding a valid-looking token.
  const { session: otherKnown } = await enrolledAccount(h, 'other@example.com');
  const other = await h.service.login('other@example.com', PASSWORD, otherKnown.rawDailyLoginGrantToken);
  const otherAccount = await h.repository.findById(other.accountId);
  assert.equal(await h.commercialOwnerAuthority.authorize(otherAccount.serviceAccountId, admin.familyId, 'FAMILY_COMMERCIAL_REQUEST_CREATE', grant.stepUpToken), 'ROLE_DENIED');

  for (const role of ['VIEWER', 'CHILD']) {
    h.repository._setMembershipForTest(admin.accountId, admin.familyId, role);
    assert.equal(await h.commercialOwnerAuthority.authorize(adminAccount.serviceAccountId, admin.familyId, 'FAMILY_COMMERCIAL_REQUEST_CREATE', grant.stepUpToken), 'ROLE_DENIED', `${role} is denied`);
    h.clock.advance(STEP);
    await assert.rejects(h.service.issueCommercialStepUp(admin.rawSessionToken, 'FAMILY_COMMERCIAL_REQUEST_CREATE', totpFor(secret, h.clock.ms())), (error) => error.code === 'FORBIDDEN', `${role} cannot mint a step-up`);
  }
  h.repository._setMembershipForTest(admin.accountId, admin.familyId, 'ADMINISTRATOR');
  h.repository._disableAccountForTest(admin.accountId, h.clock.now());
  assert.equal(await h.commercialOwnerAuthority.authorize(adminAccount.serviceAccountId, admin.familyId, 'FAMILY_COMMERCIAL_REQUEST_CREATE', grant.stepUpToken), 'ROLE_DENIED', 'a disabled account is denied');

  await registerAndVerify(h, 'grace-admin@example.com');
  const graceAdmin = await loginWithEmailCode(h, 'grace-admin@example.com');
  await assert.rejects(h.service.issueCommercialStepUp(graceAdmin.rawSessionToken, 'BILLING_CHECKOUT_CREATE', '123456'), (error) => error.code === 'FORBIDDEN', 'no authenticator, no step-up');
  const graceAccount = await h.repository.findById(graceAdmin.accountId);
  assert.equal(await h.commercialOwnerAuthority.authorize(graceAccount.serviceAccountId, graceAdmin.familyId, 'BILLING_CHECKOUT_CREATE', grant.stepUpToken), 'STEP_UP_REQUIRED');
});
