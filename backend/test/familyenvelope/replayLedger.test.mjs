import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryReplayLedger } from '../../dist/familyenvelope/InMemoryReplayLedger.js';

test('hasProcessed is false for anything never recorded', async () => {
  const ledger = new InMemoryReplayLedger();
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-1'), false);
});

test('recordProcessed then hasProcessed reflects it', async () => {
  const ledger = new InMemoryReplayLedger();
  await ledger.recordProcessed('family-1', 'key-1', 'seq-1');
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-1'), true);
});

test('sequence/nonce values are scoped per sender key', async () => {
  const ledger = new InMemoryReplayLedger();
  await ledger.recordProcessed('family-1', 'key-1', 'seq-1');
  assert.equal(await ledger.hasProcessed('family-1', 'key-2', 'seq-1'), false);
});

test('PCA-17C: sequence/nonce values are scoped per family -- the SAME (senderKeyId, sequenceOrNonce) pair in a DIFFERENT family never collides', async () => {
  const ledger = new InMemoryReplayLedger();
  await ledger.recordProcessed('family-A', 'key-shared', 'seq-shared');
  assert.equal(
    await ledger.hasProcessed('family-B', 'key-shared', 'seq-shared'),
    false,
    'family B must never see family A\'s replay-ledger entry for the identical (senderKeyId, sequenceOrNonce) pair',
  );
  // And family A's own entry is unaffected by family B's independent check.
  assert.equal(await ledger.hasProcessed('family-A', 'key-shared', 'seq-shared'), true);
});

test('PCA-17C: recording the same (senderKeyId, sequenceOrNonce) in two different families never falsely rejects either', async () => {
  const ledger = new InMemoryReplayLedger();
  await ledger.recordProcessed('family-A', 'key-shared', 'seq-shared');
  await ledger.recordProcessed('family-B', 'key-shared', 'seq-shared');
  assert.equal(await ledger.hasProcessed('family-A', 'key-shared', 'seq-shared'), true);
  assert.equal(await ledger.hasProcessed('family-B', 'key-shared', 'seq-shared'), true);
});

test('capacity is bounded: the oldest entry is evicted once the per-(family,sender) cap is reached', async () => {
  const ledger = new InMemoryReplayLedger(3);
  await ledger.recordProcessed('family-1', 'key-1', 'seq-1');
  await ledger.recordProcessed('family-1', 'key-1', 'seq-2');
  await ledger.recordProcessed('family-1', 'key-1', 'seq-3');
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-1'), true);
  await ledger.recordProcessed('family-1', 'key-1', 'seq-4'); // exceeds cap of 3 -- evicts seq-1
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-1'), false);
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-2'), true);
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-3'), true);
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-4'), true);
});

test('PCA-17C: per-(family,sender) eviction never lets one family\'s traffic evict another family\'s entries for the same senderKeyId', async () => {
  const ledger = new InMemoryReplayLedger(2);
  await ledger.recordProcessed('family-A', 'key-shared', 'a-seq-1');
  await ledger.recordProcessed('family-A', 'key-shared', 'a-seq-2');
  // Family B floods the same senderKeyId far past family A's cap.
  await ledger.recordProcessed('family-B', 'key-shared', 'b-seq-1');
  await ledger.recordProcessed('family-B', 'key-shared', 'b-seq-2');
  await ledger.recordProcessed('family-B', 'key-shared', 'b-seq-3');
  // Family A's entries must be untouched by family B's eviction pressure.
  assert.equal(await ledger.hasProcessed('family-A', 'key-shared', 'a-seq-1'), true);
  assert.equal(await ledger.hasProcessed('family-A', 'key-shared', 'a-seq-2'), true);
});

test('a zero capacity genuinely remembers nothing -- it does not silently let one entry through', async () => {
  const ledger = new InMemoryReplayLedger(0);
  await ledger.recordProcessed('family-1', 'key-1', 'seq-1');
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-1'), false);
});

test('recording the same value twice is a no-op, not a double-eviction', async () => {
  const ledger = new InMemoryReplayLedger(2);
  await ledger.recordProcessed('family-1', 'key-1', 'seq-1');
  await ledger.recordProcessed('family-1', 'key-1', 'seq-2');
  await ledger.recordProcessed('family-1', 'key-1', 'seq-1'); // already present -- must not evict seq-2
  assert.equal(await ledger.hasProcessed('family-1', 'key-1', 'seq-2'), true);
});
