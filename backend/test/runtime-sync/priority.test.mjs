import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByPriority, priorityTierForMessageType } from '../../dist/runtime-sync/priority.js';

test('trust/security messages sort before policy, decision, receipt, critical-state, and activity-summary', () => {
  const items = [
    { messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: 1 },
    { messageType: 'POLICY_UPDATE', enqueuedAtEpochMillis: 2 },
    { messageType: 'KEY_ROTATION', enqueuedAtEpochMillis: 3 },
    { messageType: 'CHILD_REQUEST', enqueuedAtEpochMillis: 4 },
    { messageType: 'POLICY_RECEIPT', enqueuedAtEpochMillis: 5 },
    { messageType: 'STATUS_SNAPSHOT', enqueuedAtEpochMillis: 6 },
  ];
  const sorted = sortByPriority(items).map((i) => i.messageType);
  assert.deepEqual(sorted, [
    'KEY_ROTATION',
    'POLICY_UPDATE',
    'CHILD_REQUEST',
    'POLICY_RECEIPT',
    'STATUS_SNAPSHOT',
    'ACTIVITY_SUMMARY',
  ]);
});

test('ties within the same tier break by enqueue order, earliest first', () => {
  const items = [
    { messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: 200 },
    { messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: 100 },
  ];
  const sorted = sortByPriority(items).map((i) => i.enqueuedAtEpochMillis);
  assert.deepEqual(sorted, [100, 200]);
});

test('sort does not mutate the input array', () => {
  const items = [{ messageType: 'ACTIVITY_SUMMARY', enqueuedAtEpochMillis: 1 }, { messageType: 'KEY_ROTATION', enqueuedAtEpochMillis: 2 }];
  const original = [...items];
  sortByPriority(items);
  assert.deepEqual(items, original);
});

test('an unrecognised message type defaults to the lowest tier, never a higher one', () => {
  assert.equal(priorityTierForMessageType('SOME_UNKNOWN_TYPE'), 'ACTIVITY_SUMMARY');
});
