// PCA DAILY LOGIN OTP: source-level service proof for the browser-bound,
// 24-hour Parent login grant. This suite never uses a production database or
// sends a real message; the mailbox sender is a deterministic test double.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { generateDailyLoginGrant, hashDailyLoginGrant } from '../../dist/parentaccount/dailyLoginGrant.js';
import { DAILY_LOGIN_GRANT_TTL_MS, LOGIN_STEP_UP_CODE_TTL_MS } from '../../dist/parentaccount/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';

const BASE_TIME = new Date('2026-08-15T00:00:00.000Z').getTime();
const EMAIL = 'daily-login@example.com';
const PASSWORD = 'correct horse battery staple';

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

  lastCodeFor(email, kind) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email && this.sent[i].kind === kind) return this.sent[i].code;
    }
    return null;
  }
}

function buildHarness() {
  let currentTime = BASE_TIME;
  const now = () => new Date(currentTime);
  const advance = (milliseconds) => {
    currentTime += milliseconds;
  };
  const authRepository = createInMemoryAuthRepository();
  const parentAccountRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new RecordingEmailSender();
  const authService = new AuthService(authRepository, now);
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender, now });
  return { service, authRepository, parentAccountRepository, emailSender, now, advance };
}

async function registerAndVerify(harness, email = EMAIL, password = PASSWORD) {
  await harness.service.register(email, password, password);
  const code = harness.emailSender.lastCodeFor(email, 'VERIFICATION');
  return harness.service.verifyEmail(email, code);
}

async function loginWithOtp(harness, email = EMAIL, password = PASSWORD) {
  const pending = await harness.service.login(email, password);
  assert.deepEqual(pending, { status: 'STEP_UP_REQUIRED' });
  const code = harness.emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.match(code, /^\d{6}$/);
  return harness.service.completeLoginStepUp(email, code);
}

test('daily grant token is opaque high entropy and only its domain-separated hash is persisted', () => {
  const first = generateDailyLoginGrant();
  const second = generateDailyLoginGrant();
  assert.match(first.rawToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.rawToken, second.rawToken);
  assert.match(first.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(hashDailyLoginGrant(first.rawToken), first.tokenHash);
  assert.notEqual(first.tokenHash, first.rawToken);
});

test('valid password without a browser grant requires email OTP and issues no session before OTP', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const result = await harness.service.login(EMAIL, PASSWORD);
  assert.deepEqual(result, { status: 'STEP_UP_REQUIRED' });
  assert.equal(harness.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP')?.length, 6);
  await assert.rejects(() => harness.service.readSession('not-a-session-token'), ParentAccountError);
});

test('OTP completion issues a browser grant and the same browser can sign in without another OTP', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const completed = await loginWithOtp(harness);
  assert.match(completed.rawDailyLoginGrantToken, /^[A-Za-z0-9_-]{43}$/);
  const messagesBeforeRoutineLogin = harness.emailSender.sent.length;
  const routine = await harness.service.login(EMAIL, PASSWORD, completed.rawDailyLoginGrantToken);
  assert.equal(routine.status, 'AUTHENTICATED');
  assert.ok(routine.rawSessionToken);
  assert.equal(harness.emailSender.sent.length, messagesBeforeRoutineLogin, 'a valid same-browser grant must not trigger another OTP');
});

test('a new browser, a tampered grant, and a cross-account grant cannot bypass OTP', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness, EMAIL, PASSWORD);
  await registerAndVerify(harness, 'other-daily-login@example.com', PASSWORD);
  const first = await loginWithOtp(harness, EMAIL, PASSWORD);

  assert.deepEqual(await harness.service.login(EMAIL, PASSWORD), { status: 'STEP_UP_REQUIRED' });
  const tampered = `${first.rawDailyLoginGrantToken.slice(0, -1)}${first.rawDailyLoginGrantToken.endsWith('A') ? 'B' : 'A'}`;
  assert.deepEqual(await harness.service.login(EMAIL, PASSWORD, tampered), { status: 'STEP_UP_REQUIRED' });
  assert.deepEqual(await harness.service.login('other-daily-login@example.com', PASSWORD, first.rawDailyLoginGrantToken), { status: 'STEP_UP_REQUIRED' });
});

test('expired and explicitly revoked grants require a fresh OTP', async () => {
  const harness = buildHarness();
  const verified = await registerAndVerify(harness);
  const completed = await loginWithOtp(harness);

  harness.advance(DAILY_LOGIN_GRANT_TTL_MS + 1);
  assert.deepEqual(await harness.service.login(EMAIL, PASSWORD, completed.rawDailyLoginGrantToken), { status: 'STEP_UP_REQUIRED' });

  await harness.parentAccountRepository.revokeDailyLoginGrant(verified.accountId, hashDailyLoginGrant(completed.rawDailyLoginGrantToken), harness.now());
  assert.deepEqual(await harness.service.login(EMAIL, PASSWORD, completed.rawDailyLoginGrantToken), { status: 'STEP_UP_REQUIRED' });
});

