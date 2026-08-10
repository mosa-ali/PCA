import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSessionToken, hashSessionToken, isPlausibleSessionToken } from '../../dist/auth/token.js';

const CANONICAL_LENGTH = 43;

test('token generated using secure source has the canonical entropy/format', () => {
  const { rawToken } = generateSessionToken();
  assert.equal(isPlausibleSessionToken(rawToken), true);
  assert.equal(rawToken.length, CANONICAL_LENGTH);
  assert.doesNotMatch(rawToken, /[+/=]/);
});

test('two generated tokens are distinct', () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.notEqual(a.rawToken, b.rawToken);
  assert.notEqual(a.tokenHash, b.tokenHash);
});

test('stored representation differs from the raw token', () => {
  const { rawToken, tokenHash } = generateSessionToken();
  assert.notEqual(tokenHash, rawToken);
  assert.equal(/^[0-9a-f]{64}$/.test(tokenHash), true);
});

test('raw token is absent from a serialized object that only carries the hash', () => {
  const generated = generateSessionToken();
  const serialized = JSON.stringify({ tokenHash: generated.tokenHash });
  assert.equal(serialized.includes(generated.rawToken), false);
});

test('hashing is deterministic', () => {
  const { rawToken, tokenHash } = generateSessionToken();
  assert.equal(hashSessionToken(rawToken), tokenHash);
});

test('malformed bearer input rejected: wrong length, invalid alphabet, empty, oversized, non-string', () => {
  const { rawToken } = generateSessionToken();
  assert.equal(isPlausibleSessionToken(rawToken.slice(0, -1)), false);
  assert.equal(isPlausibleSessionToken(rawToken + 'A'), false);
  assert.equal(isPlausibleSessionToken('+' + rawToken.slice(1)), false);
  assert.equal(isPlausibleSessionToken(''), false);
  assert.equal(isPlausibleSessionToken('A'.repeat(100_000)), false);
  assert.equal(isPlausibleSessionToken(null), false);
  assert.equal(isPlausibleSessionToken(undefined), false);
  assert.equal(isPlausibleSessionToken(12345), false);
});
