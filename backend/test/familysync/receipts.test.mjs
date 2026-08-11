import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReceipt, buildDrainedReceipts, buildExpiredReceipts } from '../../dist/familysync/receipts.js';

const ENVELOPE = { familyId: 'family-1', messageId: 'msg-1' };
const NOW = new Date('2026-01-07T12:00:00.000Z');

test('APPLY_NOW builds an APPLIED receipt with no reason on first application', () => {
  const receipt = buildReceipt(ENVELOPE, { kind: 'APPLY_NOW', idempotent: false }, NOW);
  assert.deepEqual(receipt, { familyId: 'family-1', messageId: 'msg-1', outcome: 'APPLIED', atUtc: NOW, reason: null });
});

test('idempotent APPLY_NOW still builds an APPLIED receipt, with a note', () => {
  const receipt = buildReceipt(ENVELOPE, { kind: 'APPLY_NOW', idempotent: true }, NOW);
  assert.equal(receipt.outcome, 'APPLIED');
  assert.ok(receipt.reason);
});

test('HOLD_PENDING builds a HELD_PENDING receipt carrying the dependency reason', () => {
  const receipt = buildReceipt(ENVELOPE, { kind: 'HOLD_PENDING', reason: 'MISSING_SEQUENCE_PREDECESSOR', waitingOnSequence: 2 }, NOW);
  assert.deepEqual(receipt, {
    familyId: 'family-1',
    messageId: 'msg-1',
    outcome: 'HELD_PENDING',
    atUtc: NOW,
    reason: 'MISSING_SEQUENCE_PREDECESSOR',
  });
});

test('REJECT builds a REJECTED receipt carrying the rejection reason', () => {
  const receipt = buildReceipt(ENVELOPE, { kind: 'REJECT', reason: 'INVALID_SIGNATURE' }, NOW);
  assert.deepEqual(receipt, { familyId: 'family-1', messageId: 'msg-1', outcome: 'REJECTED', atUtc: NOW, reason: 'INVALID_SIGNATURE' });
});

test('receipts never carry payload/plaintext -- only familyId, messageId, outcome, reason code', () => {
  const receipt = buildReceipt(ENVELOPE, { kind: 'REJECT', reason: 'EXPIRED' }, NOW);
  assert.deepEqual(Object.keys(receipt).sort(), ['atUtc', 'familyId', 'messageId', 'outcome', 'reason']);
});

test('buildDrainedReceipts maps every drained outcome for the family', () => {
  const drained = [
    { messageId: 'a', decision: { kind: 'APPLY_NOW', idempotent: false } },
    { messageId: 'b', decision: { kind: 'REJECT', reason: 'EXPIRED' } },
  ];
  const receipts = buildDrainedReceipts('family-1', drained, NOW);
  assert.deepEqual(
    receipts.map((r) => [r.messageId, r.outcome]),
    [
      ['a', 'APPLIED'],
      ['b', 'REJECTED'],
    ],
  );
});

test('buildExpiredReceipts marks every expired pending record as EXPIRED with its original hold reason', () => {
  const expired = [
    {
      familyId: 'family-1',
      messageId: 'msg-expired',
      reason: 'MISSING_SEQUENCE_PREDECESSOR',
    },
  ];
  const receipts = buildExpiredReceipts(expired, NOW);
  assert.deepEqual(receipts, [
    { familyId: 'family-1', messageId: 'msg-expired', outcome: 'EXPIRED', atUtc: NOW, reason: 'MISSING_SEQUENCE_PREDECESSOR' },
  ]);
});
