// PCA-DW-W2-15F -- encryption at rest for the durable email outbox.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidEmailOutboxEncryptionKeyError,
  MissingEmailOutboxEncryptionKeyError,
  decryptOutboxContent,
  encryptOutboxContent,
} from '../../dist/email/emailOutboxEncryption.js';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

test('encrypt then decrypt round-trips the exact plaintext', () => {
  const plaintext = JSON.stringify({ toEmail: 'parent@example.com', kind: 'VERIFICATION', code: '123456' });
  const env = { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: TEST_KEY };
  const encrypted = encryptOutboxContent(plaintext, env);
  assert.equal(decryptOutboxContent(encrypted, env), plaintext);
});

test('SECURITY: the ciphertext never contains the plaintext recipient/code as a readable substring', () => {
  const plaintext = JSON.stringify({ toEmail: 'parent@example.com', kind: 'VERIFICATION', code: '123456' });
  const env = { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: TEST_KEY };
  const encrypted = encryptOutboxContent(plaintext, env);
  assert.equal(encrypted.ciphertextBase64.includes('parent@example.com'), false);
  assert.equal(encrypted.ciphertextBase64.includes('123456'), false);
});

test('decryptOutboxContent fails (does not silently return garbage) if the ciphertext or auth tag is tampered with', () => {
  const plaintext = JSON.stringify({ toEmail: 'a@b.com', kind: 'VERIFICATION', code: '000000' });
  const env = { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: TEST_KEY };
  const encrypted = encryptOutboxContent(plaintext, env);
  const tamperedCiphertext = { ...encrypted, ciphertextBase64: Buffer.from(encrypted.ciphertextBase64, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') };
  assert.throws(() => decryptOutboxContent(tamperedCiphertext, env));
  const tamperedTag = { ...encrypted, authTagBase64: Buffer.from(encrypted.authTagBase64, 'base64').map((b, i) => (i === 0 ? b ^ 0xff : b)).toString('base64') };
  assert.throws(() => decryptOutboxContent(tamperedTag, env));
});

test('two encryptions of the same plaintext use different IVs and produce different ciphertext', () => {
  const plaintext = 'same content';
  const env = { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: TEST_KEY };
  const first = encryptOutboxContent(plaintext, env);
  const second = encryptOutboxContent(plaintext, env);
  assert.notEqual(first.ivBase64, second.ivBase64);
  assert.notEqual(first.ciphertextBase64, second.ciphertextBase64);
});

test('SECURITY: FAILS CLOSED in production with no configured key', () => {
  assert.throws(() => encryptOutboxContent('x', { NODE_ENV: 'production' }), MissingEmailOutboxEncryptionKeyError);
  assert.throws(() => encryptOutboxContent('x', {}), MissingEmailOutboxEncryptionKeyError, 'unset NODE_ENV must fail closed too');
});

test('uses the dev-only default key (no throw) in test/development when unconfigured, and succeeds in production when configured', () => {
  assert.doesNotThrow(() => encryptOutboxContent('x', { NODE_ENV: 'test' }));
  assert.doesNotThrow(() => encryptOutboxContent('x', { NODE_ENV: 'development' }));
  assert.doesNotThrow(() => encryptOutboxContent('x', { NODE_ENV: 'production', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: TEST_KEY }));
});

test('rejects a key that does not decode to exactly 32 bytes', () => {
  const shortKey = Buffer.alloc(16, 1).toString('base64');
  assert.throws(() => encryptOutboxContent('x', { NODE_ENV: 'test', PCA_EMAIL_OUTBOX_ENCRYPTION_KEY: shortKey }), InvalidEmailOutboxEncryptionKeyError);
});
