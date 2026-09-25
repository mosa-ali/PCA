// PCA-AUTH-SESSION-1 -- ParentAccountService unit tests: registration,
// email verification (activation only, PCA-DEC-030), first login (grace start
// + server-side family provisioning), login, session read, logout,
// revoke-all, and the negative-test matrix WRITER57_ASSIGNMENT.md requires.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { PARENT_MFA_GRACE_MS } from '../../dist/parentaccount/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';
import { createParentAccountTestKit } from '../support/parentMfaTestKit.mjs';

const BASE_TIME = new Date('2026-08-15T00:00:00.000Z').getTime();

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
  async sendSecurityNotice(email, notice, occurredAt) {
    this.sent.push({ email, code: null, kind: notice, occurredAt });
  }
  lastCodeFor(email, kind = 'VERIFICATION') {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].kind === kind && this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
  countFor(email, kind) {
    return this.sent.filter((entry) => entry.email === email && entry.kind === kind).length;
  }
}

function buildHarness() {
  let currentTime = BASE_TIME;
  const now = () => new Date(currentTime);
  const advance = (ms) => {
    currentTime += ms;
  };

  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, now);
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new RecordingEmailSender();

  const { service, mfaService } = createParentAccountTestKit({
    repository: parentAccountRepository,
    authService,
    emailSender,
    now,
  });

  return { service, mfaService, authService, parentAccountRepository, emailSender, now, advance };
}

const EMAIL = 'parent@example.com';
const PASSWORD = 'correct horse battery staple';

async function registerAndVerify(harness, email = EMAIL, password = PASSWORD) {
  await harness.service.register(email, password, password);
  const code = harness.emailSender.lastCodeFor(email);
  assert.ok(code, 'a verification code must have been sent');
  return harness.service.verifyEmail(email, code);
}

async function loginWithDailyGrant(harness, email = EMAIL, password = PASSWORD) {
  const pending = await harness.service.login(email, password);
  assert.deepEqual(pending, { status: 'STEP_UP_REQUIRED' });
  const code = harness.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.match(code, /^\d{6}$/);
  return harness.service.completeLoginStepUp(email, code);
}

/** PCA-DEC-030: a session only ever comes from a real sign-in (register -> verify -> login -> emailed step-up). */
async function registerVerifyAndLogin(harness, email = EMAIL, password = PASSWORD) {
  await registerAndVerify(harness, email, password);
  const outcome = await loginWithDailyGrant(harness, email, password);
  assert.equal(outcome.status, 'AUTHENTICATED');
  return outcome;
}

function accountFor(harness, email = EMAIL) {
  return harness.parentAccountRepository.findByEmailHash(hashParentEmail(email));
}

test('register returns the identical PENDING_VERIFICATION response for a brand-new email', async () => {
  const harness = buildHarness();
  const result = await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  assert.deepEqual(result, { status: 'PENDING_VERIFICATION' });
});

test('register never leaks whether an email already exists: identical response for new vs. already-registered', async () => {
  const harness = buildHarness();
  const first = await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const second = await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  assert.deepEqual(first, second);
});

test('register never leaks whether an email is already VERIFIED: identical response, no new code sent', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const sentBefore = harness.emailSender.sent.length;
  const result = await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  assert.deepEqual(result, { status: 'PENDING_VERIFICATION' });
  assert.equal(harness.emailSender.sent.length, sentBefore, 'no new verification code should be sent for an already-verified email');
});

test('register rejects a mismatched password/passwordConfirmation server-side even if a client claimed they matched', async () => {
  const harness = buildHarness();
  await assert.rejects(() => harness.service.register(EMAIL, PASSWORD, 'different password entirely'), (err) => {
    assert.ok(err instanceof ParentAccountError);
    assert.equal(err.code, 'INVALID_INPUT');
    return true;
  });
});

test('register rejects a malformed email and an implausibly short password', async () => {
  const harness = buildHarness();
  await assert.rejects(() => harness.service.register('not-an-email', PASSWORD, PASSWORD));
  await assert.rejects(() => harness.service.register(EMAIL, 'short', 'short'));
});

