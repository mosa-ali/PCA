import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';

test('hasProcessed is false for anything never recorded', async () => {
  const ledger = new InMemoryReplayLedger();
  assert.equal(await ledger.hasProcessed('key-1', 'seq-1'), false);
});

test('recordProcessed then hasProcessed reflects it', async () => {
  const ledger = new InMemoryReplayLedger();
  await ledger.recordProcessed('key-1', 'seq-1');
  assert.equal(await ledger.hasProcessed('key-1', 'seq-1'), true);
});

test('sequence/nonce values are scoped per sender key', async () => {
  const ledger = new InMemoryReplayLedger();
  await ledger.recordProcessed('key-1', 'seq-1');
  assert.equal(await ledger.hasProcessed('key-2', 'seq-1'), false);
});

test('capacity is bounded: the oldest entry is evicted once the per-sender cap is reached', async () => {
  const ledger = new InMemoryReplayLedger(3);
  await ledger.recordProcessed('key-1', 'seq-1');
  await ledger.recordProcessed('key-1', 'seq-2');
  await ledger.recordProcessed('key-1', 'seq-3');
  assert.equal(await ledger.hasProcessed('key-1', 'seq-1'), true);
  await ledger.recordProcessed('key-1', 'seq-4'); // exceeds cap of 3 -- evicts seq-1
  assert.equal(await ledger.hasProcessed('key-1', 'seq-1'), false);
  assert.equal(await ledger.hasProcessed('key-1', 'seq-2'), true);
  assert.equal(await ledger.hasProcessed('key-1', 'seq-3'), true);
  assert.equal(await ledger.hasProcessed('key-1', 'seq-4'), true);
});

test('a zero capacity genuinely remembers nothing -- it does not silently let one entry through', async () => {
  const ledger = new InMemoryReplayLedger(0);
  await ledger.recordProcessed('key-1', 'seq-1');
  assert.equal(await ledger.hasProcessed('key-1', 'seq-1'), false);
});

test('recording the same value twice is a no-op, not a double-eviction', async () => {
  const ledger = new InMemoryReplayLedger(2);
  await ledger.recordProcessed('key-1', 'seq-1');
  await ledger.recordProcessed('key-1', 'seq-2');
  await ledger.recordProcessed('key-1', 'seq-1'); // already present -- must not evict seq-2
  assert.equal(await ledger.hasProcessed('key-1', 'seq-2'), true);
});
