import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDeletionEvent } from '../../dist/retention/deletionStateMachine.js';

function state(overrides = {}) {
  return { entityClass: 'WEB_VISIT', id: 'r1', state: 'ACTIVE', exportExistsExternally: false, ...overrides };
}

test('the full happy path: ACTIVE -> EXPIRY_DUE -> DELETE_REQUESTED -> DELETED_LOCAL -> DELETION_CONFIRMED', () => {
  let current = state();
  current = applyDeletionEvent(current, { kind: 'EXPIRY_DETECTED' }).state;
  assert.equal(current.state, 'EXPIRY_DUE');
  current = applyDeletionEvent(current, { kind: 'DELETION_REQUESTED' }).state;
  assert.equal(current.state, 'DELETE_REQUESTED');
  current = applyDeletionEvent(current, { kind: 'LOCAL_DELETE_COMPLETED' }).state;
  assert.equal(current.state, 'DELETED_LOCAL');
  current = applyDeletionEvent(current, { kind: 'REMOTE_ACKNOWLEDGED' }).state;
  assert.equal(current.state, 'DELETION_CONFIRMED');
});

test('an unreachable remote branches to DELETE_PENDING_REMOTE_DEVICE and can still later confirm', () => {
  let current = state({ state: 'DELETED_LOCAL' });
  const held = applyDeletionEvent(current, { kind: 'REMOTE_UNREACHABLE' });
  assert.equal(held.state.state, 'DELETE_PENDING_REMOTE_DEVICE');
  const confirmed = applyDeletionEvent(held.state, { kind: 'REMOTE_ACKNOWLEDGED' });
  assert.equal(confirmed.state.state, 'DELETION_CONFIRMED');
});

test('re-applying REMOTE_ACKNOWLEDGED to an already-DELETION_CONFIRMED state is an idempotent no-op', () => {
  const confirmed = state({ state: 'DELETION_CONFIRMED' });
  const result = applyDeletionEvent(confirmed, { kind: 'REMOTE_ACKNOWLEDGED' });
  assert.equal(result.applied, true);
  assert.equal(result.state.state, 'DELETION_CONFIRMED');
});

test('replaying a delete request or local completion in an already-progressed state is idempotent', () => {
  const requested = state({ state: 'DELETE_REQUESTED' });
  const requestedReplay = applyDeletionEvent(requested, { kind: 'DELETION_REQUESTED' });
  assert.equal(requestedReplay.applied, true);
  assert.equal(requestedReplay.state, requested);

  const local = state({ state: 'DELETED_LOCAL' });
  const localReplay = applyDeletionEvent(local, { kind: 'LOCAL_DELETE_COMPLETED' });
  assert.equal(localReplay.applied, true);
  assert.equal(localReplay.state, local);
});

test('an invalid transition (e.g. LOCAL_DELETE_COMPLETED on a still-ACTIVE record) is rejected, not silently applied', () => {
  const result = applyDeletionEvent(state({ state: 'ACTIVE' }), { kind: 'LOCAL_DELETE_COMPLETED' });
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'INVALID_TRANSITION');
});

test('EXPORT_CREATED is an additive tag, independent of and never overwriting the current deletion state', () => {
  const confirmed = state({ state: 'DELETION_CONFIRMED' });
  const result = applyDeletionEvent(confirmed, { kind: 'EXPORT_CREATED' });
  assert.equal(result.applied, true);
  assert.equal(result.state.state, 'DELETION_CONFIRMED');
  assert.equal(result.state.exportExistsExternally, true);
});
