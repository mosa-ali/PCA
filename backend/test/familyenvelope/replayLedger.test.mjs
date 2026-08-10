import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';

test('hasProcessed is false for anything never recorded', () => {
  const ledger = new InMemoryReplayLedger();
  assert.equal(ledger.hasProcessed('key-1', 'seq-1'), false);
});

test('recordProcessed then hasProcessed reflects it', () => {
  const ledger = new InMemoryReplayLedger();
  ledger.recordProcessed('key-1', 'seq-1');
  assert.equal(ledger.hasProcessed('key-1', 'seq-1'), true);
});

test('sequence/nonce values are scoped per sender key', () => {
  const ledger = new InMemoryReplayLedger();
  ledger.recordProcessed('key-1', 'seq-1');
  assert.equal(ledger.hasProcessed('key-2', 'seq-1'), false);
});

test('capacity is bounded: the oldest entry is evicted once the per-sender cap is reached', () => {
  const ledger = new InMemoryReplayLedger(3);
  ledger.recordProcessed('key-1', 'seq-1');
  ledger.recordProcessed('key-1', 'seq-2');
  ledger.recordProcessed('key-1', 'seq-3');
  assert.equal(ledger.hasProcessed('key-1', 'seq-1'), true);
  ledger.recordProcessed('key-1', 'seq-4'); // exceeds cap of 3 -- evicts seq-1
  assert.equal(ledger.hasProcessed('key-1', 'seq-1'), false);
  assert.equal(ledger.hasProcessed('key-1', 'seq-2'), true);
  assert.equal(ledger.hasProcessed('key-1', 'seq-3'), true);
  assert.equal(ledger.hasProcessed('key-1', 'seq-4'), true);
});

test('a zero capacity genuinely remembers nothing -- it does not silently let one entry through', () => {
  const ledger = new InMemoryReplayLedger(0);
  ledger.recordProcessed('key-1', 'seq-1');
  assert.equal(ledger.hasProcessed('key-1', 'seq-1'), false);
});

test('recording the same value twice is a no-op, not a double-eviction', () => {
  const ledger = new InMemoryReplayLedger(2);
  ledger.recordProcessed('key-1', 'seq-1');
  ledger.recordProcessed('key-1', 'seq-2');
  ledger.recordProcessed('key-1', 'seq-1'); // already present -- must not evict seq-2
  assert.equal(ledger.hasProcessed('key-1', 'seq-2'), true);
});
