process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import test from 'node:test';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import {
  base32Decode,
  base32Encode,
  computeTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
} from '../../dist/platformadmin/auth/totp.js';
import { NOOP_ACTIVATION_DIAGNOSTICS } from '../../dist/platformadmin/auth/activationDiagnostics.js';
import {
  PlatformAdminActivationError,
  PlatformAdminActivationService,
} from '../../dist/platformadmin/auth/PlatformAdminActivationService.js';

// Stage diagnostics exist so an activation failure is diagnosable without
// reading the database by hand -- which is what recovering from the real
// production incident in this area required. The risk they introduce is that a
// debug channel becomes the new place a TOTP secret leaks, so these tests treat
// the diagnostic output as untrusted and assert on it directly.

const ACTIVE_HEX = 'ab'.repeat(32);
const PREVIOUS_1_HEX = 'cd'.repeat(32);
const GOOD_ENV = {
  NODE_ENV: 'test',
  PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL: 'https://www.pcasafe.com/platform-admin/activate',
  PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
};

/** The ONLY fields a diagnostic is allowed to emit. */
const ALLOWED_FIELDS = new Set(['stage', 'outcome', 'reason', 'keySource', 'repaired']);

function harness({ env = GOOD_ENV, casResult = true, completeResult = true, diagnostics, omitSink = false } = {}) {
  const email = 'mdrwesh@outlook.com';
  const account = { adminId: 'admin-1', emailHash: hashAdminEmail(email), displayName: 'Owner', passwordCredential: 'placeholder', status: 'ACTIVE', createdAt: new Date(), disabledAt: null };
  const mfa = { adminId: 'admin-1', status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: new Date(), lastAcceptedTotpCounter: null };
  const tokens = new Map();
  const auth = { findAccountById: async () => account, findActiveRoles: async () => ['PLATFORM_ADMIN'], getMfaState: async () => mfa };
  const casCalls = [];
  const repo = {
    issue: async (input) => { for (const t of tokens.values()) if (t.adminId === input.adminId && !t.usedAt && !t.revokedAt) t.revokedAt = input.createdAt; mfa.totpSecretCiphertext = null; mfa.totpSecretNonce = null; mfa.lastAcceptedTotpCounter = null; tokens.set(input.tokenHash, { ...input, usedAt: null, revokedAt: null }); },
    findUsable: async (hash, now) => { const t = tokens.get(hash); if (!t || t.usedAt || t.revokedAt || t.expiresAt <= now) return null; return { token: t, account, mfa }; },
    beginMfa: async (input) => { const t = tokens.get(input.tokenHash); if (!t) return null; mfa.totpSecretCiphertext = input.ciphertext; mfa.totpSecretNonce = input.nonce; return { token: t, account, mfa }; },
    complete: async (input) => { if (!completeResult) return false; const t = tokens.get(input.tokenHash); if (!t || t.usedAt) return false; account.passwordCredential = input.passwordCredential; mfa.status = 'ACTIVE'; mfa.lastAcceptedTotpCounter = input.acceptedTotpCounter; t.usedAt = input.now; return true; },
    compareAndSwapMfaSecretCiphertext: async (input) => { casCalls.push(input); if (!casResult) return false; mfa.totpSecretCiphertext = input.ciphertext; mfa.totpSecretNonce = input.nonce; return true; },
  };
  const sent = [];
  const emailSender = { sendVerificationCode: async () => {}, sendPasswordResetCode: async () => {}, sendPlatformAdminActivationLink: async (toEmail, url) => sent.push({ toEmail, url }) };
  let now = new Date('2026-01-01T00:00:00Z');
  const captured = [];
  const sink = diagnostics ?? { stage: (stage, outcome, detail) => captured.push({ stage, outcome, ...detail }) };
  const service = omitSink
    ? new PlatformAdminActivationService(auth, repo, emailSender, env, () => now)
    : new PlatformAdminActivationService(auth, repo, emailSender, env, () => now, sink);
  return { service, account, mfa, tokens, sent, captured, casCalls, now: () => now };
}

async function issueToken(h) {
  await h.service.issueActivation('admin-1', 'mdrwesh@outlook.com', { adminId: 'owner-1', roles: ['APP_OWNER'] });
  return new URL(h.sent[h.sent.length - 1].url).searchParams.get('token');
}

