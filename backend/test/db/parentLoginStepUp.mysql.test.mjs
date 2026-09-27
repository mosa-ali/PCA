// MySQL coverage for the completed Parent login contract: email + password
// covers automatic account-bound browser trust, unknown-browser email OTP,
// the persistent MFA deadline, and TOTP on an unknown browser after enrollment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { LOGIN_STEP_UP_CODE_TTL_MS, MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE } from '../../dist/parentaccount/policy.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { closePool } from '../../dist/db/pool.js';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function buildService(clock = createTestClock()) {
  const repository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new TestSandboxEmailSender();
  const { service, mfaService } = createParentAccountTestKit({
    repository,
    authService,
    emailSender,
    mfaRepository: new MySqlParentMfaRepository(),
    now: clock.now,
  });
  return { service, repository, emailSender, mfaService, clock };
}

const PASSWORD = 'a genuinely long password value 2026';
const uniqueEmail = (label) => `optional-login-${label}-${randomUUID()}@example.test`;

async function registerAndVerify(service, emailSender, email) {
  await service.register(email, PASSWORD, PASSWORD);
  await service.verifyEmail(email, emailSender.lastCodeFor(email));
}

test('first login provisions family and trust; recognized browser uses password; unknown browser requires email OTP', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail('password-only');
  await registerAndVerify(service, emailSender, email);

  const first = await service.login(email, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal(first.mfa.status, 'GRACE');
  assert.equal(typeof first.rawDailyLoginGrantToken, 'string');

  const later = await service.login(email, PASSWORD, first.rawDailyLoginGrantToken);
  assert.equal(later.status, 'AUTHENTICATED');
  assert.equal(later.familyId, first.familyId);
  assert.equal(typeof later.rawDailyLoginGrantToken, 'undefined');

  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const stepUpCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(stepUpCode);
  const unknownBrowser = await service.completeLoginStepUp(email, stepUpCode);
  assert.equal(unknownBrowser.status, 'AUTHENTICATED');
  assert.equal(typeof unknownBrowser.rawDailyLoginGrantToken, 'string');
  assert.equal(unknownBrowser.familyId, first.familyId);
  assert.equal(emailSender.kindsFor(email).filter((kind) => kind === 'LOGIN_SUCCESSFUL').length, 2);
});

test('unknown-browser email step-up is single-use and creates account-bound trust', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail('retired-step-up');
  await registerAndVerify(service, emailSender, email);
  const first = await service.login(email, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(code);
  const completed = await service.completeLoginStepUp(email, code);
  assert.equal(completed.status, 'AUTHENTICATED');
  assert.equal(typeof completed.rawDailyLoginGrantToken, 'string');
  await assert.rejects(() => service.completeLoginStepUp(email, code), (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED');
});

test('expired unknown-browser email OTP is rejected without authenticating', async () => {
  const { service, emailSender, clock } = buildService();
  const email = uniqueEmail('expired-step-up');
  await registerAndVerify(service, emailSender, email);
  const first = await service.login(email, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const code = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(code);

  clock.advance(LOGIN_STEP_UP_CODE_TTL_MS + 1);
  await assert.rejects(
    () => service.completeLoginStepUp(email, code),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
});

test('a newer unknown-browser email OTP invalidates the previous code', async () => {
  const { service, emailSender, clock } = buildService();
  const email = uniqueEmail('reissued-step-up');
  await registerAndVerify(service, emailSender, email);
  const first = await service.login(email, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');

  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const oldCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(oldCode);
  clock.advance(1); // Ensures the second MySQL row is unambiguously the latest code.
  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const newCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(newCode);
  assert.notEqual(newCode, oldCode);

  await assert.rejects(
    () => service.completeLoginStepUp(email, oldCode),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
  const completed = await service.completeLoginStepUp(email, newCode);
  assert.equal(completed.status, 'AUTHENTICATED');
  assert.equal(typeof completed.rawDailyLoginGrantToken, 'string');
});

test('eight wrong unknown-browser email OTP guesses exhaust the code', async () => {
  const { service, repository, emailSender } = buildService();
  const email = uniqueEmail('attempt-limit-step-up');
  await registerAndVerify(service, emailSender, email);
  const first = await service.login(email, PASSWORD);
  assert.equal(first.status, 'AUTHENTICATED');
  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const validCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  assert.ok(validCode);
  const wrongCode = validCode === '000000' ? '000001' : '000000';

  for (let attempt = 0; attempt < MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE; attempt += 1) {
    await assert.rejects(
      () => service.completeLoginStepUp(email, wrongCode),
      (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
    );
  }
  const codeRecord = await repository.findLatestLoginStepUpCode(first.accountId);
  assert.equal(codeRecord?.attemptCount, MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE);
  await assert.rejects(
    () => service.completeLoginStepUp(email, validCode),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
});

test('unknown email and verified-account wrong-password login failures share the generic denial and send no login OTP', async () => {
  const { service, emailSender } = buildService();
  const registeredEmail = uniqueEmail('enumeration');
  await registerAndVerify(service, emailSender, registeredEmail);
  const unknownEmail = uniqueEmail('unregistered');

  async function loginErrorCode(address, password) {
    try {
      await service.login(address, password);
    } catch (error) {
      assert.ok(error instanceof ParentAccountError);
      return error.code;
    }
    assert.fail('Expected login to be denied.');
  }

  const unknownEmailError = await loginErrorCode(unknownEmail, PASSWORD);
  const wrongPasswordError = await loginErrorCode(registeredEmail, 'incorrect password value');
  assert.equal(unknownEmailError, 'UNAUTHORIZED');
  assert.equal(wrongPasswordError, unknownEmailError);
  assert.equal(emailSender.kindsFor(registeredEmail).filter((kind) => kind === 'LOGIN_STEP_UP').length, 0);
  assert.equal(emailSender.kindsFor(unknownEmail).filter((kind) => kind === 'LOGIN_STEP_UP').length, 0);
});

test('known browser skips routine TOTP; unknown browser requires email OTP and active TOTP', async () => {
  const { service, emailSender, clock } = buildService();
  const email = uniqueEmail('active-totp');
  await registerAndVerify(service, emailSender, email);
  const session = await service.login(email, PASSWORD);
  const credential = { kind: 'SESSION', rawSessionToken: session.rawSessionToken };
  const started = await service.beginMfaEnrollment(credential, email, PASSWORD);
  const enrolled = await service.confirmMfaEnrollment(credential, email, totpFor(started.secretBase32, clock.now().getTime()));
  assert.equal(enrolled.status, 'ENROLLED');
  const trustedGrant = enrolled.rawDailyLoginGrantToken;
  assert.equal(typeof trustedGrant, 'string');

  assert.equal((await service.login(email, PASSWORD, trustedGrant)).status, 'AUTHENTICATED');
  assert.equal((await service.login(email, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const emailCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  clock.advance(30_000);
  const currentCode = totpFor(started.secretBase32, clock.now().getTime());
  const completed = await service.completeLoginStepUp(email, emailCode, currentCode);
  assert.equal(completed.status, 'AUTHENTICATED');
  assert.equal(typeof completed.rawDailyLoginGrantToken, 'string');
});

test.after(async () => {
  await closePool();
});
