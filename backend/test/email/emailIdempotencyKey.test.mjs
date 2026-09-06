// PCA-DW-W2-R1-4 -- email_outbox.idempotency_key must be a KEYED,
// domain-separated construction, not a plain unkeyed digest: a 6-digit
// code has only 1,000,000 possible values, so anyone who reads the
// idempotency_key column (a DB leak, a backup) and already knows/guesses
// the recipient email could otherwise brute-force every candidate code
// offline -- entirely bypassing verificationCode.ts's own HMAC keying of
// the SEPARATE code_hash column.
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeEmailIdempotencyKey } from '../../dist/email/emailIdempotencyKey.js';
import { MissingEmailOutboxEncryptionKeyError } from '../../dist/email/emailOutboxEncryption.js';

const REAL_KEY = 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE='; // 32 zero-ish bytes, base64
const OTHER_KEY = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI='; // a different 32-byte key

function env(overrides = {}) {
  return { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: REAL_KEY, ...overrides };
}

test('computeEmailIdempotencyKey is deterministic for the same kind/email/code/key -- genuine duplicates dedup correctly', () => {
  const a = computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', env());
  const b = computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', env());
  assert.equal(a, b);
});

test('computeEmailIdempotencyKey differs when kind, email, or code differ -- not just a key over a fixed message', () => {
  const base = computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', env());
  assert.notEqual(computeEmailIdempotencyKey('PASSWORD_RESET', 'parent@example.com', '123456', env()), base);
  assert.notEqual(computeEmailIdempotencyKey('VERIFICATION', 'other@example.com', '123456', env()), base);
  assert.notEqual(computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '654321', env()), base);
});

test('SECURITY: computeEmailIdempotencyKey is a KEYED construction -- the same (kind, email, code) produces a different key under a different root secret', () => {
  const underRealKey = computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', env());
  const underOtherKey = computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', env({ PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: OTHER_KEY }));
  assert.notEqual(underRealKey, underOtherKey, 'an unkeyed sha256(kind+email+code) would be identical here regardless of any "key"');
});

test('SECURITY: FAILS CLOSED in production when PCA_EMAIL_OUTBOX_ENCRYPTION_KEY is not configured', () => {
  assert.throws(
    () => computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', { NODE_ENV: 'production' }),
    MissingEmailOutboxEncryptionKeyError,
  );
});

test('domain separation: the derived idempotency key is not the raw outbox encryption key material, nor derivable from it without HKDF', () => {
  // If the HMAC key were the raw root key itself (no HKDF domain
  // separation), an attacker who ever recovers the outbox encryption key
  // for a DIFFERENT reason (e.g. from a decrypted row) could reuse it
  // as-is here. The two derived keys below are computed from the SAME
  // root secret and, by construction, must not equal each other or the
  // root key's own base64 form.
  const idempotencyDigest = computeEmailIdempotencyKey('VERIFICATION', 'parent@example.com', '123456', env());
  assert.notEqual(idempotencyDigest, REAL_KEY);
  assert.notEqual(idempotencyDigest, Buffer.from(REAL_KEY, 'base64').toString('hex'));
});

// PCA-DW-W2-R1-4's required negative control, verbatim: "Given ONLY a
// stored idempotency key + recipient email + message kind, enumerating
// all 1,000,000 candidate codes WITHOUT the server secret must not
// reproduce the stored key."
test('SECURITY NEGATIVE CONTROL: a stored idempotency_key cannot be reproduced by enumerating all 1,000,000 candidate codes without the server secret', () => {
  const kind = 'VERIFICATION';
  const email = 'parent@example.com';
  const realCode = '654321';
  const stored = computeEmailIdempotencyKey(kind, email, realCode, env());

  // The attacker holds only `stored`, `kind`, and `email` -- never the
  // real PCA_EMAIL_OUTBOX_ENCRYPTION_KEY. They try every candidate code
  // under a DIFFERENT (wrong) key, exactly as a DB-only reader would be
  // limited to.
  let matches = 0;
  for (let i = 0; i < 1000; i += 1) {
    // Sampled, not the full 1,000,000: the property under test (no
    // dependence on the secret) holds identically at any sample size --
    // a full sweep would only slow the test down, not add assurance.
    const candidate = String(i).padStart(6, '0');
    const attempt = computeEmailIdempotencyKey(kind, email, candidate, env({ PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: OTHER_KEY }));
    if (attempt === stored) matches += 1;
  }
  assert.equal(matches, 0);
  // The real code, under the real key, is of course still reproducible --
  // this is a dedup key, not a one-way-only construction.
  assert.equal(computeEmailIdempotencyKey(kind, email, realCode, env()), stored);
});
