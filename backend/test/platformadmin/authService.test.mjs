process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PlatformAdminAuthService, PlatformAdminAuthError } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { createInMemoryPlatformAdminAuthRepository } from '../support/inMemoryPlatformAdminAuthRepository.mjs';
import { createInMemoryPlatformAdminAlertPort } from '../support/inMemoryPlatformAdminAlertPort.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function buildHarness() {
  const repository = createInMemoryPlatformAdminAuthRepository();
  const alertPort = createInMemoryPlatformAdminAlertPort();
  let currentTime = BASE_TIME;
  const now = () => new Date(currentTime);
  const clock = { advance: (ms) => { currentTime += ms; }, set: (ms) => { currentTime = ms; } };
  const authService = new PlatformAdminAuthService(repository, alertPort, now);
  const accountService = new PlatformAdminAccountService(repository, now);
  return { repository, alertPort, authService, accountService, clock, now };
}

/** Creates an ACTIVE account with ACTIVE MFA (bypassing the normal PENDING_SETUP-after-createAccount limitation, exactly like the bootstrap script does) so login tests can exercise the full password+TOTP path. */
async function createLoginableAdmin(harness, { email = `owner-${randomUUID()}@example.test`, password = 'correct horse battery staple', role = 'APP_OWNER' } = {}) {
  const account = await harness.accountService.createAccount('Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  harness.repository._setMfaStateForTest(account.adminId, {
    status: 'ACTIVE',
    totpSecretCiphertext: ciphertext,
    totpSecretNonce: nonce,
    activatedAt: harness.now(),
    createdAt: harness.now(),
  });
  return { adminId: account.adminId, email, password, secret };
}

test('login succeeds with correct password + correct TOTP and returns a pa_-prefixed session token', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const result = await harness.authService.login(admin.email, admin.password, code);
  assert.match(result.rawToken, /^pa_/);
  assert.equal(result.adminId, admin.adminId);
});

test('login with correct password but missing/wrong TOTP code fails with the single generic error', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  await assert.rejects(() => harness.authService.login(admin.email, admin.password, '000000'), PlatformAdminAuthError);
});

test('login with an unknown email fails with the same generic error as a known email/wrong password', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const wrongCode = computeTotp(admin.secret, harness.now().getTime());
  const unknownError = await harness.authService.login('nobody@example.test', 'anything', '123456').catch((e) => e);
  const wrongPasswordError = await harness.authService.login(admin.email, 'wrong password', wrongCode).catch((e) => e);
  assert.equal(unknownError.code, 'UNAUTHORIZED');
  assert.equal(unknownError.message, wrongPasswordError.message);
});

test('login with MFA status PENDING_SETUP always fails, even with a technically-correct-looking code and correct password', async () => {
  const harness = buildHarness();
  const email = `pending-${randomUUID()}@example.test`;
  const password = 'correct horse battery staple';
  // createAccount seeds PENDING_SETUP by design -- no override.
  await harness.accountService.createAccount('Pending MFA Admin', hashAdminEmail(email), password, 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(() => harness.authService.login(email, password, '123456'), PlatformAdminAuthError);
});

test('login with MFA status DISABLED always fails', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  harness.repository._setMfaStateForTest(admin.adminId, { status: 'DISABLED', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: harness.now() });
  const code = computeTotp(admin.secret, harness.now().getTime());
  await assert.rejects(() => harness.authService.login(admin.email, admin.password, code), PlatformAdminAuthError);
});

test('lockout: 5 failed attempts within the window lock out a 6th attempt even with the correct password+code', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  for (let i = 0; i < 5; i++) {
    await harness.authService.login(admin.email, 'wrong password', '000000').catch(() => {});
    harness.clock.advance(1000);
  }
  const code = computeTotp(admin.secret, harness.now().getTime());
  await assert.rejects(() => harness.authService.login(admin.email, admin.password, code), PlatformAdminAuthError);
});

test('lockout alert: a failed login on an APP_OWNER account notifies other app owners; SUPPORT_ADMIN failures do not', async () => {
  const harness = buildHarness();
  const owner = await createLoginableAdmin(harness, { role: 'APP_OWNER' });
  await harness.authService.login(owner.email, 'wrong', '000000').catch(() => {});
  assert.equal(harness.alertPort.events.length, 1);
  assert.equal(harness.alertPort.events[0].kind, 'LOGIN_FAILED');

  const support = await createLoginableAdmin(harness, { role: 'SUPPORT_ADMIN' });
  await harness.authService.login(support.email, 'wrong', '000000').catch(() => {});
  assert.equal(harness.alertPort.events.length, 1); // unchanged
});

test('every login (success or failure) writes exactly one audit event of the correct type, and metadata never contains the raw password or raw TOTP code', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const secretPassword = admin.password;
  const code = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.login(admin.email, secretPassword, code);
  await harness.authService.login(admin.email, 'definitely-wrong-password', '999999').catch(() => {});

  const relevant = harness.repository._auditEvents.filter((e) => e.eventType === 'ADMIN_LOGIN' || e.eventType === 'ADMIN_LOGIN_FAILED');
  assert.equal(relevant.length, 2);
  for (const event of harness.repository._auditEvents) {
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes(secretPassword), false);
    assert.equal(serialized.includes(code), false);
  }
});

