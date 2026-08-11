import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareSemanticVersions,
  isPlausibleSemanticVersion,
  requiresStrictVersionIncrease,
} from '../../dist/familyenvelope/policy.js';

test('isPlausibleSemanticVersion accepts a well-formed dotted triple', () => {
  assert.equal(isPlausibleSemanticVersion('1.2.3'), true);
  assert.equal(isPlausibleSemanticVersion('0.0.0'), true);
});

test('isPlausibleSemanticVersion rejects malformed input', () => {
  assert.equal(isPlausibleSemanticVersion('1.2'), false);
  assert.equal(isPlausibleSemanticVersion('1.2.3.4'), false);
  assert.equal(isPlausibleSemanticVersion('01.2.3'), false);
  assert.equal(isPlausibleSemanticVersion('a.b.c'), false);
  assert.equal(isPlausibleSemanticVersion(123), false);
});

test('compareSemanticVersions compares numerically, not lexicographically', () => {
  assert.ok(compareSemanticVersions('1.9.0', '1.10.0') < 0);
  assert.ok(compareSemanticVersions('2.0.0', '1.99.99') > 0);
  assert.equal(compareSemanticVersions('1.2.3', '1.2.3'), 0);
});

test('requiresStrictVersionIncrease is true only for POLICY_UPDATE', () => {
  assert.equal(requiresStrictVersionIncrease('POLICY_UPDATE'), true);
  const others = [
    'POLICY_RECEIPT',
    'STATUS_SNAPSHOT',
    'ACTIVITY_SUMMARY',
    'LOCATION_RESPONSE',
    'CHILD_REQUEST',
    'PARENT_DECISION',
    'TAMPER_ALERT',
    'RETENTION_DELETION_INSTRUCTION',
    'RETENTION_RECEIPT',
    'FTS_UPDATE',
    'KEY_ROTATION',
    'DEVICE_REVOKE',
    'RECOVERY_TRANSACTION',
    'SIGNED_ROLLBACK',
  ];
  for (const type of others) {
    assert.equal(requiresStrictVersionIncrease(type), false, `${type} must not require strict version increase`);
  }
});
