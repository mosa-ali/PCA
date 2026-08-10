import assert from 'node:assert/strict';
import test from 'node:test';
import { generateChallengeNonce, isPlausibleChallengeNonce } from '../../dist/deviceauth/nonce.js';

test('generateChallengeNonce produces a plausible, unique nonce each call', () => {
  const a = generateChallengeNonce();
  const b = generateChallengeNonce();
  assert.notEqual(a, b);
  assert.ok(isPlausibleChallengeNonce(a));
  assert.ok(isPlausibleChallengeNonce(b));
});

test('isPlausibleChallengeNonce rejects malformed input', () => {
  assert.equal(isPlausibleChallengeNonce(''), false);
  assert.equal(isPlausibleChallengeNonce('too-short'), false);
  assert.equal(isPlausibleChallengeNonce(123), false);
  assert.equal(isPlausibleChallengeNonce(null), false);
  assert.equal(isPlausibleChallengeNonce(undefined), false);
  assert.equal(isPlausibleChallengeNonce('!'.repeat(43)), false);
});
