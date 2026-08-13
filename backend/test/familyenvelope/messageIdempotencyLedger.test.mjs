import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';

test('getAcceptedCanonicalBytes is null before anything is recorded', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), null);
});

test('recordAccepted then getAcceptedCanonicalBytes reflects it, and reports outcome "recorded"', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  const result = await ledger.recordAccepted('family-1', 'msg-1', 'canonical-bytes-1');
  assert.deepEqual(result, { outcome: 'recorded' });
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), 'canonical-bytes-1');
});

test('recordAccepted with byte-identical content for an already-recorded messageId reports "already-idempotent" and does not corrupt the stored value', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  await ledger.recordAccepted('family-1', 'msg-1', 'bytes-1');
  const result = await ledger.recordAccepted('family-1', 'msg-1', 'bytes-1');
  assert.deepEqual(result, { outcome: 'already-idempotent' });
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), 'bytes-1');
});

test('recordAccepted with DIFFERENT content for an already-recorded messageId reports "conflict" and never overwrites the original', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  await ledger.recordAccepted('family-1', 'msg-1', 'bytes-1');
  const result = await ledger.recordAccepted('family-1', 'msg-1', 'bytes-DIFFERENT');
  assert.deepEqual(result, { outcome: 'conflict' });
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), 'bytes-1', 'the original content must be preserved, never silently overwritten by the conflicting write');
});

test('records are scoped per messageId', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  await ledger.recordAccepted('family-1', 'msg-1', 'canonical-bytes-1');
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-2'), null);
});

test('PCA-17C: records are scoped per family -- the SAME messageId with DIFFERENT content in a DIFFERENT family never collides or conflicts', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  const resultA = await ledger.recordAccepted('family-A', 'msg-shared', 'bytes-from-family-A');
  const resultB = await ledger.recordAccepted('family-B', 'msg-shared', 'bytes-from-family-B');
  assert.deepEqual(resultA, { outcome: 'recorded' });
  assert.deepEqual(resultB, { outcome: 'recorded' }, 'family B\'s acceptance of the identical messageId with DIFFERENT content must never be treated as a conflict with family A\'s');
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-A', 'msg-shared'), 'bytes-from-family-A');
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-B', 'msg-shared'), 'bytes-from-family-B');
});

test('PCA-17C: the SAME messageId with the SAME content in two different families are independently idempotent, never sharing state', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  await ledger.recordAccepted('family-A', 'msg-shared', 'identical-bytes');
  // Family B has never seen this messageId before -- it must be a fresh
  // 'recorded' outcome for family B, not an 'already-idempotent' echo of
  // family A's unrelated acceptance.
  const resultB = await ledger.recordAccepted('family-B', 'msg-shared', 'identical-bytes');
  assert.deepEqual(resultB, { outcome: 'recorded' });
});

test('capacity is bounded: the oldest entry is evicted once the cap is reached', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger(3);
  await ledger.recordAccepted('family-1', 'msg-1', 'bytes-1');
  await ledger.recordAccepted('family-1', 'msg-2', 'bytes-2');
  await ledger.recordAccepted('family-1', 'msg-3', 'bytes-3');
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), 'bytes-1');
  await ledger.recordAccepted('family-1', 'msg-4', 'bytes-4'); // exceeds cap of 3 -- evicts msg-1
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), null);
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-2'), 'bytes-2');
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-3'), 'bytes-3');
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-4'), 'bytes-4');
});

test('a zero capacity genuinely remembers nothing', async () => {
  const ledger = new InMemoryMessageIdempotencyLedger(0);
  const result = await ledger.recordAccepted('family-1', 'msg-1', 'bytes-1');
  assert.deepEqual(result, { outcome: 'recorded' });
  assert.equal(await ledger.getAcceptedCanonicalBytes('family-1', 'msg-1'), null);
});
