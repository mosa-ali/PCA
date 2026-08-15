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
    this.sent.push({ email, code });
  }
  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
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
