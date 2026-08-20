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

// ---- doc 20 PCA-FR-113: every transition result carries a genuinely localized message, never a raw state code ----

test('a successful transition defaults to an English message when no locale is supplied', () => {
  const result = applyDeletionEvent(state({ state: 'EXPIRY_DUE' }), { kind: 'DELETION_REQUESTED' });
  assert.equal(result.applied, true);
  assert.equal(result.message, 'Deletion has been requested for this record.');
});

test('a successful transition carries a genuine Arabic message when locale=ar is requested, with no English leaking in', () => {
  const result = applyDeletionEvent(state({ state: 'EXPIRY_DUE' }), { kind: 'DELETION_REQUESTED' }, 'ar');
  assert.equal(result.applied, true);
  assert.equal(result.message, 'تم تقديم طلب حذف لهذا السجل.');
  assert.equal(/[A-Za-z]/.test(result.message), false);
});

test('an invalid transition still carries a localized message in both locales', () => {
  const enResult = applyDeletionEvent(state({ state: 'ACTIVE' }), { kind: 'LOCAL_DELETE_COMPLETED' }, 'en');
  const arResult = applyDeletionEvent(state({ state: 'ACTIVE' }), { kind: 'LOCAL_DELETE_COMPLETED' }, 'ar');
  assert.equal(enResult.applied, false);
  assert.equal(enResult.message, 'This deletion status update could not be applied.');
  assert.equal(arResult.applied, false);
  assert.equal(arResult.message, 'تعذر تطبيق تحديث حالة الحذف هذا.');
});

test('the full happy path carries a distinct, correctly-localized message at each step in Arabic', () => {
  let current = state();
  let result = applyDeletionEvent(current, { kind: 'EXPIRY_DETECTED' }, 'ar');
  assert.equal(result.message, 'بلغ هذا السجل نهاية فترة الاحتفاظ الخاصة بعائلتك وهو مستحق الحذف.');
  current = result.state;
  result = applyDeletionEvent(current, { kind: 'DELETION_REQUESTED' }, 'ar');
  assert.equal(result.message, 'تم تقديم طلب حذف لهذا السجل.');
  current = result.state;
  result = applyDeletionEvent(current, { kind: 'LOCAL_DELETE_COMPLETED' }, 'ar');
  assert.equal(result.message, 'تم حذف هذا السجل على هذا الجهاز.');
  current = result.state;
  result = applyDeletionEvent(current, { kind: 'REMOTE_ACKNOWLEDGED' }, 'ar');
  assert.equal(result.message, 'تم تأكيد الحذف على جميع أجهزة عائلتك.');
});
