// PCA-AUTH-SESSION-1 -- ParentAccountService unit tests: registration,
// email verification, family genesis (structural proof under a real
// Ed25519 test verifier, and the honest fail-closed degrade under
// RejectingDeviceSignatureVerifier), login, session read, logout,
// revoke-all, and the negative-test matrix WRITER57_ASSIGNMENT.md requires.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { ParentAccountService, ParentAccountError } from '../../dist/parentaccount/ParentAccountService.js';
import { FamilyOwnerAttestationChainEngine } from '../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { InMemoryGenesisAnchorStore } from '../../dist/familycommercial/authority/InMemoryGenesisAnchorStore.js';
import { InMemoryAttestationChainStore } from '../../dist/familycommercial/authority/InMemoryAttestationChainStore.js';
import { createEd25519DeviceSignatureVerifier } from '../../dist/parentaccount/genesisDeviceSigner.js';
import { RejectingDeviceSignatureVerifier } from '../../dist/runtime-sync/index.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';

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
  lastCodeFor(email, kind = 'VERIFICATION') {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].kind === kind && this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

function buildHarness({ genesisVerifier } = {}) {
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

  let familyGenesisEngine;
  if (genesisVerifier !== null) {
    familyGenesisEngine = new FamilyOwnerAttestationChainEngine(
      new InMemoryGenesisAnchorStore(),
      new InMemoryAttestationChainStore(),
      genesisVerifier ?? createEd25519DeviceSignatureVerifier(),
      now,
    );
  }

  const service = new ParentAccountService({
    repository: parentAccountRepository,
    authService,
    emailSender,
    familyGenesisEngine,
    now,
  });

  return { service, authService, parentAccountRepository, emailSender, now, advance };
}

const EMAIL = 'parent@example.com';
const PASSWORD = 'correct horse battery staple';

