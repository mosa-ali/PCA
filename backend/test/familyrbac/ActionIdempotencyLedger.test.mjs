import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';

test('getRecorded returns null for an unseen idempotency key', () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  assert.equal(ledger.getRecorded('key-1'), null);
});

test('record then getRecorded round-trips the same outcome', () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  ledger.record('key-1', { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
  assert.deepEqual(ledger.getRecorded('key-1'), { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
});

test('a zero-capacity ledger never retains anything', () => {
  const ledger = new InMemoryActionIdempotencyLedger(0);
  ledger.record('key-1', { actionId: 'act-1', outcome: 'x' });
  assert.equal(ledger.getRecorded('key-1'), null);
});

test('a bounded ledger evicts the oldest entry once capacity is exceeded', () => {
  const ledger = new InMemoryActionIdempotencyLedger(2);
  ledger.record('key-1', { actionId: 'act-1', outcome: 'a' });
  ledger.record('key-2', { actionId: 'act-2', outcome: 'b' });
  ledger.record('key-3', { actionId: 'act-3', outcome: 'c' });
  assert.equal(ledger.getRecorded('key-1'), null);
  assert.notEqual(ledger.getRecorded('key-2'), null);
  assert.notEqual(ledger.getRecorded('key-3'), null);
});
