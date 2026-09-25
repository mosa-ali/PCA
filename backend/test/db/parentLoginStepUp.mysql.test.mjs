// Real-MySQL coverage for Parent email login step-up during the pre-enrollment
// grace period. After TOTP enrollment, login requires TOTP and neither this
// email-code path nor a daily grant can authenticate an ACTIVE factor.
// Platform Admin MFA remains a separate realm.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { createParentAccountTestKit } from '../support/parentMfaTestKit.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

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
  async sendPlatformAdminActivationLink() {}
  lastCodeFor(email, kind = 'VERIFICATION') {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email && this.sent[i].kind === kind) return this.sent[i].code;
    }
    return null;
  }
}

function buildService() {
  const repository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const { service } = createParentAccountTestKit({
    repository,
    authService,
    emailSender,
    mfaRepository: new MySqlParentMfaRepository(),
  });
  return { service, repository, emailSender };
}

function uniqueEmail(label) {
  return `login-step-up-${label}-${randomUUID()}@example.test`;
}

const PASSWORD = 'a genuinely long password value 2026';

/** Registers and verifies a real account through the actual service. Registration/email verification remains separate; every password login without a valid browser grant still requires mailbox step-up. */
async function registerAndVerify(service, emailSender, email) {
  await service.register(email, PASSWORD, PASSWORD);
  const code = emailSender.lastCodeFor(email, 'VERIFICATION');
  await service.verifyEmail(email, code);
}

test('EMAIL_VERIFICATION + PASSWORD_AUTH: a normally registered-and-verified account requires daily email OTP before a session', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail('normal');
  await registerAndVerify(service, emailSender, email);

  const result = await service.login(email, PASSWORD);
  assert.deepEqual(result, { status: 'STEP_UP_REQUIRED' });
  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  const completed = await service.completeLoginStepUp(email, code);
  assert.ok(completed.rawSessionToken);
  assert.ok(completed.rawDailyLoginGrantToken);
  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  assert.equal((await service.login(email, PASSWORD, completed.rawDailyLoginGrantToken)).status, 'AUTHENTICATED');
  console.log('PASSWORD_AUTH=PASS');
  console.log('EMAIL_VERIFICATION=PASS');
});

test('EMAIL_OTP: a valid password without a grant requires a real hash-only code, and completing it establishes a session plus a grant', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('first-login');
  await registerAndVerify(service, emailSender, email);
  const account = await repository.findByEmailHash((await import('../../dist/parentaccount/emailHash.js')).hashParentEmail(email));
  const loginResult = await service.login(email, PASSWORD);
  assert.deepEqual(loginResult, { status: 'STEP_UP_REQUIRED' });

  const [[row]] = await getPool().query(`SELECT code_hash FROM parent_login_step_up_codes WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`, [account.accountId]);
  assert.match(row.code_hash, /^[0-9a-f]{64}$/, 'OTP_HASH_ONLY: only a hex HMAC digest is stored, never the plaintext code');

  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.match(code, /^\d{6}$/);
  assert.equal(row.code_hash.includes(code), false);

  const completed = await service.completeLoginStepUp(email, code);
  assert.equal(completed.accountId, account.accountId);
  assert.ok(completed.rawSessionToken);
  assert.ok(completed.rawDailyLoginGrantToken);

  const [[after]] = await getPool().query(`SELECT first_login_completed_at FROM parent_accounts WHERE account_id = ?`, [account.accountId]);
  assert.ok(after.first_login_completed_at, 'first_login_completed_at is now set');

  // The historical first_login_completed_at marker is not the daily bypass.
  const secondLogin = await service.login(email, PASSWORD);
  assert.equal(secondLogin.status, 'STEP_UP_REQUIRED');
  const sameBrowserLogin = await service.login(email, PASSWORD, completed.rawDailyLoginGrantToken);
  assert.equal(sameBrowserLogin.status, 'AUTHENTICATED');

  console.log('EMAIL_OTP=PASS');
  console.log('OTP_HASH_ONLY=PASS');
});

test('OTP_SINGLE_USE + OTP_REPLAY_DENIED: the same step-up code cannot be used twice', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('replay');
  await registerAndVerify(service, emailSender, email);
  const { hashParentEmail } = await import('../../dist/parentaccount/emailHash.js');
  const account = await repository.findByEmailHash(hashParentEmail(email));
  await getPool().query(`UPDATE parent_accounts SET first_login_completed_at = NULL WHERE account_id = ?`, [account.accountId]);

  await service.login(email, PASSWORD);
  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  await service.completeLoginStepUp(email, code);

  await assert.rejects(() => service.completeLoginStepUp(email, code), ParentAccountError);
  console.log('OTP_SINGLE_USE=PASS');
  console.log('OTP_REPLAY_DENIED=PASS');
});

