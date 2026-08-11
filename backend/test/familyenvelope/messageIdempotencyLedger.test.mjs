import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryMessageIdempotencyLedger } from '../../dist/familyenvelope/InMemoryMessageIdempotencyLedger.js';

test('getAcceptedCanonicalBytes is null before anything is recorded', () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-1'), null);
});

test('recordAccepted then getAcceptedCanonicalBytes reflects it', () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  ledger.recordAccepted('msg-1', 'canonical-bytes-1');
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-1'), 'canonical-bytes-1');
});

test('records are scoped per messageId', () => {
  const ledger = new InMemoryMessageIdempotencyLedger();
  ledger.recordAccepted('msg-1', 'canonical-bytes-1');
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-2'), null);
});

test('capacity is bounded: the oldest entry is evicted once the cap is reached', () => {
  const ledger = new InMemoryMessageIdempotencyLedger(3);
  ledger.recordAccepted('msg-1', 'bytes-1');
  ledger.recordAccepted('msg-2', 'bytes-2');
  ledger.recordAccepted('msg-3', 'bytes-3');
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-1'), 'bytes-1');
  ledger.recordAccepted('msg-4', 'bytes-4'); // exceeds cap of 3 -- evicts msg-1
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-1'), null);
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-2'), 'bytes-2');
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-3'), 'bytes-3');
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-4'), 'bytes-4');
});

test('a zero capacity genuinely remembers nothing', () => {
  const ledger = new InMemoryMessageIdempotencyLedger(0);
  ledger.recordAccepted('msg-1', 'bytes-1');
  assert.equal(ledger.getAcceptedCanonicalBytes('msg-1'), null);
});
