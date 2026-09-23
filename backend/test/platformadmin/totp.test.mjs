import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  computeTotp,
  decryptTotpSecret,
  decryptTotpSecretWithKeyring,
  encryptTotpSecret,
  generateTotpSecret,
  loadMfaEncryptionKey,
  loadMfaEncryptionKeyring,
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

// ---- Bounded MFA encryption keyring (rotation) --------------------------
//
// The defect these cover: before the keyring, decryption accepted exactly ONE
// key, so rotating PLATFORM_ADMIN_MFA_ENC_KEY made every already-sealed secret
// undecryptable. That stranded admins mid-enrollment and locked enrolled admins
// out of MFA, with no recovery short of destroying the pending material and
// reissuing activation. Each test below pins one property of the fix; none of
// them weaken the fail-closed contract, which the earlier tests still enforce.

const ACTIVE_HEX = 'ab'.repeat(32);
const PREVIOUS_1_HEX = 'cd'.repeat(32);
const PREVIOUS_2_HEX = 'ef'.repeat(32);

/** Seals a fresh secret under an arbitrary generation's key. */
function sealedUnder(hex) {
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, Buffer.from(hex, 'hex'));
  return { secret, ciphertext, nonce };
}

test('keyring decrypts an ACTIVE-sealed secret with the active key and needs no repair', () => {
  const { secret, ciphertext, nonce } = sealedUnder(ACTIVE_HEX);
  const keyring = loadMfaEncryptionKeyring({ PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX });
  const result = decryptTotpSecretWithKeyring(ciphertext, nonce, keyring);
  assert.deepEqual(result.secret, secret);
  assert.equal(result.keySource, 'ACTIVE');
  assert.equal(result.requiresReadRepair, false);
});

test('keyring decrypts a legacy-sealed secret via the bounded previous key and flags read repair', () => {
  const { secret, ciphertext, nonce } = sealedUnder(PREVIOUS_1_HEX);
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
  });
  const result = decryptTotpSecretWithKeyring(ciphertext, nonce, keyring);
  assert.deepEqual(result.secret, secret);
  assert.equal(result.keySource, 'PREVIOUS_1');
  assert.equal(result.requiresReadRepair, true);
});

test('keyring tries the ACTIVE key first, so a current secret is never misattributed to a legacy key', () => {
  const { ciphertext, nonce } = sealedUnder(ACTIVE_HEX);
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_2: PREVIOUS_2_HEX,
  });
  assert.equal(decryptTotpSecretWithKeyring(ciphertext, nonce, keyring).keySource, 'ACTIVE');
});

test('keyring reaches the SECOND previous key only after the first fails (declared order)', () => {
  const { secret, ciphertext, nonce } = sealedUnder(PREVIOUS_2_HEX);
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_2: PREVIOUS_2_HEX,
  });
  const result = decryptTotpSecretWithKeyring(ciphertext, nonce, keyring);
  assert.deepEqual(result.secret, secret);
  assert.equal(result.keySource, 'PREVIOUS_2');
  assert.equal(result.requiresReadRepair, true);
});

test('keyring treats absent or blank legacy slots as a clean skip, not an error', () => {
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: '',
  });
  assert.equal(keyring.legacy.length, 0);
});

test('a legacy slot PRESENT but malformed fails closed rather than being silently ignored', () => {
  assert.throws(
    () =>
      loadMfaEncryptionKeyring({
        PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
        PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: 'not-hex',
      }),
    /PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1/,
  );
});

test('the ACTIVE key stays mandatory even when legacy keys are configured', () => {
  assert.throws(() => loadMfaEncryptionKeyring({ PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX }));
});

test('keyring is BOUNDED: a differently named previous key is never consulted', () => {
  const { ciphertext, nonce } = sealedUnder(PREVIOUS_1_HEX);
  // PREVIOUS_3 is not a recognised slot. Boundedness is the security property
  // here: an enumerating implementation would also accept any Key Vault version
  // an attacker could create.
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_3: PREVIOUS_1_HEX,
  });
  assert.equal(keyring.legacy.length, 0);
  assert.throws(() => decryptTotpSecretWithKeyring(ciphertext, nonce, keyring), /could not be decrypted/);
});

test('no permitted key decrypting fails closed, and the error leaks no key material', () => {
  const unknownHex = '11'.repeat(32);
  const { ciphertext, nonce } = sealedUnder(unknownHex);
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
  });
  assert.throws(
    () => decryptTotpSecretWithKeyring(ciphertext, nonce, keyring),
    (err) =>
      !String(err.message).includes(ACTIVE_HEX) &&
      !String(err.message).includes(PREVIOUS_1_HEX) &&
      !String(err.message).includes(unknownHex),
  );
});

test('a tampered ciphertext is rejected even when a legacy key owns that generation', () => {
  const { ciphertext, nonce } = sealedUnder(PREVIOUS_1_HEX);
  const tampered = Buffer.from(ciphertext);
  tampered[0] ^= 0xff;
  const keyring = loadMfaEncryptionKeyring({
    PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX,
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: PREVIOUS_1_HEX,
  });
  assert.throws(() => decryptTotpSecretWithKeyring(tampered, nonce, keyring));
});

test('a malformed ciphertext is a data-shape error, rejected before any key is tried', () => {
  const keyring = loadMfaEncryptionKeyring({ PLATFORM_ADMIN_MFA_ENC_KEY: ACTIVE_HEX });
  assert.throws(() => decryptTotpSecretWithKeyring(Buffer.alloc(8), Buffer.alloc(16), keyring), /Malformed TOTP ciphertext/);
});