test('verify-email with the correct code marks the account VERIFIED and issues NO session (PCA-DEC-030: activation only)', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  assert.deepEqual(outcome, { status: 'VERIFIED' }, 'verify-email must never return a session token, account id or family');
  const account = await accountFor(harness);
  assert.equal(account.status, 'VERIFIED');
  assert.equal(account.serviceAccountId, null, 'no service session identity may exist before the first real sign-in');
  assert.equal(harness.emailSender.countFor(EMAIL, 'ACCOUNT_ACTIVATED'), 1, 'the mailbox owner is told the account was activated');

  // The session only exists after a real sign-in, and it is for this account.
  const login = await loginWithDailyGrant(harness);
  const session = await harness.service.readSession(login.rawSessionToken);
  assert.equal(session.accountId, account.accountId);
  assert.equal(session.emailVerified, true);
});

test('SECURITY: verify-email with a wrong code is denied (UNAUTHORIZED), never distinguishable from an unknown/expired code', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, '000000'), (err) => {
    assert.ok(err instanceof ParentAccountError);
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: malformed proof (non-6-digit code) is rejected as INVALID_INPUT before any lookup', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, 'abcdef'), (err) => {
    assert.equal(err.code, 'INVALID_INPUT');
    return true;
  });
});

test('SECURITY: an already-consumed verification code cannot be replayed', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL);
  await harness.service.verifyEmail(EMAIL, code);
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, code), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: an expired verification code is denied', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL);
  harness.advance(16 * 60 * 1000); // past the 15-minute TTL
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, code), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: a code is locked out after too many wrong attempts, even if the correct code is later supplied', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL);
  for (let i = 0; i < 8; i += 1) {
    await harness.service.verifyEmail(EMAIL, '999999').catch(() => {});
  }
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, code), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

// ---- PENDING_VERIFICATION credential-takeover fix (migration 0030) ----
//
// Before this fix, register() called updatePendingPasswordHash whenever a
// registration arrived for an already-pending email, so ANY unauthenticated
// caller could overwrite that account's stored credential with their own
// while the fresh code still went to the real mailbox owner -- and, because
// verify-email only ever considered the single most-recently-issued code,
// the owner's own code stopped working, leaving them nothing to redeem but
// the attacker's. Both halves have to move for this to actually be closed:
// the credential travels with the code that authorises it, and a code the
// owner already holds stays redeemable.

test('SECURITY: a hostile re-registration of a still-unverified email cannot install its own credential -- the first registrant\'s own code still verifies and activates THEIR password', async () => {
  const harness = buildHarness();
  const ownerPassword = 'the real mailbox owner chose this';
  const attackerPassword = 'the attacker chose this other one';

  await harness.service.register(EMAIL, ownerPassword, ownerPassword);
  const ownerCode = harness.emailSender.lastCodeFor(EMAIL);

  // A completely unauthenticated third party registers the SAME address.
  let attackerCode = ownerCode;
  while (attackerCode === ownerCode) {
    await harness.service.register(EMAIL, attackerPassword, attackerPassword);
    attackerCode = harness.emailSender.lastCodeFor(EMAIL);
  }

  // The real mailbox owner verifies with the code THEY asked for.
  const verified = await harness.service.verifyEmail(EMAIL, ownerCode);
  assert.deepEqual(verified, { status: 'VERIFIED' });

  // The account carries the owner's credential -- never the third party's.
  await assert.rejects(() => harness.service.login(EMAIL, attackerPassword), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
  const login = await loginWithDailyGrant(harness, EMAIL, ownerPassword);
  assert.equal(typeof login.rawSessionToken, 'string');
});

test('SECURITY: each verification code carries the credential IT was issued for -- redeeming a given code activates exactly that registration\'s password', async () => {
  const harness = buildHarness();
  const firstPassword = 'the first registration password';
  const secondPassword = 'the second registration password';

  await harness.service.register(EMAIL, firstPassword, firstPassword);
  const firstCode = harness.emailSender.lastCodeFor(EMAIL);
  let secondCode = firstCode;
  while (secondCode === firstCode) {
    await harness.service.register(EMAIL, secondPassword, secondPassword);
    secondCode = harness.emailSender.lastCodeFor(EMAIL);
  }

  await harness.service.verifyEmail(EMAIL, secondCode);
  await assert.rejects(() => harness.service.login(EMAIL, firstPassword));
  assert.equal(typeof (await loginWithDailyGrant(harness, EMAIL, secondPassword)).rawSessionToken, 'string');
});

test('SECURITY: a redeemed code is single-use, and every OTHER live code for that account dies with the account leaving PENDING_VERIFICATION', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const firstCode = harness.emailSender.lastCodeFor(EMAIL);
  let secondCode = firstCode;
  while (secondCode === firstCode) {
    await harness.service.register(EMAIL, PASSWORD, PASSWORD);
    secondCode = harness.emailSender.lastCodeFor(EMAIL);
  }

  await harness.service.verifyEmail(EMAIL, firstCode);
  // Neither the consumed code nor the still-unconsumed sibling can be replayed.
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, firstCode), (err) => err.code === 'UNAUTHORIZED');
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, secondCode), (err) => err.code === 'UNAUTHORIZED');
});

