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

// PCA-ADMIN-TIMING-1 regression: an unknown email (or a known email whose
// account isn't ACTIVE) must pay roughly the same scrypt cost as a known
// ACTIVE account with a wrong password, so response latency can never be
// used to enumerate which admin emails exist. Before the fix, the unknown
// branch returned almost immediately (no password hashing at all) while
// the known branch paid the full ~100ms+ scrypt cost -- a clear, measurable
// timing oracle on the platform's highest-privilege accounts. Uses the
// median of several trials and a generous threshold to stay robust against
// scheduler jitter while still failing hard on pre-fix code (which is
// roughly 10-50x faster, not just modestly faster).
test('login timing: unknown email pays the same real password-hashing cost as a known account with a wrong password', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const wrongCode = computeTotp(admin.secret, harness.now().getTime());

  async function medianDurationMs(run, trials = 5) {
    const durations = [];
    for (let i = 0; i < trials; i++) {
      const start = process.hrtime.bigint();
      await run();
      durations.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    durations.sort((a, b) => a - b);
    return durations[Math.floor(durations.length / 2)];
  }

  const unknownEmailMs = await medianDurationMs(() =>
    harness.authService.login(`nobody-${randomUUID()}@example.test`, 'anything', '123456').catch(() => {}),
  );
  const wrongPasswordMs = await medianDurationMs(() =>
    harness.authService.login(admin.email, 'wrong password', wrongCode).catch(() => {}),
  );

  // Both branches must actually run a real scrypt hash (~100ms+ at this
  // module's cost parameters in this environment) -- an absolute floor
  // catches the fix being silently reverted even if relative timing is
  // noisy in a particular CI environment.
  assert.ok(unknownEmailMs > 30, `expected unknown-email login to pay real hashing cost, got ${unknownEmailMs}ms`);
  // And the two branches must be within the same order of magnitude of
  // each other -- the actual regression this test exists to catch.
  assert.ok(
    unknownEmailMs > wrongPasswordMs * 0.4,
    `expected unknown-email (${unknownEmailMs}ms) to cost roughly as much as known-email-wrong-password (${wrongPasswordMs}ms)`,
  );
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
  // Advance a full TOTP step (not just a millisecond) so the second code is
  // a genuinely distinct, not-yet-claimed HOTP counter -- see TOTP-REPLAY-1:
  // the same code can no longer be accepted twice.
  harness.clock.advance(30_000);
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

  // Advance a full TOTP step so the step-up code is a fresh, not-yet-claimed
  // counter -- TOTP-REPLAY-1's shared per-admin counter means the exact code
  // just consumed at login can never be re-presented for step-up.
  harness.clock.advance(30_000);
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
  harness.clock.advance(30_000);
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
  harness.clock.advance(30_000);
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
  harness.clock.advance(30_000);
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

// TOTP-REPLAY-1: the same 6-digit code can never be accepted twice, even
// though it remains time-valid for its whole ±1-step clock-skew window.
// See backend/src/platformadmin/auth/totp.ts's verifyTotp (now returns the
// matched absolute HOTP counter, not a boolean) and
// AuthRepository.claimTotpCounter (the durable, guarded CAS this replay
// defense is built on).

test('TOTP replay: the SAME code presented again immediately afterward is rejected as a replay on a second LOGIN attempt', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.login(admin.email, admin.password, code); // first use succeeds
  await assert.rejects(
    () => harness.authService.login(admin.email, admin.password, code), // same code, same request shape, still within its time-valid window
    PlatformAdminAuthError,
  );
});

test('TOTP replay: the SAME code presented again immediately afterward is rejected as a replay on a second STEP-UP attempt', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const loginCode = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, loginCode);
  const identity = await harness.authService.validateSession(rawToken);

  harness.clock.advance(30_000);
  const stepUpCode = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', stepUpCode, 'APP_OWNER'); // first use succeeds
  await assert.rejects(
    () => harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'ADMIN_ROLE_GRANT', stepUpCode, 'APP_OWNER'), // same code again
    PlatformAdminAuthError,
  );
});