test('a successful activation emits bounded stages, and NO secret material appears in any of them', async () => {
  const h = harness();
  const token = await issueToken(h);
  const started = await h.service.start(token);
  const secret = base32Decode(new URL(started.otpauthUri).searchParams.get('secret'));
  const code = computeTotp(secret, h.now().getTime());
  await h.service.complete(token, 'a new owner password', code);

  const stages = h.captured.map((d) => `${d.stage}:${d.outcome}`);
  assert.ok(stages.includes('ACTIVATION_START:OK'));
  assert.ok(stages.includes('MFA_SECRET_DECRYPT:OK'));
  assert.ok(stages.includes('MFA_CODE_VERIFICATION:OK'));
  assert.ok(stages.includes('ACTIVATION_COMPLETE:OK'));

  // The decrypt stage names the key GENERATION (non-secret), never the key.
  assert.equal(h.captured.find((d) => d.stage === 'MFA_SECRET_DECRYPT').keySource, 'ACTIVE');

  // Closure: every field ever emitted comes from the allowed set.
  for (const d of h.captured) {
    for (const key of Object.keys(d)) assert.ok(ALLOWED_FIELDS.has(key), `unexpected diagnostic field ${key}`);
  }

  // And no emitted VALUE carries any of this flow's secrets. Checked against the
  // serialized output rather than field-by-field, so a secret smuggled into an
  // unexpected position is still caught.
  const serialized = JSON.stringify(h.captured);
  for (const secretValue of [token, started.otpauthUri, ACTIVE_HEX, base32Encode(secret), code, 'a new owner password']) {
    assert.ok(!serialized.includes(secretValue), `secret material leaked into diagnostics: ${secretValue.slice(0, 8)}…`);
  }
});

test('a THROWING diagnostics sink cannot alter either a success or a rejection', async () => {
  const throwing = { stage: () => { throw new Error('sink exploded'); } };

  // Success path still succeeds.
  const h = harness({ diagnostics: throwing });
  const token = await issueToken(h);
  const started = await h.service.start(token);
  const secret = base32Decode(new URL(started.otpauthUri).searchParams.get('secret'));
  await assert.doesNotReject(() => h.service.complete(token, 'a new owner password', computeTotp(secret, h.now().getTime())));
  assert.equal(h.mfa.status, 'ACTIVE');

  // Rejection path still rejects with the ORIGINAL error class, not the sink's.
  const h2 = harness({ diagnostics: throwing });
  await assert.rejects(
    () => h2.service.start('not-a-valid-token-shape'),
    (error) => error instanceof PlatformAdminActivationError,
  );
});

test('a key ring configuration failure is reported as such, and still fails closed', async () => {
  const h = harness({ env: { ...GOOD_ENV, PLATFORM_ADMIN_MFA_ENC_KEY: undefined } });
  const token = await issueToken(h);
  await assert.rejects(() => h.service.start(token));
  const reported = h.captured.find((d) => d.stage === 'MFA_KEYRING_CONFIGURATION');
  assert.equal(reported?.outcome, 'FAILED');
  assert.equal(reported?.reason, 'KEYRING_MISCONFIGURED');
  // Fail-closed is unchanged: no enrollment material was written.
  assert.equal(h.mfa.totpSecretCiphertext, null);
});

test('a malformed configured legacy key is a configuration failure, never silently skipped', async () => {
  const h = harness({ env: { ...GOOD_ENV, PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: 'not-hex' } });
  const token = await issueToken(h);
  // start() validates the FULL ring before sealing, so the malformed slot is
  // refused HERE -- before any enrollment is persisted -- rather than surfacing
  // later in complete() with the enrollment already burned. This was a real
  // defect: validating only the active key let start() succeed, hand out a QR,
  // and burn the enrollment.
  await assert.rejects(() => h.service.start(token));
  const reported = h.captured.find((d) => d.stage === 'MFA_KEYRING_CONFIGURATION');
  assert.equal(reported?.outcome, 'FAILED');
  assert.equal(reported?.reason, 'KEYRING_MISCONFIGURED');
  // Nothing was sealed, so the operator can fix the configuration and retry the
  // SAME activation link.
  assert.equal(h.mfa.totpSecretCiphertext, null);
});

