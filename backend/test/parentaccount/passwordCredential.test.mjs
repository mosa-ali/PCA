// PCA-DW-W2-15E -- parentaccount's own passwordCredential.ts (independently
// implemented from platformadmin/auth/passwordCredential.ts by design; see
// that module's own test file for its mirror of these same cases).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword, verifyPassword } from '../../dist/parentaccount/passwordCredential.js';

const scrypt = promisify(scryptCallback);

test('hashPassword produces the documented scrypt$N$r$p$saltHex$hashHex encoding at the raised N=2^17 cost', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  const parts = encoded.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts[1], '131072', 'PCA-DW-W2-15E: cost must be 2^17, not the old 2^15');
  assert.equal(parts[2], '8');
  assert.equal(parts[3], '1');
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

test('BACKWARD COMPAT: a credential encoded at the OLD N=2^15 cost still verifies correctly -- the format is self-describing, so raising SCRYPT_N needed no migration', async () => {
  const password = 'a pre-existing account password';
  const oldN = 32768;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: oldN, r, p, maxmem: 128 * oldN * r * 2 });
  const oldFormatEncoded = ['scrypt', oldN, r, p, salt.toString('hex'), derivedKey.toString('hex')].join('$');

  assert.equal(await verifyPassword(password, oldFormatEncoded), true);
  assert.equal(await verifyPassword('wrong password', oldFormatEncoded), false);
});

// PCA-DW-W2-R1-12
test('SECURITY: verifyPassword rejects (returns false, does not run scrypt) a corrupt/hostile credential requesting an N/r/p above the legitimate maximum', async () => {
  const salt = randomBytes(16).toString('hex');
  const hash = randomBytes(64).toString('hex');
  const start = Date.now();
  assert.equal(await verifyPassword('anything', `scrypt$4194304$8$1$${salt}$${hash}`), false, 'N far above 2^17 must be rejected');
  assert.equal(await verifyPassword('anything', `scrypt$131072$1024$1$${salt}$${hash}`), false, 'r far above the legitimate 8 must be rejected');
  assert.equal(await verifyPassword('anything', `scrypt$131072$8$64$${salt}$${hash}`), false, 'p far above the legitimate 1 must be rejected');
  // If these were passed through to scrypt, N=4194304 alone would take
  // seconds to minutes and request gigabytes of memory -- the bound must
  // reject before ever calling scrypt, so this whole test stays fast.
  assert.ok(Date.now() - start < 2000, 'must reject before attempting the expensive scrypt call, not after');
});

test('verifyPassword still accepts credentials at exactly the legitimate N=2^15 and N=2^17 boundaries', async () => {
  const encodedAt17 = await hashPassword('boundary check password');
  assert.equal(await verifyPassword('boundary check password', encodedAt17), true);

  const password = 'another boundary check password';
  const oldN = 32768; // 2^15
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: oldN, r: 8, p: 1, maxmem: 128 * oldN * 8 * 2 });
  const encodedAt15 = ['scrypt', oldN, 8, 1, salt.toString('hex'), derivedKey.toString('hex')].join('$');
  assert.equal(await verifyPassword(password, encodedAt15), true);
});
