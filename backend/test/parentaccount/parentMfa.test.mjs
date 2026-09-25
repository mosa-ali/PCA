// PCA-DEC-037 -- Parent account journey after Genesis removal:
// register -> verify -> first login (grace starts once, family provisioned)
// -> authenticator enrollment -> TOTP on every explicit login, plus
// lockout, recovery, notifications, secret hygiene and the ADMINISTRATOR +
// fresh-TOTP commercial step-up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
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

/** Password + emailed code: the second factor before an authenticator exists. */
async function loginWithEmailCode(h, email, dailyGrant) {
  const first = await h.service.login(email, PASSWORD, dailyGrant);
  if (first.status === 'AUTHENTICATED') return first;
  assert.equal(first.status, 'STEP_UP_REQUIRED');
  return h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'));
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
  const { secret } = await enroll(h, email, { kind: 'SESSION', rawSessionToken: session.rawSessionToken });
  h.clock.advance(STEP);
  return { secret, session };
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

test('first login: family provisioned as ADMINISTRATOR, grace starts exactly once, FIRST_LOGIN notice once, family stable across logins', async () => {
  const h = harness();
  const email = 'first@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.ok(first.familyId);
  assert.equal(first.role, 'ADMINISTRATOR');
  assert.equal(first.mfa.status, 'GRACE');
  assert.equal(first.mfa.graceExpiresAt.getTime(), h.clock.ms() + PARENT_MFA_GRACE_MS);

  h.clock.advance(HOUR);
  const second = await loginWithEmailCode(h, email);
  assert.equal(second.familyId, first.familyId, 'a second login never creates a second family');
  assert.equal(second.mfa.graceExpiresAt.getTime(), first.mfa.graceExpiresAt.getTime(), 'grace never restarts or extends');
  assert.equal(h.emailSender.kindsFor(email).filter((kind) => kind === 'FIRST_LOGIN').length, 1);
  const events = h.mfaRepository._events.map((event) => event.eventType);
  assert.equal(events.filter((type) => type === 'MFA_GRACE_STARTED').length, 1);
  assert.equal(events.filter((type) => type === 'FAMILY_PROVISIONED').length, 1);
});

test('grace sessions never outlive the grace deadline', async () => {
  const h = harness();
  const email = 'cap@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  h.clock.advance(PARENT_MFA_GRACE_MS - 2 * HOUR);
  const late = await loginWithEmailCode(h, email);
  assert.equal(late.sessionExpiresAt.getTime(), first.mfa.graceExpiresAt.getTime(), 'a session issued near the deadline is capped at it');
});

test('during grace the Parent Console stays usable without an authenticator (email code, and this browser\'s grant)', async () => {
  const h = harness();
  const email = 'grace@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  const session = await h.service.readSession(first.rawSessionToken);
  assert.equal(session.mfa.status, 'GRACE');
  h.clock.advance(20 * HOUR);
  const viaGrant = await h.service.login(email, PASSWORD, first.rawDailyLoginGrantToken);
  assert.equal(viaGrant.status, 'AUTHENTICATED', "inside grace (and within the grant's own 24 h) the remembered browser still skips the email code");
  h.clock.advance(PARENT_MFA_GRACE_MS - 21 * HOUR);
  const nearDeadline = await loginWithEmailCode(h, email);
  assert.equal(nearDeadline.status, 'AUTHENTICATED', 'the email code still works one hour before the deadline');
});

test('after grace: no session is possible without enrolling -- grant ignored, email code yields only an enrollment ticket, old sessions die', async () => {
  const h = harness();
  const email = 'expired@example.com';
  await registerAndVerify(h, email);
  const first = await loginWithEmailCode(h, email);
  h.clock.advance(PARENT_MFA_GRACE_MS + 1);
  await assert.rejects(h.service.readSession(first.rawSessionToken), (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED');
  assert.equal((await h.service.login(email, PASSWORD, first.rawDailyLoginGrantToken)).status, 'STEP_UP_REQUIRED', 'the grant no longer bypasses anything');
  const completed = await h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'));
  assert.equal(completed.status, 'MFA_SETUP_REQUIRED');
  assert.equal(completed.rawSessionToken, undefined);

  const { outcome } = await enroll(h, email, { kind: 'TICKET', rawTicket: completed.rawEnrollmentTicket });
  assert.equal(outcome.status, 'ENROLLED_SESSION_ESTABLISHED');
  assert.equal((await h.service.readSession(outcome.rawSessionToken)).mfa.status, 'ACTIVE');
  await assert.rejects(
    h.service.beginMfaEnrollment({ kind: 'TICKET', rawTicket: completed.rawEnrollmentTicket }, email, PASSWORD),
    (error) => error.code === 'UNAUTHORIZED',
    'a consumed ticket authorizes nothing further',
  );
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
  assert.deepEqual(confirmed, { status: 'ENROLLED' });
  assert.equal((await h.service.readSession(session.rawSessionToken)).mfa.status, 'ACTIVE', 'the enrolling session is kept');
  assert.ok(h.emailSender.kindsFor(email).includes('MFA_ENROLLED'));
  h.clock.advance(STEP);
  assert.equal((await h.service.login(email, PASSWORD, session.rawDailyLoginGrantToken)).status, 'MFA_REQUIRED', 'grants are revoked and cannot bypass TOTP');
  await assert.rejects(h.service.beginMfaEnrollment(credential, email, PASSWORD), (error) => error.code === 'UNAUTHORIZED', 'an ACTIVE factor is replaced only through recovery');
});

test('every explicit login needs a fresh TOTP: no code, wrong code, replayed code, email code, remembered browser, new browser', async () => {
  const h = harness();
  const email = 'every@example.com';
  const { secret, session } = await enrolledAccount(h, email);
  assert.deepEqual(await h.service.login(email, PASSWORD), { status: 'MFA_REQUIRED' });
  assert.deepEqual(await h.service.login(email, PASSWORD, session.rawDailyLoginGrantToken), { status: 'MFA_REQUIRED' });
  assert.equal(h.emailSender.kindsFor(email).filter((kind) => kind === 'LOGIN_STEP_UP').length, 1, 'no email code is ever sent to an enrolled account');
  await assert.rejects(h.service.completeLoginStepUp(email, h.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP')), (error) => error.code === 'UNAUTHORIZED');

  const code = totpFor(secret, h.clock.ms());
  await assert.rejects(h.service.login('every@example.com', 'wrong password!!', undefined, code), (error) => error.code === 'UNAUTHORIZED', 'TOTP never rescues a wrong password');
  const signedIn = await h.service.login(email, PASSWORD, undefined, code);
  assert.equal(signedIn.status, 'AUTHENTICATED');
  assert.equal(signedIn.mfa.status, 'ACTIVE');
  await assert.rejects(h.service.login(email, PASSWORD, undefined, code), (error) => error.code === 'MFA_INVALID', 'the same code is never accepted twice');

  // logout, then a "restarted"/second browser: no cookies at all -> still TOTP.
  await h.service.logout(signedIn.rawSessionToken);
  await assert.rejects(h.service.readSession(signedIn.rawSessionToken), (error) => error.code === 'UNAUTHORIZED');
  h.clock.advance(STEP);
  assert.deepEqual(await h.service.login(email, PASSWORD), { status: 'MFA_REQUIRED' });
  assert.equal((await h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms()))).status, 'AUTHENTICATED');
});

test('TOTP lockout: 5 wrong codes lock the factor for 15 minutes, even against a correct code', async () => {
  const h = harness();
  const email = 'lock@example.com';
  const { secret } = await enrolledAccount(h, email);
  const wrong = (offset) => String((Number(totpFor(secret, h.clock.ms())) + 500000 + offset) % 1000000).padStart(6, '0');
  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(h.service.login(email, PASSWORD, undefined, wrong(i)), (error) => error.code === 'MFA_INVALID');
  }
  await assert.rejects(h.service.login(email, PASSWORD, undefined, wrong(9)), (error) => error.code === 'MFA_LOCKED');
  await assert.rejects(h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms())), (error) => error.code === 'MFA_LOCKED');
  h.clock.advance(15 * 60 * 1000 + STEP);
  assert.equal((await h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms()))).status, 'AUTHENTICATED');
  const types = h.mfaRepository._events.map((event) => event.eventType);
  assert.ok(types.includes('MFA_LOCKED'));
});

