import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { DUMMY_PASSWORD_CREDENTIAL, hashPassword, verifyPassword } from '../../dist/platformadmin/auth/passwordCredential.js';

const scrypt = promisify(scryptCallback);

test('hashPassword produces the documented scrypt$N$r$p$saltHex$hashHex encoding', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  const parts = encoded.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.match(parts[4], /^[0-9a-f]{32}$/); // 16-byte salt
  assert.match(parts[5], /^[0-9a-f]{128}$/); // 64-byte derived key
});

test('verifyPassword accepts the correct password and rejects a wrong one', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
});

test('two hashes of the same password use different random salts and are not equal', async () => {
  const first = await hashPassword('same password');
  const second = await hashPassword('same password');
  assert.notEqual(first, second);
});

test('verifyPassword returns false (never throws) for a malformed encoded credential', async () => {
  await assert.doesNotReject(async () => {
    assert.equal(await verifyPassword('anything', 'not-a-valid-credential'), false);
    assert.equal(await verifyPassword('anything', 'scrypt$notanumber$8$1$aa$bb'), false);
    assert.equal(await verifyPassword('anything', ''), false);
  });
});

// ---------------------------------------------------------------------------
// 2026-09-21 hardening -- PCA full read-only assessment finding P1-09 plus the
// privilege/work-factor inversion and missing hostile-row bound found in the
// same review of this plane.
// ---------------------------------------------------------------------------

test('hashPassword now hashes at N=2^17, matching the parent-account plane', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  const parts = encoded.split('$');
  assert.equal(parts[1], '131072', 'operator credentials must not be cheaper to attack offline than an ordinary parent account');
  assert.equal(parts[2], '8');
  assert.equal(parts[3], '1');
});

test('BACKWARD COMPAT: an operator credential encoded at the OLD N=2^15 cost still verifies unchanged -- the format is self-describing, so no migration was needed', async () => {
  const password = 'a pre-existing operator password';
  const oldN = 32768;
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: oldN, r: 8, p: 1, maxmem: 128 * oldN * 8 * 2 });
  const encodedAt15 = ['scrypt', oldN, 8, 1, salt.toString('hex'), derivedKey.toString('hex')].join('$');
  assert.equal(await verifyPassword(password, encodedAt15), true);
  assert.equal(await verifyPassword('wrong password', encodedAt15), false);
});

test('PCA-ADMIN-PWD-1: verifyPassword rejects (without running scrypt) a corrupt/hostile credential requesting N/r/p above the legitimate maximum', async () => {
  const salt = randomBytes(16).toString('hex');
  const hash = randomBytes(64).toString('hex');
  const start = Date.now();
  assert.equal(await verifyPassword('anything', `scrypt$4194304$8$1$${salt}$${hash}`), false, 'N far above the maximum must be rejected');
  assert.equal(await verifyPassword('anything', `scrypt$131072$1024$1$${salt}$${hash}`), false, 'r far above the legitimate 8 must be rejected');
  assert.equal(await verifyPassword('anything', `scrypt$131072$8$64$${salt}$${hash}`), false, 'p far above the legitimate 1 must be rejected');
  assert.ok(Date.now() - start < 2000, 'must reject before attempting the expensive scrypt call, not after');
});

test('REGRESSION (P1-09): the dummy admin credential encodes exactly the same scrypt cost parameters as a real credential', async () => {
  const real = await hashPassword('any real operator password');
  const realParts = real.split('$');
  const dummyParts = DUMMY_PASSWORD_CREDENTIAL.split('$');
  assert.equal(dummyParts.length, 6);
  assert.equal(dummyParts[0], 'scrypt');
  assert.equal(dummyParts[1], realParts[1], 'dummy N must equal the real SCRYPT_N');
  assert.equal(dummyParts[2], realParts[2], 'dummy r must equal the real SCRYPT_R');
  assert.equal(dummyParts[3], realParts[3], 'dummy p must equal the real SCRYPT_P');
  assert.equal(dummyParts[4].length, realParts[4].length, 'dummy salt length must equal the real salt length');
  assert.equal(dummyParts[5].length, realParts[5].length, 'dummy derived-key length must equal the real derived-key length');
});

test('SECURITY: the dummy admin credential never verifies any candidate password', async () => {
  assert.equal(await verifyPassword('', DUMMY_PASSWORD_CREDENTIAL), false);
  assert.equal(await verifyPassword('password', DUMMY_PASSWORD_CREDENTIAL), false);
});