test('validateSession: unknown, malformed, missing-prefix tokens all rejected with the same generic error', async () => {
  const harness = buildHarness();
  const unknown = await harness.authService.validateSession('pa_' + 'A'.repeat(43)).catch((e) => e);
  const malformed = await harness.authService.validateSession('not-a-token').catch((e) => e);
  const wrongRealm = await harness.authService.validateSession('A'.repeat(43)).catch((e) => e); // family-plane shape
  assert.equal(unknown.code, 'UNAUTHORIZED');
  assert.equal(unknown.message, malformed.message);
  assert.equal(unknown.message, wrongRealm.message);
});

test('validateSession: a valid session resolves adminId and active roles; an expired session is rejected', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken, expiresAt } = await harness.authService.login(admin.email, admin.password, code);

  const identity = await harness.authService.validateSession(rawToken);
  assert.equal(identity.adminId, admin.adminId);
  assert.ok(identity.roles.includes('APP_OWNER'));

  harness.clock.set(expiresAt.getTime());
  await assert.rejects(() => harness.authService.validateSession(rawToken), PlatformAdminAuthError);
});

test('validateSession: a revoked session is rejected, indistinguishable from unknown', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  await harness.authService.logout(rawToken);
  await assert.rejects(() => harness.authService.validateSession(rawToken), PlatformAdminAuthError);
});

test('logout is idempotent and safe on an unknown token', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  await harness.authService.logout(rawToken);
  await assert.doesNotReject(() => harness.authService.logout(rawToken));
  await assert.doesNotReject(() => harness.authService.logout('pa_' + 'Z'.repeat(43)));
});

test('role removed while a session is active forces that session to be revoked', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness, { role: 'PLATFORM_ADMIN' });
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  await harness.authService.validateSession(rawToken); // valid before revoke

  await harness.accountService.revokeRole(admin.adminId, 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(() => harness.authService.validateSession(rawToken), PlatformAdminAuthError);
});

test('disabling an account forces every active session to be revoked', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  await harness.authService.validateSession(rawToken);

  await harness.accountService.disableAccount(admin.adminId, 'BOOTSTRAP');
  await assert.rejects(() => harness.authService.validateSession(rawToken), PlatformAdminAuthError);
});

test('revokeAllSessions revokes every active session for the admin', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code1 = computeTotp(admin.secret, harness.now().getTime());
  const first = await harness.authService.login(admin.email, admin.password, code1);
  harness.clock.advance(1000);
  const code2 = computeTotp(admin.secret, harness.now().getTime());
  const second = await harness.authService.login(admin.email, admin.password, code2);

  const result = await harness.authService.revokeAllSessions(admin.adminId, { adminId: admin.adminId, roles: ['APP_OWNER'] });
  assert.equal(result.revokedSessionCount, 2);
  await assert.rejects(() => harness.authService.validateSession(first.rawToken), PlatformAdminAuthError);
  await assert.rejects(() => harness.authService.validateSession(second.rawToken), PlatformAdminAuthError);
});

test('step-up: absent step-up id is rejected generically', async () => {
  const harness = buildHarness();
  await assert.rejects(
    () => harness.authService.consumeStepUp(randomUUID(), randomUUID(), randomUUID(), 'REFUND'),
    PlatformAdminAuthError,
  );
});

test('step-up: assertStepUp with a correct live TOTP grants a step-up; consumeStepUp accepts it exactly once', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  const identity = await harness.authService.validateSession(rawToken);

  const stepUpCode = computeTotp(admin.secret, harness.now().getTime());
  const stepUp = await harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', stepUpCode, 'APP_OWNER');
  await assert.doesNotReject(() => harness.authService.consumeStepUp(stepUp.stepUpId, admin.adminId, identity.sessionId, 'REFUND'));
});

test('step-up: already-consumed cannot be reused even though it has not expired', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  const identity = await harness.authService.validateSession(rawToken);
  const stepUpCode = computeTotp(admin.secret, harness.now().getTime());
  const stepUp = await harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', stepUpCode, 'APP_OWNER');
  await harness.authService.consumeStepUp(stepUp.stepUpId, admin.adminId, identity.sessionId, 'REFUND');
  await assert.rejects(
    () => harness.authService.consumeStepUp(stepUp.stepUpId, admin.adminId, identity.sessionId, 'REFUND'),
    PlatformAdminAuthError,
  );
});

test('step-up: expired grant is rejected', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  const identity = await harness.authService.validateSession(rawToken);
  const stepUpCode = computeTotp(admin.secret, harness.now().getTime());
  const stepUp = await harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', stepUpCode, 'APP_OWNER');
  harness.clock.advance(6 * 60 * 1000); // beyond the 5-minute step-up TTL
  await assert.rejects(
    () => harness.authService.consumeStepUp(stepUp.stepUpId, admin.adminId, identity.sessionId, 'REFUND'),
    PlatformAdminAuthError,
  );
});

test('step-up: asserted for REFUND cannot be consumed against a different scope', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  const identity = await harness.authService.validateSession(rawToken);
  const stepUpCode = computeTotp(admin.secret, harness.now().getTime());
  const stepUp = await harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', stepUpCode, 'APP_OWNER');
  await assert.rejects(
    () => harness.authService.consumeStepUp(stepUp.stepUpId, admin.adminId, identity.sessionId, 'SETTLEMENT_BANK_CONFIG'),
    PlatformAdminAuthError,
  );
});

test('step-up: wrong TOTP code is denied generically and writes ADMIN_STEP_UP_DENIED', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  const identity = await harness.authService.validateSession(rawToken);
  await assert.rejects(
    () => harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', '000000', 'APP_OWNER'),
    PlatformAdminAuthError,
  );
  const denied = harness.repository._auditEvents.filter((e) => e.eventType === 'ADMIN_STEP_UP_DENIED');
  assert.equal(denied.length, 1);
});
