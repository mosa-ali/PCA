// PCA-DW-W2-15B -- verification-code hashing must be a KEYED construction
// (HMAC-SHA256 with a server-side secret), not a plain unkeyed digest: a
// 6-digit code has only 1,000,000 possible values, so an unkeyed hash lets
// anyone who reads the stored digest (a DB leak, a backup) brute-force
// every code offline in a fraction of a second.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MissingVerificationCodeSecretError,
  generateVerificationCode,
  hashVerificationCode,
  isPlausibleVerificationCode,
  verificationCodeHashesMatch,
} from '../../dist/parentaccount/verificationCode.js';

test('generateVerificationCode produces a 6-digit numeric code and a matching hash', () => {
  const { code, codeHash } = generateVerificationCode({ NODE_ENV: 'test' });
  assert.ok(isPlausibleVerificationCode(code));
  assert.equal(hashVerificationCode(code, { NODE_ENV: 'test' }), codeHash);
});

test('SECURITY: hashVerificationCode is a KEYED (HMAC) construction -- the same code hashes differently under a different secret', () => {
  const code = '123456';
  const hashA = hashVerificationCode(code, { NODE_ENV: 'test', PCA_VERIFICATION_CODE_HMAC_SECRET: 'secret-a' });
  const hashB = hashVerificationCode(code, { NODE_ENV: 'test', PCA_VERIFICATION_CODE_HMAC_SECRET: 'secret-b' });
  assert.notEqual(hashA, hashB, 'a keyed hash must depend on the secret, not just the code -- an unkeyed sha256(code) would be identical here');
});

test('hashVerificationCode is deterministic for the same code and secret', () => {
  const code = '654321';
  const env = { NODE_ENV: 'test', PCA_VERIFICATION_CODE_HMAC_SECRET: 'fixed-secret' };
  assert.equal(hashVerificationCode(code, env), hashVerificationCode(code, env));
});

test('SECURITY: hashVerificationCode/generateVerificationCode FAIL CLOSED in production with no configured secret', () => {
  assert.throws(() => hashVerificationCode('123456', { NODE_ENV: 'production' }), MissingVerificationCodeSecretError);
  assert.throws(() => generateVerificationCode({ NODE_ENV: 'production' }), MissingVerificationCodeSecretError);
  // Fails closed for an unrecognized/unset NODE_ENV too -- never falls back to the dev-only secret outside test/development.
  assert.throws(() => hashVerificationCode('123456', {}), MissingVerificationCodeSecretError);
});

test('hashVerificationCode succeeds in production when PCA_VERIFICATION_CODE_HMAC_SECRET is configured', () => {
  assert.doesNotThrow(() => hashVerificationCode('123456', { NODE_ENV: 'production', PCA_VERIFICATION_CODE_HMAC_SECRET: 'a-test-only-configured-secret' }));
});

test('hashVerificationCode uses the dev-only default secret (not a throw) in test/development when no secret is configured', () => {
  assert.doesNotThrow(() => hashVerificationCode('123456', { NODE_ENV: 'test' }));
  assert.doesNotThrow(() => hashVerificationCode('123456', { NODE_ENV: 'development' }));
});

test('verificationCodeHashesMatch is constant-time-safe and still correct for HMAC-produced hashes', () => {
  const env = { NODE_ENV: 'test' };
  const { codeHash } = generateVerificationCode(env);
  const candidateHash = hashVerificationCode('000000', env);
  assert.equal(verificationCodeHashesMatch(candidateHash, codeHash), candidateHash === codeHash);
  assert.equal(verificationCodeHashesMatch(codeHash, codeHash), true);
});

test('isPlausibleVerificationCode rejects non-6-digit or non-numeric input', () => {
  assert.equal(isPlausibleVerificationCode('12345'), false);
  assert.equal(isPlausibleVerificationCode('1234567'), false);
  assert.equal(isPlausibleVerificationCode('abcdef'), false);
  assert.equal(isPlausibleVerificationCode(123456), false);
  assert.equal(isPlausibleVerificationCode('000000'), true);
});
