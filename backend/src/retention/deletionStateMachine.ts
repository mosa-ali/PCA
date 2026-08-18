import type { DeletionRecordState, DeletionState } from './types.js';

export type DeletionEvent =
  | { kind: 'EXPIRY_DETECTED' }
  | { kind: 'DELETION_REQUESTED' } // local purge, or a cross-device "delete now"/deletion-instruction attempt initiated
  | { kind: 'LOCAL_DELETE_COMPLETED' }
  | { kind: 'REMOTE_UNREACHABLE' }
  | { kind: 'REMOTE_ACKNOWLEDGED' }
  | { kind: 'EXPORT_CREATED' }; // additive tag, never changes `state`

/**
 * doc 11 Section 5.1's state machine: `ACTIVE -> EXPIRY_DUE ->
 * DELETE_REQUESTED -> DELETED_LOCAL -> DELETION_CONFIRMED`, with
 * `DELETE_PENDING_REMOTE_DEVICE` as an alternate branch when a
 * counterpart cannot be reached. Transitions are idempotent (re-applying
 * an event already reflected in the current state is a no-op, never an
 * error) and this function never regresses a state backward except via
 * the explicit REMOTE_UNREACHABLE branch, which is itself a legitimate
 * "waiting" state, not a rollback of the deletion decision.
 */
const VALID_TRANSITIONS: Record<DeletionState, Partial<Record<DeletionEvent['kind'], DeletionState>>> = {
  ACTIVE: { EXPIRY_DETECTED: 'EXPIRY_DUE', DELETION_REQUESTED: 'DELETE_REQUESTED' }, // DELETION_REQUESTED covers "delete now" acting on a still-ACTIVE record
  EXPIRY_DUE: { EXPIRY_DETECTED: 'EXPIRY_DUE', DELETION_REQUESTED: 'DELETE_REQUESTED', LOCAL_DELETE_COMPLETED: 'DELETED_LOCAL' },
  DELETE_REQUESTED: { DELETION_REQUESTED: 'DELETE_REQUESTED', LOCAL_DELETE_COMPLETED: 'DELETED_LOCAL', REMOTE_UNREACHABLE: 'DELETE_PENDING_REMOTE_DEVICE' },
  DELETED_LOCAL: { DELETION_REQUESTED: 'DELETED_LOCAL', LOCAL_DELETE_COMPLETED: 'DELETED_LOCAL', REMOTE_ACKNOWLEDGED: 'DELETION_CONFIRMED', REMOTE_UNREACHABLE: 'DELETE_PENDING_REMOTE_DEVICE' },
  DELETE_PENDING_REMOTE_DEVICE: { DELETION_REQUESTED: 'DELETE_PENDING_REMOTE_DEVICE', LOCAL_DELETE_COMPLETED: 'DELETE_PENDING_REMOTE_DEVICE', REMOTE_UNREACHABLE: 'DELETE_PENDING_REMOTE_DEVICE', REMOTE_ACKNOWLEDGED: 'DELETION_CONFIRMED' },
  DELETION_CONFIRMED: { DELETION_REQUESTED: 'DELETION_CONFIRMED', LOCAL_DELETE_COMPLETED: 'DELETION_CONFIRMED' },
};

export type TransitionResult = { applied: true; state: DeletionRecordState } | { applied: false; reason: 'INVALID_TRANSITION' };

/**
 * `applied: false` on an event that doesn't advance the current state --
 * NOT an error signal for the caller to surface, just "nothing to do";
 * distinguished from `applied: true` (idempotent no-op included, when the
 * event's target state equals the current state) only so a caller can log
 * an unexpected/out-of-order event without this function ever silently
 * corrupting the state on a bogus transition.
 */
export function applyDeletionEvent(current: DeletionRecordState, event: DeletionEvent): TransitionResult {
  if (event.kind === 'EXPORT_CREATED') {
    return { applied: true, state: { ...current, exportExistsExternally: true } };
  }
  if (event.kind === 'REMOTE_ACKNOWLEDGED' && current.state === 'DELETION_CONFIRMED') {
    return { applied: true, state: current }; // idempotent: already confirmed
  }
  const nextState = VALID_TRANSITIONS[current.state][event.kind];
  if (nextState === undefined) {
    return { applied: false, reason: 'INVALID_TRANSITION' };
  }
  return { applied: true, state: nextState === current.state ? current : { ...current, state: nextState } };
}