test('recovery: 24-hour hold, no browser bypass or timer reset, fresh code after deadline, new factor only', async () => {
  const h = harness();
  const email = 'recover@example.com';
  const { secret, session } = await enrolledAccount(h, email);
  const otherBrowser = await h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms()));
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
  const pending = await h.service.completeMfaRecovery(email, PASSWORD, code);
  assert.equal(pending.status, 'MFA_RECOVERY_PENDING');
  const holdDeadline = pending.recoveryAvailableAt.getTime();
  assert.equal(holdDeadline, h.clock.ms() + 24 * HOUR);
  await assert.rejects(h.service.completeMfaRecovery(email, PASSWORD, code), (error) => error.code === 'UNAUTHORIZED', 'a recovery code is single-use');

  for (const token of [session.rawSessionToken, otherBrowser.rawSessionToken]) {
    await assert.rejects(h.service.readSession(token), (error) => error.code === 'UNAUTHORIZED', 'every existing session is signed out');
  }
  assert.equal((await h.commercialOwnerAuthority.authorize((await h.repository.findById(session.accountId)).serviceAccountId, session.familyId, 'BILLING_CHECKOUT_CREATE', commercialGrant.stepUpToken)), 'STEP_UP_REQUIRED', 'sensitive commercial operations are denied during recovery');
  const otherDeviceLogin = await h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms()));
  assert.equal(otherDeviceLogin.status, 'MFA_RECOVERY_PENDING', 'a new browser cannot bypass the server-side hold');
  assert.equal(otherDeviceLogin.recoveryAvailableAt.getTime(), holdDeadline);
  await h.service.requestMfaRecovery(email, PASSWORD);
  const duringHoldCode = h.emailSender.lastCodeFor(email, 'MFA_RECOVERY');
  const early = await h.service.completeMfaRecovery(email, PASSWORD, duringHoldCode);
  assert.equal(early.status, 'MFA_RECOVERY_PENDING');
  assert.equal(early.recoveryAvailableAt.getTime(), holdDeadline, 'a second request and code cannot reset the timer');
  await assert.rejects(h.service.beginMfaEnrollment({ kind: 'SESSION', rawSessionToken: session.rawSessionToken }, email, PASSWORD), (error) => error.code === 'UNAUTHORIZED', 'an old browser cannot enroll early');
  await h.service.requestPasswordReset(email);
  await assert.rejects(h.service.resetPassword(email, h.emailSender.lastCodeFor(email, 'PASSWORD_RESET'), 'Another secure password 8!', 'Another secure password 8!'), (error) => error.code === 'UNAUTHORIZED', 'account security settings remain unavailable during hold');
  assert.ok(h.emailSender.sent.some((message) => message.kind === 'MFA_RECOVERY_PENDING'));
  assert.ok(!h.emailSender.kindsFor(email).includes('MFA_RESET'), 'old factor is not removed at hold start');

  h.clock.advance(24 * HOUR - STEP);
  assert.equal((await h.service.login(email, PASSWORD)).status, 'MFA_RECOVERY_PENDING', 'hold is still active one step before the deadline');
  h.clock.advance(STEP);
  assert.equal((await h.service.login(email, PASSWORD)).status, 'MFA_RECOVERY_PENDING', 'passing the deadline alone does not bypass recovery verification');
  await h.service.requestMfaRecovery(email, PASSWORD);
  const afterHoldCode = h.emailSender.lastCodeFor(email, 'MFA_RECOVERY');
  const completed = await h.service.completeMfaRecovery(email, PASSWORD, afterHoldCode);
  assert.equal(completed.status, 'MFA_SETUP_REQUIRED', 'fresh password and email code at the exact deadline unlock new enrollment');
  assert.ok(h.emailSender.kindsFor(email).includes('MFA_RESET'));

  const { secret: newSecret, outcome } = await enroll(h, email, { kind: 'TICKET', rawTicket: completed.rawEnrollmentTicket });
  assert.equal(outcome.status, 'ENROLLED_SESSION_ESTABLISHED', 'the recovering browser keeps a session');
  assert.notEqual(newSecret, secret);
  h.clock.advance(STEP);
  await assert.rejects(h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms())), (error) => error.code === 'MFA_INVALID', 'the lost authenticator is revoked');
  assert.equal((await h.service.login(email, PASSWORD, undefined, totpFor(newSecret, h.clock.ms()))).status, 'AUTHENTICATED');
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
  assert.equal((await h.service.login('b@example.com', PASSWORD, undefined, totpFor(secret, h.clock.ms()))).status, 'STEP_UP_REQUIRED', "A's authenticator means nothing to B");
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
  const { secret } = await enrolledAccount(h, email);
  const login = await h.service.login(email, PASSWORD, undefined, totpFor(secret, h.clock.ms()));
  const account = await h.repository.findById(login.accountId);
  const serviceAccountId = account.serviceAccountId;

  await assert.rejects(
    h.service.issueCommercialStepUp(login.rawSessionToken, 'BILLING_CHECKOUT_CREATE', totpFor(secret, h.clock.ms())),
    (error) => error.code === 'MFA_INVALID',
    'the code already used to sign in cannot also authorize money',
  );
  assert.equal(await h.commercialOwnerAuthority.authorize(serviceAccountId, login.familyId, 'BILLING_CHECKOUT_CREATE', undefined), 'STEP_UP_REQUIRED', 'a normal session alone is not enough');

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
  const { secret } = await enrolledAccount(h, 'admin@example.com');
  const admin = await h.service.login('admin@example.com', PASSWORD, undefined, totpFor(secret, h.clock.ms()));
  const adminAccount = await h.repository.findById(admin.accountId);
  h.clock.advance(STEP);
  const grant = await h.service.issueCommercialStepUp(admin.rawSessionToken, 'FAMILY_COMMERCIAL_REQUEST_CREATE', totpFor(secret, h.clock.ms()));

  // Another family's fully-enrolled Administrator cannot act on this family, even holding a valid-looking token.
  const { secret: otherSecret } = await enrolledAccount(h, 'other@example.com');
  const other = await h.service.login('other@example.com', PASSWORD, undefined, totpFor(otherSecret, h.clock.ms()));
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
