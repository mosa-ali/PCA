import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  computeTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  loadMfaEncryptionKey,
  verifyTotp,
} from '../../dist/platformadmin/auth/totp.js';

test('base32 encode/decode round-trips arbitrary bytes', () => {
  for (let i = 0; i < 20; i++) {
    const original = randomBytes(1 + (i % 25));
    assert.deepEqual(base32Decode(base32Encode(original)), original);
  }
});

test('base32 encode produces only RFC 4648 alphabet characters', () => {
  const encoded = base32Encode(randomBytes(20));
  assert.match(encoded, /^[A-Z2-7]+$/);
});

test('RFC 6238 known test vector: secret "12345678901234567890", time=59s, 6-digit truncation of the published 8-digit code', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  // RFC 6238 Appendix B publishes 94287082 as the 8-digit SHA1 code at
  // T=59 (counter=1 at a 30s step); the last 6 digits of that value are
  // what our TOTP_DIGITS=6 truncation must produce.
  assert.equal(computeTotp(secret, 59_000, 0), '287082');
});

test('verifyTotp accepts the current step and rejects a code from far outside the ±1 skew window', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const validCode = computeTotp(secret, now, 0);
  assert.equal(verifyTotp(secret, validCode, now), Math.floor(now / 1000 / 30));
  const farFutureCode = computeTotp(secret, now, 100);
  assert.equal(verifyTotp(secret, farFutureCode, now), null);
});

test('verifyTotp accepts ±1 step for clock skew and returns the matched ABSOLUTE counter, not just true/false', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const baseCounter = Math.floor(now / 1000 / 30);
  assert.equal(verifyTotp(secret, computeTotp(secret, now, 1), now), baseCounter + 1);
  assert.equal(verifyTotp(secret, computeTotp(secret, now, -1), now), baseCounter - 1);
});

test('verifyTotp rejects a non-6-digit candidate without throwing', () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotp(secret, 'abcdef', Date.now()), null);
  assert.equal(verifyTotp(secret, '12345', Date.now()), null);
  assert.equal(verifyTotp(secret, '', Date.now()), null);
});

test('loadMfaEncryptionKey throws synchronously when the env var is absent (fail-closed)', () => {
  assert.throws(() => loadMfaEncryptionKey({}));
});

test('loadMfaEncryptionKey throws synchronously when the env var is malformed (wrong length/non-hex)', () => {
  assert.throws(() => loadMfaEncryptionKey({ PLATFORM_ADMIN_MFA_ENC_KEY: 'not-hex' }));
  assert.throws(() => loadMfaEncryptionKey({ PLATFORM_ADMIN_MFA_ENC_KEY: 'ab'.repeat(31) }));
});

test('loadMfaEncryptionKey accepts a valid 64-hex-char key', () => {
  const key = loadMfaEncryptionKey({ PLATFORM_ADMIN_MFA_ENC_KEY: 'ab'.repeat(32) });
  assert.equal(key.length, 32);
});

test('AES-256-GCM round-trip: decrypting the exact ciphertext/nonce recovers the original secret', () => {
  const key = randomBytes(32);
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  const recovered = decryptTotpSecret(ciphertext, nonce, key);
  assert.deepEqual(recovered, secret);
});

test('AES-256-GCM: tampering with the ciphertext is detected (auth tag mismatch) rather than silently decrypting garbage', () => {
  const key = randomBytes(32);
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  const tampered = Buffer.from(ciphertext);
  tampered[0] ^= 0xff;
  assert.throws(() => decryptTotpSecret(tampered, nonce, key));
});

test('buildOtpauthUri embeds issuer/algorithm/digits/period and never the raw secret bytes only base32', () => {
  const uri = buildOtpauthUri('owner@example.test', 'JBSWY3DPEHPK3PXP');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=PCA/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
