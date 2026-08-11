import assert from 'node:assert/strict';
import test from 'node:test';
import { isProtocolCompatible } from '../../dist/familyenvelope/protocolCompatibility.js';
import { SUPPORTED_PROTOCOL_MAJOR } from '../../dist/familyenvelope/policy.js';

test('the currently supported protocolMajor is compatible', () => {
  assert.equal(isProtocolCompatible(SUPPORTED_PROTOCOL_MAJOR), true);
});

test('a lower, older protocolMajor is incompatible -- reject, never guess at a deprecated wire shape', () => {
  assert.equal(isProtocolCompatible(SUPPORTED_PROTOCOL_MAJOR - 1), false);
});

test('a higher, unknown protocolMajor is incompatible -- reject without decrypting/applying, per doc 22 Section 6', () => {
  assert.equal(isProtocolCompatible(SUPPORTED_PROTOCOL_MAJOR + 1), false);
});