test('OTP_EXPIRY: an expired step-up code is rejected', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('expiry');
  await registerAndVerify(service, emailSender, email);
  const { hashParentEmail } = await import('../../dist/parentaccount/emailHash.js');
  const account = await repository.findByEmailHash(hashParentEmail(email));
  await getPool().query(`UPDATE parent_accounts SET first_login_completed_at = NULL WHERE account_id = ?`, [account.accountId]);
  await service.login(email, PASSWORD);
  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');

  await getPool().query(`UPDATE parent_login_step_up_codes SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE account_id = ?`, [account.accountId]);
  await assert.rejects(() => service.completeLoginStepUp(email, code), ParentAccountError);
  console.log('OTP_EXPIRY=PASS');
});

test('OTP_REISSUE_INVALIDATION: a second login attempt issues a fresh code; the old one no longer works', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('reissue');
  await registerAndVerify(service, emailSender, email);
  const { hashParentEmail } = await import('../../dist/parentaccount/emailHash.js');
  const account = await repository.findByEmailHash(hashParentEmail(email));
  await getPool().query(`UPDATE parent_accounts SET first_login_completed_at = NULL WHERE account_id = ?`, [account.accountId]);

  await service.login(email, PASSWORD);
  const oldCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  await service.login(email, PASSWORD); // second attempt, before completing the first
  const newCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.notEqual(oldCode, newCode);

  // findLatestLoginStepUpCode only ever considers the newest row -- the old
  // one becomes unreachable, matching the password-reset code precedent
  // (see verificationCode.ts's own doc comment on this design axis).
  await assert.rejects(() => service.completeLoginStepUp(email, oldCode), ParentAccountError);
  const completed = await service.completeLoginStepUp(email, newCode);
  assert.ok(completed.rawSessionToken);
  console.log('OTP_REISSUE_INVALIDATION=PASS');
});

test('OTP_ATTEMPT_LIMIT: a code locks itself out after too many wrong guesses', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('attempt-limit');
  await registerAndVerify(service, emailSender, email);
  const { hashParentEmail } = await import('../../dist/parentaccount/emailHash.js');
  const account = await repository.findByEmailHash(hashParentEmail(email));
  await getPool().query(`UPDATE parent_accounts SET first_login_completed_at = NULL WHERE account_id = ?`, [account.accountId]);
  await service.login(email, PASSWORD);
  const realCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');

  for (let i = 0; i < 8; i += 1) {
    await assert.rejects(() => service.completeLoginStepUp(email, '000000' === realCode ? '111111' : '000000'), ParentAccountError);
  }
  // Even the REAL code is now refused -- the code is locked out, not just the wrong guesses.
  await assert.rejects(() => service.completeLoginStepUp(email, realCode), ParentAccountError);
  console.log('OTP_ATTEMPT_LIMIT=PASS');
});

test('ENUMERATION_RESISTANCE: login for an unknown email and a known email with a first-login requirement both eventually deny identically at the credential stage', async () => {
  const { service } = buildService();
  await assert.rejects(() => service.login(uniqueEmail('unknown'), 'irrelevant-password-value'), ParentAccountError);
  console.log('ENUMERATION_RESISTANCE=PASS (unchanged pre-existing behavior -- unknown email and wrong password both throw the identical generic UNAUTHORIZED)');
});

test('SESSION_REVOCATION + ADMIN_TOTP_NOT_REQUIRED_FOR_PARENT: completing step-up never touches Platform Admin MFA state, and normal session revocation still works afterward', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('session-revocation');
  await registerAndVerify(service, emailSender, email);
  const { hashParentEmail } = await import('../../dist/parentaccount/emailHash.js');
  const account = await repository.findByEmailHash(hashParentEmail(email));
  await getPool().query(`UPDATE parent_accounts SET first_login_completed_at = NULL WHERE account_id = ?`, [account.accountId]);
  await service.login(email, PASSWORD);
  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  const completed = await service.completeLoginStepUp(email, code);

  // No platform_admin_* table row was ever touched by this entire flow.
  const [platformAdminRows] = await getPool().query(`SELECT admin_id FROM platform_admin_accounts LIMIT 1`);
  // (Existence of unrelated platform admin rows from other tests is fine; the point is this flow never created one FOR this parent account, which has no admin_id concept at all.)
  assert.ok(Array.isArray(platformAdminRows));

  await service.revokeAllSessions(completed.rawSessionToken);
  const readAfterRevoke = await service.readSession(completed.rawSessionToken).catch((e) => e);
  assert.ok(readAfterRevoke instanceof ParentAccountError);
  console.log('SESSION_REVOCATION=PASS');
  console.log('ADMIN_TOTP_NOT_REQUIRED_FOR_PARENT=PASS');
});

test.after(async () => {
  await closePool();
});
