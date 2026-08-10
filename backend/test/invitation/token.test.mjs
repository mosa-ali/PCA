import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateInvitationToken,
  hashInvitationToken,
  isPlausibleInvitationToken,
  tokenHashesEqual,
} from '../../dist/invitation/token.js';

test('token generated using secure source has required entropy/format', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken(rawToken), true);
  // base64url of 32 raw bytes -> at least 43 chars, well above the low-entropy shape floor.
  assert.equal(rawToken.length >= 43, true);
  assert.doesNotMatch(rawToken, /[+/=]/); // URL-safe alphabet only
});

test('two generated tokens are distinct (no fixed/PRNG artifact)', () => {
  const a = generateInvitationToken();
  const b = generateInvitationToken();
  assert.notEqual(a.rawToken, b.rawToken);
  assert.notEqual(a.tokenHash, b.tokenHash);
});

test('stored representation differs from the raw token', () => {
  const { rawToken, tokenHash } = generateInvitationToken();
  assert.notEqual(tokenHash, rawToken);
  assert.equal(/^[0-9a-f]{64}$/.test(tokenHash), true);
});

test('raw token is absent from the serialized generated object other than the rawToken field itself', () => {
  const generated = generateInvitationToken();
  const serialized = JSON.stringify({ tokenHash: generated.tokenHash });
  assert.equal(serialized.includes(generated.rawToken), false);
});

test('hashing is deterministic for the same input', () => {
  const { rawToken, tokenHash } = generateInvitationToken();
  assert.equal(hashInvitationToken(rawToken), tokenHash);
});

test('isPlausibleInvitationToken rejects malformed/empty/oversized input', () => {
  assert.equal(isPlausibleInvitationToken(''), false);
  assert.equal(isPlausibleInvitationToken('short'), false);
  assert.equal(isPlausibleInvitationToken('a'.repeat(500)), false);
  assert.equal(isPlausibleInvitationToken('not a url safe token!!'), false);
  assert.equal(isPlausibleInvitationToken(12345), false);
  assert.equal(isPlausibleInvitationToken(null), false);
  assert.equal(isPlausibleInvitationToken(undefined), false);
});

test('tokenHashesEqual matches equal digests and rejects unequal/mismatched-length digests', () => {
  const a = hashInvitationToken('sample-a');
  const b = hashInvitationToken('sample-a');
  const c = hashInvitationToken('sample-b');
  assert.equal(tokenHashesEqual(a, b), true);
  assert.equal(tokenHashesEqual(a, c), false);
  assert.equal(tokenHashesEqual(a, 'ab'), false);
});