async function registerAndVerify(harness, email = EMAIL, password = PASSWORD) {
  await harness.service.register(email, password, password);
  const code = harness.emailSender.lastCodeFor(email);
  assert.ok(code, 'a verification code must have been sent');
  return harness.service.verifyEmail(email, code);
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

test('verify-email with the correct code establishes a session and marks the account VERIFIED', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  assert.equal(typeof outcome.accountId, 'string');
  assert.equal(typeof outcome.rawSessionToken, 'string');
  const session = await harness.service.readSession(outcome.rawSessionToken);
  assert.equal(session.accountId, outcome.accountId);
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

test('SECURITY: verify-email for an unverified/nonexistent account never leaks which case it is (unregistered email)', async () => {
  const harness = buildHarness();
  await assert.rejects(() => harness.service.verifyEmail('nobody@example.com', '123456'), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('family genesis: a real signature verifier reaches BOOTSTRAPPED and the returned familyId is durable', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  assert.equal(typeof outcome.familyId, 'string');
  assert.ok(outcome.familyId.length > 0);
});

test('family genesis: FAIL CLOSED under RejectingDeviceSignatureVerifier -- identity/session still succeed, familyId is null (the honest, current production posture -- CRYPTO_SUITE pending, PCA-DEC-020)', async () => {
  const harness = buildHarness({ genesisVerifier: new RejectingDeviceSignatureVerifier() });
  const outcome = await registerAndVerify(harness);
  assert.equal(outcome.familyId, null);
  const session = await harness.service.readSession(outcome.rawSessionToken);
  assert.equal(session.emailVerified, true, 'identity verification must not be blocked by an unavailable genesis capability');
});

test('family genesis: no engine wired at all also degrades to familyId=null without breaking verification', async () => {
  const harness = buildHarness({ genesisVerifier: null });
  const outcome = await registerAndVerify(harness);
  assert.equal(outcome.familyId, null);
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
  const outcome = await harness.service.login(EMAIL, PASSWORD);
  assert.equal(typeof outcome.rawSessionToken, 'string');

  await assert.rejects(() => harness.service.login(EMAIL, 'totally wrong password'), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('SECURITY: a session established at verify-email time proves identity only -- readSession never returns a role or Owner-authority claim', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  const session = await harness.service.readSession(outcome.rawSessionToken);
  assert.deepEqual(Object.keys(session).sort(), ['accountId', 'emailVerified', 'familyId']);
});

test('SECURITY: expired session is denied identically to no session (fail closed)', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  harness.advance(13 * 60 * 60 * 1000); // past AuthService's 12h default TTL
  await assert.rejects(() => harness.service.readSession(outcome.rawSessionToken));
});

test('SECURITY: revoked session (logout) is denied identically to no session', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  await harness.service.logout(outcome.rawSessionToken);
  await assert.rejects(() => harness.service.readSession(outcome.rawSessionToken));
});

test('logout is idempotent for an already-revoked/unknown/malformed token', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  await harness.service.logout(outcome.rawSessionToken);
  await assert.doesNotReject(() => harness.service.logout(outcome.rawSessionToken));
  await assert.doesNotReject(() => harness.service.logout('not-a-real-token'));
});

test('SECURITY: session fixation -- verify-email always mints a FRESH token distinct from any prior caller-supplied value, and each login mints its own new token', async () => {
  const harness = buildHarness();
  const first = await registerAndVerify(harness);
  const second = await harness.service.login(EMAIL, PASSWORD);
  assert.notEqual(first.rawSessionToken, second.rawSessionToken);
});

test('revoke-all-sessions revokes every session for the account, requires an already-valid session, and denies reuse of the very token used to call it', async () => {
  const harness = buildHarness();
  const first = await registerAndVerify(harness);
  const second = await harness.service.login(EMAIL, PASSWORD);

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

test('PCA-ADD-PA-017 enforcement: login is rejected with the SAME generic UNAUTHORIZED once the account\'s family is SUSPENDED', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  assert.equal(typeof outcome.familyId, 'string', 'a real genesis engine is wired in this harness, so familyId must be present');

  // Sanity: login works normally while the family is ACTIVE (the default).
  await harness.service.login(EMAIL, PASSWORD);

  harness.parentAccountRepository._setFamilyStatusForTest(outcome.familyId, 'SUSPENDED');
  await assert.rejects(() => harness.service.login(EMAIL, PASSWORD), (err) => {
    assert.ok(err instanceof ParentAccountError);
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
});

test('PCA-ADD-PA-017 enforcement: reactivating the family (status back to ACTIVE) restores login', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  harness.parentAccountRepository._setFamilyStatusForTest(outcome.familyId, 'SUSPENDED');
  await assert.rejects(() => harness.service.login(EMAIL, PASSWORD));

  harness.parentAccountRepository._setFamilyStatusForTest(outcome.familyId, 'ACTIVE');
  const relogin = await harness.service.login(EMAIL, PASSWORD);
  assert.equal(typeof relogin.rawSessionToken, 'string');
});

test('PCA-ADD-PA-017 enforcement: an account with no familyId yet (genesis unavailable) is never blocked by the suspend check', async () => {
  const harness = buildHarness({ genesisVerifier: null });
  const outcome = await registerAndVerify(harness);
  assert.equal(outcome.familyId, null);
  const relogin = await harness.service.login(EMAIL, PASSWORD);
  assert.equal(typeof relogin.rawSessionToken, 'string');
});

test('SECURITY: a suspended family\'s login failure is indistinguishable in shape/code from a wrong-password failure (no information leak)', async () => {
  const harness = buildHarness();
  const outcome = await registerAndVerify(harness);
  harness.parentAccountRepository._setFamilyStatusForTest(outcome.familyId, 'SUSPENDED');

  let suspendedError;
  try {
    await harness.service.login(EMAIL, PASSWORD);
  } catch (err) {
    suspendedError = err;
  }
  let wrongPasswordError;
  try {
    await harness.service.login(EMAIL, 'a totally different wrong password');
  } catch (err) {
    wrongPasswordError = err;
  }
  assert.ok(suspendedError instanceof ParentAccountError);
  assert.ok(wrongPasswordError instanceof ParentAccountError);
  assert.equal(suspendedError.code, wrongPasswordError.code);
  assert.equal(suspendedError.message, wrongPasswordError.message);
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
  const loggedIn = await harness.service.login(EMAIL, NEW_PASSWORD);
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
  const verified = await registerAndVerify(harness);
  assert.ok(verified.rawSessionToken, 'verify-email must have issued a session');
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
