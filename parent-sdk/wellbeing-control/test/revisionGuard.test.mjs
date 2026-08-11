import assert from 'node:assert/strict';
import test from 'node:test';
import { RevisionGuard } from '../dist/revisionGuard.js';

test('a matching expectedRevision with a higher newRevision is accepted', () => {
  const guard = new RevisionGuard(1);
  assert.deepEqual(guard.evaluate('op-1', 1, 2), { kind: 'ACCEPTED', newRevision: 2 });
});

test('a stale expectedRevision is rejected', () => {
  const guard = new RevisionGuard(3);
  const outcome = guard.evaluate('op-1', 1, 2);
  assert.equal(outcome.kind, 'STALE_REJECTED');
  assert.equal(outcome.currentRevision, 3);
});

test('a newRevision that does not advance the counter is rejected even with a correct expectedRevision', () => {
  const guard = new RevisionGuard(5);
  const outcome = guard.evaluate('op-1', 5, 5);
  assert.equal(outcome.kind, 'STALE_REJECTED');
});

test('a replayed operationId is treated as an idempotent no-op after commit', () => {
  const guard = new RevisionGuard(1);
  guard.commit('op-1', 2);
  const outcome = guard.evaluate('op-1', 1, 2);
  assert.deepEqual(outcome, { kind: 'DUPLICATE_NO_OP', operationId: 'op-1' });
});

test('revision advances monotonically across a sequence of commits', () => {
  const guard = new RevisionGuard(1);
  assert.equal(guard.evaluate('op-1', 1, 2).kind, 'ACCEPTED');
  guard.commit('op-1', 2);
  assert.equal(guard.evaluate('op-2', 2, 3).kind, 'ACCEPTED');
  guard.commit('op-2', 3);
  assert.equal(guard.revision, 3);
});

test('a duplicate operationId is a no-op even if presented with a different (higher) revision pair', () => {
  const guard = new RevisionGuard(1);
  guard.commit('op-1', 2);
  const outcome = guard.evaluate('op-1', 2, 3);
  assert.equal(outcome.kind, 'DUPLICATE_NO_OP');
});