test('logout, revoke-all, and password reset revoke browser grants', async () => {
  const logoutHarness = buildHarness();
  await registerAndVerify(logoutHarness);
  const logoutLogin = await loginWithOtp(logoutHarness);
  await logoutHarness.service.logout(logoutLogin.rawSessionToken, logoutLogin.rawDailyLoginGrantToken);
  assert.deepEqual(await logoutHarness.service.login(EMAIL, PASSWORD, logoutLogin.rawDailyLoginGrantToken), { status: 'STEP_UP_REQUIRED' });

  const revokeHarness = buildHarness();
  await registerAndVerify(revokeHarness);
  const revokeLogin = await loginWithOtp(revokeHarness);
  await revokeHarness.service.revokeAllSessions(revokeLogin.rawSessionToken);
  assert.deepEqual(await revokeHarness.service.login(EMAIL, PASSWORD, revokeLogin.rawDailyLoginGrantToken), { status: 'STEP_UP_REQUIRED' });

  const resetHarness = buildHarness();
  await registerAndVerify(resetHarness);
  const resetLogin = await loginWithOtp(resetHarness);
  const newPassword = 'a new correct horse battery';
  await resetHarness.service.requestPasswordReset(EMAIL);
  const resetCode = resetHarness.emailSender.lastCodeFor(EMAIL, 'PASSWORD_RESET');
  await resetHarness.service.resetPassword(EMAIL, resetCode, newPassword, newPassword);
  await assert.rejects(() => resetHarness.service.login(EMAIL, PASSWORD, resetLogin.rawDailyLoginGrantToken), ParentAccountError);
  assert.deepEqual(await resetHarness.service.login(EMAIL, newPassword, resetLogin.rawDailyLoginGrantToken), { status: 'STEP_UP_REQUIRED' });
});

test('disabled and family-suspended accounts cannot use a previously valid grant', async () => {
  const disabledHarness = buildHarness();
  const disabledVerified = await registerAndVerify(disabledHarness);
  const disabledLogin = await loginWithOtp(disabledHarness);
  disabledHarness.parentAccountRepository._disableAccountForTest(disabledVerified.accountId, disabledHarness.now());
  await assert.rejects(() => disabledHarness.service.login(EMAIL, PASSWORD, disabledLogin.rawDailyLoginGrantToken), ParentAccountError);

  const suspendedHarness = buildHarness();
  const suspendedVerified = await registerAndVerify(suspendedHarness);
  const suspendedLogin = await loginWithOtp(suspendedHarness);
  const familyId = 'family-for-daily-login-suspension';
  suspendedHarness.parentAccountRepository._setFamilyForTest(suspendedVerified.accountId, familyId);
  suspendedHarness.parentAccountRepository._setFamilyStatusForTest(familyId, 'SUSPENDED');
  await assert.rejects(() => suspendedHarness.service.login(EMAIL, PASSWORD, suspendedLogin.rawDailyLoginGrantToken), ParentAccountError);
});

test('OTP is single-use, expires, and cannot be won twice concurrently', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  await harness.service.login(EMAIL, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP');
  const results = await Promise.allSettled([
    harness.service.completeLoginStepUp(EMAIL, code),
    harness.service.completeLoginStepUp(EMAIL, code),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

  const replay = results.find((result) => result.status === 'fulfilled').value;
  await assert.rejects(() => harness.service.completeLoginStepUp(EMAIL, code), ParentAccountError);
  assert.ok(replay.rawDailyLoginGrantToken);

  const expiryHarness = buildHarness();
  await registerAndVerify(expiryHarness);
  await expiryHarness.service.login(EMAIL, PASSWORD);
  const expiringCode = expiryHarness.emailSender.lastCodeFor(EMAIL, 'LOGIN_STEP_UP');
  expiryHarness.advance(LOGIN_STEP_UP_CODE_TTL_MS + 1);
  await assert.rejects(() => expiryHarness.service.completeLoginStepUp(EMAIL, expiringCode), ParentAccountError);
});

test('daily grant is not a genesis authorization or a substitute for a fresh genesis session proof', async () => {
  const harness = buildHarness();
  await registerAndVerify(harness);
  const completed = await loginWithOtp(harness);
  await assert.rejects(() => harness.service.readSession(completed.rawDailyLoginGrantToken), ParentAccountError);
  await assert.rejects(
    () => harness.service.beginGenesisChallenge(completed.rawDailyLoginGrantToken, { clientPublicKeyJwk: {}, deviceLabel: 'test' }),
    ParentAccountError,
  );
});
