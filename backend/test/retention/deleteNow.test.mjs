import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDeleteNow } from '../../dist/retention/deleteNow.js';
import { InMemoryDeleteNowLedger } from '../../dist/retention/InMemoryDeleteNowLedger.js';

function record(overrides = {}) {
  return { entityClass: 'WEB_VISIT', id: 'r1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

test('Delete Now with a fresh actionId computes and records a plan', () => {
  const ledger = new InMemoryDeleteNowLedger();
  const result = applyDeleteNow('action-1', [record()], ledger, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(result.idempotent, false);
  assert.equal(result.plan.toDelete.length, 1);
});

test('repeat Delete Now with the same actionId returns the identical prior plan, idempotently -- no recomputation', () => {
  const ledger = new InMemoryDeleteNowLedger();
  const first = applyDeleteNow('action-1', [record()], ledger, new Date('2026-02-01T00:00:00.000Z'));
  const second = applyDeleteNow('action-1', [record()], ledger, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.plan, first.plan);
});

test('a duplicated Delete Now action never deletes newer, unrelated data that arrived after the original completed', () => {
  const ledger = new InMemoryDeleteNowLedger();
  const original = applyDeleteNow('action-1', [record({ id: 'r1' })], ledger, new Date('2026-02-01T00:00:00.000Z'));
  assert.deepEqual(original.plan.toDelete.map((e) => e.id), ['r1']);

  // New data ('r2') arrives after the original action completed. A replayed
  // instruction with the same actionId must still resolve to the ORIGINAL
  // plan only -- it must never expand to cover r2.
  const replay = applyDeleteNow('action-1', [record({ id: 'r1' }), record({ id: 'r2' })], ledger, new Date('2026-03-01T00:00:00.000Z'));
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.plan.toDelete.map((e) => e.id), ['r1']);
});

test('two different actionIds are independent -- no cross-contamination', () => {
  const ledger = new InMemoryDeleteNowLedger();
  const a = applyDeleteNow('action-a', [record({ id: 'a1' })], ledger, new Date('2026-02-01T00:00:00.000Z'));
  const b = applyDeleteNow('action-b', [record({ id: 'b1' })], ledger, new Date('2026-02-01T00:00:00.000Z'));
  assert.deepEqual(a.plan.toDelete.map((e) => e.id), ['a1']);
  assert.deepEqual(b.plan.toDelete.map((e) => e.id), ['b1']);
});
