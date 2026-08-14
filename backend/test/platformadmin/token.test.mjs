import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePlatformAdminSessionToken, hashPlatformAdminSessionToken, isPlausiblePlatformAdminSessionToken } from '../../dist/platformadmin/auth/token.js';
import { isPlausibleSessionToken } from '../../dist/auth/token.js';

test('generated raw tokens are pa_-prefixed and 46 characters total', () => {
  const { rawToken } = generatePlatformAdminSessionToken();
  assert.match(rawToken, /^pa_/);
  assert.equal(rawToken.length, 46);
});

test('isPlausiblePlatformAdminSessionToken accepts a generated token and rejects garbage', () => {
  const { rawToken } = generatePlatformAdminSessionToken();
  assert.equal(isPlausiblePlatformAdminSessionToken(rawToken), true);
  assert.equal(isPlausiblePlatformAdminSessionToken('not-a-token'), false);
  assert.equal(isPlausiblePlatformAdminSessionToken(''), false);
  assert.equal(isPlausiblePlatformAdminSessionToken('A'.repeat(43)), false); // valid family-plane shape, missing pa_ prefix
});

test('CROSS-REALM: a Platform Administration token is never plausible to the family-plane token parser, and vice versa', () => {
  const { rawToken: platformAdminToken } = generatePlatformAdminSessionToken();
  assert.equal(isPlausibleSessionToken(platformAdminToken), false);

  const familyPlaneToken = 'A'.repeat(43); // isPlausibleSessionToken's exact accepted shape
  assert.equal(isPlausibleSessionToken(familyPlaneToken), true);
  assert.equal(isPlausiblePlatformAdminSessionToken(familyPlaneToken), false);
});

test('hashPlatformAdminSessionToken is deterministic and never equal to the raw token', () => {
  const { rawToken, tokenHash } = generatePlatformAdminSessionToken();
  assert.equal(hashPlatformAdminSessionToken(rawToken), tokenHash);
  assert.notEqual(tokenHash, rawToken);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
});
