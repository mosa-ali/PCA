import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../../dist/platformadmin/auth/passwordCredential.js';

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
