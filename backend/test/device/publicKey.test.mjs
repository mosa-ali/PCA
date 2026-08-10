import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { isPlausiblePublicKey } from '../../dist/device/publicKey.js';

function sampleKey(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url');
}

test('accepts a well-formed base64url public key within the size bounds', () => {
  assert.equal(isPlausiblePublicKey(sampleKey(32)), true);
  assert.equal(isPlausiblePublicKey(sampleKey(16)), true);
});

test('rejects too-short and too-long decoded key material', () => {
  assert.equal(isPlausiblePublicKey(sampleKey(8)), false);
  assert.equal(isPlausiblePublicKey(sampleKey(300)), false);
});

test('rejects non-base64url characters, empty, and non-string input', () => {
  assert.equal(isPlausiblePublicKey(''), false);
  assert.equal(isPlausiblePublicKey('not a key!! +/='), false);
  assert.equal(isPlausiblePublicKey(null), false);
  assert.equal(isPlausiblePublicKey(undefined), false);
  assert.equal(isPlausiblePublicKey(1234), false);
  assert.equal(isPlausiblePublicKey({}), false);
});

test('rejects oversized junk input without throwing', () => {
  assert.equal(isPlausiblePublicKey('A'.repeat(100_000)), false);
});