test('a wrong code and an unreadable secret are distinguished, where they used to be identical', async () => {
  const h = harness();
  const token = await issueToken(h);
  const started = await h.service.start(token);
  const secret = base32Decode(new URL(started.otpauthUri).searchParams.get('secret'));
  const correct = computeTotp(secret, h.now().getTime());
  await assert.rejects(() => h.service.complete(token, 'a new owner password', correct === '000000' ? '111111' : '000000'));
  assert.ok(h.captured.some((d) => d.stage === 'MFA_CODE_VERIFICATION' && d.outcome === 'REJECTED' && d.reason === 'INVALID_CODE'));

  // Now make the secret unreadable by sealing it under a key that is neither the
  // active key nor any configured previous generation.
  const h2 = harness();
  const token2 = await issueToken(h2);
  await h2.service.start(token2);
  const unknown = encryptTotpSecret(generateTotpSecret(), Buffer.from('11'.repeat(32), 'hex'));
  h2.mfa.totpSecretCiphertext = unknown.ciphertext;
  h2.mfa.totpSecretNonce = unknown.nonce;
  await assert.rejects(() => h2.service.complete(token2, 'a new owner password', '123456'));
  const decryptFailure = h2.captured.find((d) => d.stage === 'MFA_SECRET_DECRYPT');
  assert.equal(decryptFailure?.outcome, 'FAILED');
  assert.equal(decryptFailure?.reason, 'NO_PERMITTED_KEY');
  // Crucially NOT reported as a bad code, which is exactly how this presented
  // to an operator before.
  assert.ok(!h2.captured.some((d) => d.stage === 'MFA_CODE_VERIFICATION'));
});

test('a refused persistence write is an infrastructure failure, not a bad code', async () => {
  const h = harness({ completeResult: false });
  const token = await issueToken(h);
  const started = await h.service.start(token);
  const secret = base32Decode(new URL(started.otpauthUri).searchParams.get('secret'));
  await assert.rejects(() => h.service.complete(token, 'a new owner password', computeTotp(secret, h.now().getTime())));
  // The code verified -- the write is what was refused.
  assert.ok(h.captured.some((d) => d.stage === 'MFA_CODE_VERIFICATION' && d.outcome === 'OK'));
  assert.ok(h.captured.some((d) => d.stage === 'MFA_PERSISTENCE' && d.outcome === 'FAILED' && d.reason === 'PERSISTENCE_REFUSED'));
});

test('a legacy-sealed pending secret activates through the bounded fallback, and a LOST repair race is benign', async () => {
  const env = { ...GOOD_ENV, PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX };

  for (const casResult of [true, false]) {
    const h = harness({ env, casResult });
    const token = await issueToken(h);
    await h.service.start(token);
    // Replace the active-sealed pending secret with one sealed under PREVIOUS_1,
    // exactly as a rotation between `start` and `complete` leaves it.
    const secret = generateTotpSecret();
    const legacy = encryptTotpSecret(secret, Buffer.from(PREVIOUS_1_HEX, 'hex'));
    h.mfa.totpSecretCiphertext = legacy.ciphertext;
    h.mfa.totpSecretNonce = legacy.nonce;

    await h.service.complete(token, 'a new owner password', computeTotp(secret, h.now().getTime()));

    // The activation SUCCEEDS either way: losing the repair race is not a failure.
    assert.equal(h.mfa.status, 'ACTIVE');
    assert.equal(h.captured.find((d) => d.stage === 'MFA_SECRET_DECRYPT')?.keySource, 'PREVIOUS_1');
    assert.equal(h.captured.find((d) => d.stage === 'MFA_READ_REPAIR')?.repaired, casResult);
    assert.ok(h.captured.some((d) => d.stage === 'ACTIVATION_COMPLETE' && d.outcome === 'OK'));

    if (casResult) {
      // Repair won: the row now opens with the ACTIVE key alone, which is what
      // makes PREVIOUS_1 retirable.
      assert.deepEqual(decryptTotpSecret(h.mfa.totpSecretCiphertext, h.mfa.totpSecretNonce, Buffer.from(ACTIVE_HEX, 'hex')), secret);
    } else {
      // Repair lost: the row is untouched, which is expected and harmless.
      assert.deepEqual(h.mfa.totpSecretCiphertext, legacy.ciphertext);
    }
  }
});

test('the no-op sink discards everything without throwing', () => {
  assert.equal(NOOP_ACTIVATION_DIAGNOSTICS.stage('ACTIVATION_START', 'OK'), undefined);
  assert.equal(NOOP_ACTIVATION_DIAGNOSTICS.stage('MFA_KEYRING_CONFIGURATION', 'FAILED', { reason: 'KEYRING_MISCONFIGURED' }), undefined);
});

test('a service constructed WITHOUT a sink emits nothing: the default is the no-op sink, not the console one', async () => {
  // console.warn writes to stderr, so intercepting stderr detects the console
  // sink. This is the runtime check for the default, which the closed TypeScript
  // detail shape cannot assert on its own.
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const h = harness({ omitSink: true });
    const token = await issueToken(h);
    // A successful start emits ACTIVATION_START:OK when a sink is wired at all.
    await h.service.start(token);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.ok(
    !writes.some((line) => line.includes('PLATFORM_ADMIN_ACTIVATION')),
    'constructing the service must not emit operational diagnostics by default',
  );
});
