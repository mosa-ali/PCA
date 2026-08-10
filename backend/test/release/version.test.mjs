import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidVersion, compareVersions, parseVersion } from '../../dist/release/version.js';

test('valid version strings are accepted', () => {
  assert.equal(isValidVersion('1.0.0'), true);
  assert.equal(isValidVersion('0.0.0'), true);
  assert.equal(isValidVersion('12.34.567'), true);
});

test('malformed version strings are rejected', () => {
  assert.equal(isValidVersion('1.0'), false);
  assert.equal(isValidVersion('1.0.0.0'), false);
  assert.equal(isValidVersion('1.0.a'), false);
  assert.equal(isValidVersion('v1.0.0'), false);
  assert.equal(isValidVersion('1.0.0-beta'), false);
  assert.equal(isValidVersion(''), false);
  assert.equal(isValidVersion(' 1.0.0'), false);
  assert.equal(isValidVersion('1.0.0 '), false);
  assert.equal(isValidVersion(null), false);
  assert.equal(isValidVersion(123), false);
});

test('leading zeros are rejected', () => {
  assert.equal(isValidVersion('01.0.0'), false);
  assert.equal(isValidVersion('1.00.0'), false);
  assert.equal(isValidVersion('1.0.00'), false);
});

test('astronomically large numeric components are rejected, not overflowed', () => {
  assert.equal(isValidVersion('9'.repeat(20) + '.0.0'), false);
  assert.equal(parseVersion('9'.repeat(20) + '.0.0'), null);
});

test('numeric comparison, never lexicographic: 1.9.0 < 1.10.0', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
});

test('numeric comparison: 2.0.0 > 1.99.99', () => {
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.99.99', '2.0.0'), -1);
});

test('equal versions compare equal', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('patch and minor components each compared numerically', () => {
  assert.equal(compareVersions('1.2.9', '1.2.10'), -1);
  assert.equal(compareVersions('1.9.5', '1.10.0'), -1);
});

test('compareVersions rejects malformed input rather than guessing', () => {
  assert.throws(() => compareVersions('not-a-version', '1.0.0'), RangeError);
  assert.throws(() => compareVersions('1.0.0', '1.0'), RangeError);
});
