import assert from 'node:assert/strict';
import test from 'node:test';
import { isBlockRequestable, isLegalUnblockRequestTransition, isTemporaryApprovalActive } from '../../dist/safebrowser/policy.js';

test('a SECURITY_DENYLIST block is never requestable', () => {
  assert.equal(isBlockRequestable('SECURITY_DENYLIST'), false);
});

test('every other source is requestable', () => {
  for (const source of ['PARENT_ALLOWLIST', 'PARENT_DENYLIST', 'CATEGORY_RULE', 'SCHEDULE_RULE', 'CLASSIFIER', 'DEFAULT']) {
    assert.equal(isBlockRequestable(source), true);
  }
});

test('PENDING may transition to any decided state', () => {
  assert.equal(isLegalUnblockRequestTransition('PENDING', 'APPROVED_TEMPORARY'), true);
  assert.equal(isLegalUnblockRequestTransition('PENDING', 'APPROVED_PERMANENT'), true);
  assert.equal(isLegalUnblockRequestTransition('PENDING', 'DENIED'), true);
});

test('a decided request is terminal', () => {
  for (const from of ['APPROVED_TEMPORARY', 'APPROVED_PERMANENT', 'DENIED']) {
    for (const to of ['PENDING', 'APPROVED_TEMPORARY', 'APPROVED_PERMANENT', 'DENIED']) {
      assert.equal(isLegalUnblockRequestTransition(from, to), false, `${from} -> ${to} must be illegal`);
    }
  }
});

test('isTemporaryApprovalActive is true only before expiry on an APPROVED_TEMPORARY request', () => {
  const base = { status: 'APPROVED_TEMPORARY', temporaryApprovalExpiresAt: new Date('2026-01-01T12:00:00Z') };
  assert.equal(isTemporaryApprovalActive(base, new Date('2026-01-01T11:00:00Z')), true);
  assert.equal(isTemporaryApprovalActive(base, new Date('2026-01-01T13:00:00Z')), false);
  assert.equal(isTemporaryApprovalActive({ ...base, status: 'APPROVED_PERMANENT' }, new Date('2026-01-01T11:00:00Z')), false);
  assert.equal(isTemporaryApprovalActive({ ...base, temporaryApprovalExpiresAt: null }, new Date('2026-01-01T11:00:00Z')), false);
});
