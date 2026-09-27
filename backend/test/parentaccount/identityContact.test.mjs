import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptParentDisplayEmail,
  encryptParentDisplayEmail,
  loadParentIdentityEncryptionKeyring,
  normalizeParentPhoneNumber,
} from '../../dist/parentaccount/identityContact.js';

test('optional phone input canonicalizes formatting to E.164 and preserves its country code', () => {
  assert.deepEqual(normalizeParentPhoneNumber(undefined), { valid: true, value: null });
  assert.deepEqual(normalizeParentPhoneNumber('  '), { valid: true, value: null });
  assert.deepEqual(normalizeParentPhoneNumber(' +966 (55) 123-4567 '), { valid: true, value: '+966551234567' });
  assert.deepEqual(normalizeParentPhoneNumber('+٩٦٦ ٥٥ ١٢٣ ٤٥٦٧'), { valid: true, value: '+966551234567' });
  assert.deepEqual(normalizeParentPhoneNumber('0044 20 7946 0958'), { valid: true, value: '+442079460958' });
});

test('malformed or country-ambiguous phone values are rejected', () => {
  for (const value of ['555-1234', '+0123456789', '+1abc5551234', '+123', '+1234567890123456', '++966551234567']) {
    assert.deepEqual(normalizeParentPhoneNumber(value), { valid: false, reason: 'invalid_format' }, value);
  }
});

test('protected display email is randomized, account-bound, and decrypts under a bounded previous-key rotation', () => {
  const oldEnv = { NODE_ENV: 'test', PCA_PARENT_IDENTITY_ENC_KEY: '1'.repeat(64) };
  const newEnv = {
    NODE_ENV: 'test',
    PCA_PARENT_IDENTITY_ENC_KEY: '2'.repeat(64),
    PCA_PARENT_IDENTITY_ENC_KEY_PREVIOUS_1: '1'.repeat(64),
  };
  const first = encryptParentDisplayEmail('account-123', 'Parent+PCA@example.test', oldEnv);
  const second = encryptParentDisplayEmail('account-123', 'Parent+PCA@example.test', oldEnv);
  assert.notDeepEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext.toString('utf8'), 'Parent+PCA@example.test');
  assert.equal(decryptParentDisplayEmail('account-123', first, newEnv), 'Parent+PCA@example.test');
  assert.equal(decryptParentDisplayEmail('account-legacy', null, newEnv), null);
  assert.throws(() => decryptParentDisplayEmail('another-account', first, newEnv), /could not be decrypted/);
});

test('identity encryption refuses malformed key material and missing production keys', () => {
  assert.throws(() => loadParentIdentityEncryptionKeyring({ NODE_ENV: 'test', PCA_PARENT_IDENTITY_ENC_KEY: 'bad' }), /64-character hex/);
  assert.throws(() => loadParentIdentityEncryptionKeyring({ NODE_ENV: 'production' }), /PCA_PARENT_IDENTITY_ENC_KEY/);
});
