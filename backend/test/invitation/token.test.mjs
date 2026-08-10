import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateInvitationToken,
  hashInvitationToken,
  isPlausibleInvitationToken,
} from '../../dist/invitation/token.js';

const CANONICAL_LENGTH = 43;

test('token generated using secure source has the canonical entropy/format', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken(rawToken), true);
  assert.equal(rawToken.length, CANONICAL_LENGTH);
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

test('canonical valid token (real generator output) is accepted', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken(rawToken), true);
});

test('one character too short is rejected', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken(rawToken.slice(0, CANONICAL_LENGTH - 1)), false);
});

test('one character too long is rejected', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken(rawToken + 'A'), false);
});

test('invalid alphabet characters are rejected', () => {
  const { rawToken } = generateInvitationToken();
  const withPlus = '+' + rawToken.slice(1);
  const withSlash = '/' + rawToken.slice(1);
  assert.equal(isPlausibleInvitationToken(withPlus), false);
  assert.equal(isPlausibleInvitationToken(withSlash), false);
});

test('padding characters are rejected', () => {
  const padded = 'A'.repeat(CANONICAL_LENGTH - 1) + '=';
  assert.equal(isPlausibleInvitationToken(padded), false);
});

test('embedded or trailing whitespace is rejected', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken(rawToken + ' '), false);
  assert.equal(isPlausibleInvitationToken(' ' + rawToken.slice(1)), false);
  assert.equal(isPlausibleInvitationToken(rawToken.slice(0, 20) + ' ' + rawToken.slice(21)), false);
});

test('unicode characters are rejected', () => {
  const { rawToken } = generateInvitationToken();
  assert.equal(isPlausibleInvitationToken('é' + rawToken.slice(1)), false);
  assert.equal(isPlausibleInvitationToken(rawToken.slice(0, -1) + '🙂'), false);
});

test('very large input is rejected without throwing', () => {
  assert.equal(isPlausibleInvitationToken('A'.repeat(100_000)), false);
});

test('empty and non-string input rejected', () => {
  assert.equal(isPlausibleInvitationToken(''), false);
  assert.equal(isPlausibleInvitationToken(12345), false);
  assert.equal(isPlausibleInvitationToken(null), false);
  assert.equal(isPlausibleInvitationToken(undefined), false);
});