test('SECURITY: the guess budget is not widened by having several live codes -- one wrong guess costs an attempt on every one of them', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const firstCode = harness.emailSender.lastCodeFor(EMAIL);
  let secondCode = firstCode;
  while (secondCode === firstCode) {
    await harness.service.register(EMAIL, PASSWORD, PASSWORD);
    secondCode = harness.emailSender.lastCodeFor(EMAIL);
  }

  // MAX_VERIFICATION_ATTEMPTS_PER_CODE (8) wrong guesses in total -- not 8
  // per live code -- must exhaust the whole live set.
  for (let i = 0; i < 8; i += 1) {
    await harness.service.verifyEmail(EMAIL, '000001').catch(() => {});
  }
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, firstCode), (err) => err.code === 'UNAUTHORIZED');
  await assert.rejects(() => harness.service.verifyEmail(EMAIL, secondCode), (err) => err.code === 'UNAUTHORIZED');
});

test('SECURITY: verify-email for an unverified/nonexistent account never leaks which case it is (unregistered email)', async () => {
  const harness = buildHarness();
  await assert.rejects(() => harness.service.verifyEmail('nobody@example.com', '123456'), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('email verification does not create a family; the FIRST login provisions it server-side, starts the one grace window, and later logins re-use both', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const verifiedAccount = await accountFor(harness);
  assert.equal(verifiedAccount.familyId, null, 'email verification must never create a family');
  assert.equal((await harness.mfaService.posture(verifiedAccount.accountId)).status, 'NOT_STARTED', 'verification must not start the MFA grace window');
  assert.equal(harness.emailSender.countFor(EMAIL, 'FIRST_LOGIN'), 0);

  const first = await loginWithDailyGrant(harness);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal(typeof first.familyId, 'string', 'the first login provisions the family server-side');
  assert.equal(first.role, 'ADMINISTRATOR', 'the provisioning account is the family ADMINISTRATOR');
  assert.equal(first.mfa.status, 'GRACE');
  assert.equal(first.mfa.graceExpiresAt.getTime(), BASE_TIME + PARENT_MFA_GRACE_MS, 'grace is exactly 3 days from the first login');
  assert.equal(typeof first.rawDailyLoginGrantToken, 'string');
  assert.equal(harness.emailSender.countFor(EMAIL, 'FIRST_LOGIN'), 1, 'the first login sends exactly one FIRST_LOGIN notice');

  const session = await harness.service.readSession(first.rawSessionToken);
  assert.equal(session.familyId, first.familyId);
  assert.equal(session.role, 'ADMINISTRATOR');

  // A later login (one hour on) neither restarts grace, re-sends the notice, nor creates a second family.
  harness.advance(60 * 60 * 1000);
  const second = await loginWithDailyGrant(harness);
  assert.equal(second.familyId, first.familyId, 'exactly one family per account');
  assert.equal(second.mfa.graceExpiresAt.getTime(), first.mfa.graceExpiresAt.getTime(), 'grace starts ONCE and never restarts');
  assert.equal(harness.emailSender.countFor(EMAIL, 'FIRST_LOGIN'), 1);
});

test('SECURITY: a session issued during grace never outlives the grace deadline', async () => {
  const harness = buildHarness();
  const first = await registerVerifyAndLogin(harness);
  // 2 days 20 hours in: 4 hours of grace left, less than the 12 h session TTL.
  harness.advance(PARENT_MFA_GRACE_MS - 4 * 60 * 60 * 1000);
  const late = await loginWithDailyGrant(harness);
  assert.equal(late.status, 'AUTHENTICATED');
  assert.equal(late.sessionExpiresAt.getTime(), first.mfa.graceExpiresAt.getTime(), 'session TTL is capped at the grace deadline');
  harness.advance(4 * 60 * 60 * 1000 + 1);
  await assert.rejects(() => harness.service.readSession(late.rawSessionToken), (err) => err.code === 'UNAUTHORIZED');
});

test('SECURITY: after grace without an authenticator, sign-in yields only an enrollment ticket and the daily grant no longer bypasses the emailed code', async () => {
  const harness = buildHarness();
  await registerVerifyAndLogin(harness);
  // A browser grant minted one hour before the deadline is still inside its own 24 h TTL once grace ends.
  harness.advance(PARENT_MFA_GRACE_MS - 60 * 60 * 1000);
  const lastInGrace = await loginWithDailyGrant(harness);
  harness.advance(2 * 60 * 60 * 1000);
  await assert.rejects(() => harness.service.readSession(lastInGrace.rawSessionToken), (err) => err.code === 'UNAUTHORIZED');
  const pending = await harness.service.login(EMAIL, PASSWORD, lastInGrace.rawDailyLoginGrantToken);
  assert.deepEqual(pending, { status: 'STEP_UP_REQUIRED' }, 'a daily grant never authenticates once grace is over');
  const completed = await harness.service.completeLoginStepUp(EMAIL, harness.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP'));
  assert.equal(completed.status, 'MFA_SETUP_REQUIRED');
  assert.equal(typeof completed.rawEnrollmentTicket, 'string');
  assert.ok(!('rawSessionToken' in completed), 'no session after grace without enrollment');
});

test('login only succeeds against a VERIFIED account, with a single generic error for every failure mode', async () => {
  const harness = buildHarness();
  // Unregistered email.
  await assert.rejects(() => harness.service.login('nobody@example.com', PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
  // Registered but not yet verified.
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  await assert.rejects(() => harness.service.login(EMAIL, PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('login succeeds against a VERIFIED account with the correct password and fails with the SAME generic error for a wrong one', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const outcome = await loginWithDailyGrant(harness);
  assert.equal(typeof outcome.rawSessionToken, 'string');

  await assert.rejects(() => harness.service.login(EMAIL, 'totally wrong password'), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: the session read exposes only server-derived fields -- no cryptographic Owner/Genesis flag -- and the role is the server-resolved membership', async () => {
  const harness = buildHarness();
  const outcome = await registerVerifyAndLogin(harness);
  const session = await harness.service.readSession(outcome.rawSessionToken);
  assert.deepEqual(Object.keys(session).sort(), ['accountId', 'emailVerified', 'familyId', 'mfa', 'role']);
  assert.equal(session.familyId, outcome.familyId);
  assert.equal(session.role, 'ADMINISTRATOR');
  assert.deepEqual(Object.keys(session.mfa).sort(), ['graceExpiresAt', 'status']);
  assert.equal(session.mfa.status, 'GRACE');
});

test('SECURITY: a session for an account that never completed a PCA-DEC-030 login (no grace record) is refused', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const account = await accountFor(harness);
  // A legacy/stray session bound to the account WITHOUT going through login().
  const issued = await harness.authService.issueSession({ accountReferenceHash: Buffer.alloc(32, 7) });
  await harness.parentAccountRepository.setServiceAccountIdIfAbsent(account.accountId, issued.session.accountId);
  await assert.rejects(() => harness.service.readSession(issued.rawToken), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
  assert.equal((await accountFor(harness)).familyId, null, 'a refused session must never provision a family');
});

test('SECURITY: expired session is denied identically to no session (fail closed)', async () => {
  const harness = buildHarness();
  const outcome = await registerVerifyAndLogin(harness);
  harness.advance(13 * 60 * 60 * 1000); // past AuthService's 12h default TTL
  await assert.rejects(() => harness.service.readSession(outcome.rawSessionToken));
});

test('SECURITY: revoked session (logout) is denied identically to no session', async () => {
  const harness = buildHarness();
  const outcome = await registerVerifyAndLogin(harness);
  await harness.service.logout(outcome.rawSessionToken);
  await assert.rejects(() => harness.service.readSession(outcome.rawSessionToken));
});

test('logout is idempotent for an already-revoked/unknown/malformed token', async () => {
  const harness = buildHarness();
  const outcome = await registerVerifyAndLogin(harness);
  await harness.service.logout(outcome.rawSessionToken);
  await assert.doesNotReject(() => harness.service.logout(outcome.rawSessionToken));
  await assert.doesNotReject(() => harness.service.logout('not-a-real-token'));
});

test('SECURITY: session fixation -- verify-email mints no token at all, and each login mints its own new token', async () => {
  const harness = buildHarness();
  const verified = await registerAndVerify(harness);
  assert.ok(!('rawSessionToken' in verified));
  const first = await loginWithDailyGrant(harness);
  const second = await loginWithDailyGrant(harness);
  assert.notEqual(first.rawSessionToken, second.rawSessionToken);
});

test('revoke-all-sessions revokes every session for the account, requires an already-valid session, and denies reuse of the very token used to call it', async () => {
  const harness = buildHarness();
  const first = await registerVerifyAndLogin(harness);
  const second = await loginWithDailyGrant(harness);

  await harness.service.revokeAllSessions(first.rawSessionToken);

  await assert.rejects(() => harness.service.readSession(first.rawSessionToken));
  await assert.rejects(() => harness.service.readSession(second.rawSessionToken));
});

test('SECURITY: revoke-all-sessions itself requires a currently-valid session (an already-revoked/unknown token cannot trigger it)', async () => {
  const harness = buildHarness();
  await assert.rejects(() => harness.service.revokeAllSessions('not-a-real-token'), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('PCA-ADD-PA-017 enforcement: an account with no familyId yet is never blocked by a family-suspend check', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  assert.equal((await accountFor(harness)).familyId, null);
  const firstLogin = await loginWithDailyGrant(harness);
  assert.equal(typeof firstLogin.rawSessionToken, 'string');

  // Once provisioned, a Platform Admin suspension of that family blocks sign-in with the same generic error.
  harness.parentAccountRepository._setFamilyStatusForTest(firstLogin.familyId, 'SUSPENDED');
  await assert.rejects(() => harness.service.login(EMAIL, PASSWORD), (err) => err.code === 'UNAUTHORIZED');
});

test('CONCURRENCY: two concurrent registrations for the same email never both create distinct accounts (uniqueness race)', async () => {
  const harness = buildHarness();
  const results = await Promise.all([
    harness.service.register(EMAIL, PASSWORD, PASSWORD),
    harness.service.register(EMAIL, 'another valid password!', 'another valid password!'),
  ]);
  for (const r of results) assert.deepEqual(r, { status: 'PENDING_VERIFICATION' });
  const account = await harness.parentAccountRepository.findByEmailHash(
    (await import('../../dist/parentaccount/emailHash.js')).hashParentEmail(EMAIL),
  );
  assert.ok(account, 'exactly one account must exist for the email');
});

test('CONCURRENCY: two concurrent verify-email calls with the same valid code only let ONE of them win (no duplicate-verification-code race)', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL);

  const results = await Promise.allSettled([harness.service.verifyEmail(EMAIL, code), harness.service.verifyEmail(EMAIL, code)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent verify-email call must win the single-use code');
  assert.equal(rejected.length, 1);
});

// ---- Password reset (PCA product-completion programme, P1 /login finding) ----

const NEW_PASSWORD = 'a brand new correct horse battery';

test('requestPasswordReset returns the identical response for a VERIFIED account and sends a real code', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const result = await harness.service.requestPasswordReset(EMAIL);
  assert.deepEqual(result, { status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS' });
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  assert.ok(code, 'a password-reset code must have been sent');
});

test('SECURITY: requestPasswordReset never leaks account existence -- identical response for an unknown email, and no code is sent', async () => {
  const harness = buildHarness();
  const result = await harness.service.requestPasswordReset('nobody@example.com');
  assert.deepEqual(result, { status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS' });
  assert.equal(harness.emailSender.lastCodeFor('nobody@example.com', 'PASSWORD_RESET'), null);
});

test('SECURITY: requestPasswordReset never sends a code for an unverified (PENDING_VERIFICATION) account', async () => {
  const harness = buildHarness();
  await harness.service.register(EMAIL, PASSWORD, PASSWORD); // never verified
  await harness.service.requestPasswordReset(EMAIL);
  assert.equal(harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET'), null);
});

test('resetPassword replaces the password and the new password works at login', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');

  const result = await harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD);
  assert.deepEqual(result, { status: 'PASSWORD_RESET' });

  await assert.rejects(() => harness.service.login(EMAIL, PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
  const loggedIn = await loginWithDailyGrant(harness, EMAIL, NEW_PASSWORD);
  assert.ok(loggedIn.rawSessionToken);
});

test('SECURITY: resetPassword rejects a mismatched newPassword/newPasswordConfirmation before ever touching the stored code', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  await assert.rejects(() => harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, 'a different password entirely'), (err) => {
    assert.equal(err.code, 'INVALID_INPUT');
    return true;
  });
  // The code must still be usable afterward -- a rejected confirmation-mismatch attempt must not burn the real code.
  const result = await harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD);
  assert.deepEqual(result, { status: 'PASSWORD_RESET' });
});

test('SECURITY: an expired password-reset code is denied', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  harness.advance(16 * 60 * 1000); // past the 15-minute TTL
  await assert.rejects(() => harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: a password-reset code is locked out after too many wrong attempts, even if the correct code is later supplied', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  for (let i = 0; i < 8; i += 1) {
    await harness.service.resetPassword(EMAIL, '999999', NEW_PASSWORD, NEW_PASSWORD).catch(() => {});
  }
  await assert.rejects(() => harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: resetPassword for an unverified/nonexistent account never leaks which case it is', async () => {
  const harness = buildHarness();
  await assert.rejects(() => harness.service.resetPassword('nobody@example.com', '123456', NEW_PASSWORD, NEW_PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
  await harness.service.register(EMAIL, PASSWORD, PASSWORD); // PENDING_VERIFICATION, never verified
  await assert.rejects(() => harness.service.resetPassword(EMAIL, '123456', NEW_PASSWORD, NEW_PASSWORD), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: a successful password reset revokes every existing session for the account', async () => {
  const harness = buildHarness();
  const verified = await registerVerifyAndLogin(harness);
  assert.ok(verified.rawSessionToken, 'the sign-in must have issued a session');
  await harness.authService.validateSession(verified.rawSessionToken); // still valid before reset

  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  await harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD);

  await assert.rejects(() => harness.authService.validateSession(verified.rawSessionToken));
});

test('resetPassword does NOT auto-issue a new session -- the family must sign in fresh with the new password', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  const result = await harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD);
  assert.ok(!('rawSessionToken' in result), 'resetPassword must not return a session token');
});

test('CONCURRENCY: two concurrent resetPassword calls with the same valid code only let ONE of them win (no duplicate-reset-code race)', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.requestPasswordReset(EMAIL);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');

  const results = await Promise.allSettled([
    harness.service.resetPassword(EMAIL, code, NEW_PASSWORD, NEW_PASSWORD),
    harness.service.resetPassword(EMAIL, code, 'yet another valid password!', 'yet another valid password!'),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent resetPassword call must win the single-use code');
  assert.equal(rejected.length, 1);
});