test('TOTP replay: a code consumed at LOGIN cannot subsequently be reused for a STEP-UP call', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, code);
  const identity = await harness.authService.validateSession(rawToken);
  // No clock advance: the step-up code computed "now" is bit-for-bit the
  // same code login already claimed the counter for.
  await assert.rejects(
    () => harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', code, 'APP_OWNER'),
    PlatformAdminAuthError,
  );
});

test('TOTP replay: a code consumed at STEP-UP cannot subsequently be reused for a later LOGIN', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const loginCode = computeTotp(admin.secret, harness.now().getTime());
  const { rawToken } = await harness.authService.login(admin.email, admin.password, loginCode);
  const identity = await harness.authService.validateSession(rawToken);

  harness.clock.advance(30_000);
  const stepUpCode = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.assertStepUp(admin.adminId, identity.sessionId, 'REFUND', stepUpCode, 'APP_OWNER');

  // Same instant, same counter -- attempting to log in again with the
  // exact code just consumed by step-up must fail.
  await assert.rejects(
    () => harness.authService.login(admin.email, admin.password, stepUpCode),
    PlatformAdminAuthError,
  );
});

test('TOTP replay: an OLDER already-accepted counter is rejected even if presented alone afterward', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const olderCode = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.login(admin.email, admin.password, olderCode);

  harness.clock.advance(60_000); // two full steps forward
  // Presenting the OLD (already-accepted, now clock-skew-stale) code again
  // must still fail -- both because it is out of the ±1 window by now AND
  // because it was already claimed.
  await assert.rejects(
    () => harness.authService.login(admin.email, admin.password, olderCode),
    PlatformAdminAuthError,
  );
});

test('TOTP replay: the NEXT valid, not-yet-accepted counter succeeds normally after time advances', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const firstCode = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.login(admin.email, admin.password, firstCode);

  harness.clock.advance(30_000); // exactly one TOTP step forward
  const nextCode = computeTotp(admin.secret, harness.now().getTime());
  await assert.doesNotReject(() => harness.authService.login(admin.email, admin.password, nextCode));
});

test('TOTP replay: an unused-but-clock-skew-valid ADJACENT counter (current step + 1) is still correctly accepted -- replay-prevention has not over-tightened clock skew', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const currentStepCode = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.login(admin.email, admin.password, currentStepCode);

  // Still "now" (no clock advance) -- but a code for the ADJACENT (+1) step,
  // which verifyTotp's ±1 skew window accepts and which was never itself
  // claimed, must succeed on its own login attempt.
  const adjacentCode = computeTotp(admin.secret, harness.now().getTime(), 1);
  await assert.doesNotReject(() => harness.authService.login(admin.email, admin.password, adjacentCode));
});

test('TOTP replay: re-instantiating the service against the SAME repository still correctly rejects a previously-accepted counter (state lives in the repository, not the service object)', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const code = computeTotp(admin.secret, harness.now().getTime());
  await harness.authService.login(admin.email, admin.password, code);

  const freshAuthService = new (harness.authService.constructor)(harness.repository, harness.alertPort, harness.now);
  await assert.rejects(
    () => freshAuthService.login(admin.email, admin.password, code),
    PlatformAdminAuthError,
  );
});

test('TOTP replay: claimTotpCounter concurrency -- of N simultaneous claims of the SAME counter, exactly one succeeds', async () => {
  const harness = buildHarness();
  const admin = await createLoginableAdmin(harness);
  const counter = 42;
  const results = await Promise.all(
    Array.from({ length: 10 }, () => harness.repository.claimTotpCounter(admin.adminId, counter)),
  );
  assert.equal(results.filter((r) => r === true).length, 1);
  assert.equal(results.filter((r) => r === false).length, 9);
});
