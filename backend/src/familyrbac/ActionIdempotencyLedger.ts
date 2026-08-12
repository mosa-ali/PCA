import { ACTION_IDEMPOTENCY_LEDGER_CAPACITY } from './policy.js';
import type { ActionId, IdempotencyKey } from './types.js';

/**
 * doc 18 Section 3: every parent action carries a "unique action ID and
 * idempotency key." This is an APPLICATION-level exactly-once-authorization
 * guarantee scoped to PCA-10's own authorize() call -- deliberately NOT the
 * wire-level anti-replay/ordering that familyenvelope's ReplayLedger or a
 * future PCA-11 transport owns (see doc-mandated separation in section 10
 * of the lane brief: no message replay ledgers here). A legitimate retry
 * of the SAME actionId/idempotencyKey by the same actor must return the
 * SAME prior authorization outcome rather than being re-evaluated (which
 * could differ if trust-set state changed in between) or rejected.
 */
export interface RecordedAuthorization {
  actionId: ActionId;
  // Optional: this ledger type is also reused by unrelated directive-replay callers outside familyrbac that
  // never populate it. ParentActionAuthorizationService always sets and checks it to bind a cached outcome
  // to the exact request shape (family/actor/operation/target) it was computed for -- an idempotencyKey/
  // actionId pair reused with a MUTATED target (see PCA10) must never ride the ORIGINAL target's verdict.
  requestFingerprint?: string;
  outcome: string; // opaque, caller-defined serialized AuthorizationDecision
}

export interface ActionIdempotencyLedger {
  getRecorded(idempotencyKey: IdempotencyKey): RecordedAuthorization | null;
  record(idempotencyKey: IdempotencyKey, recorded: RecordedAuthorization): void;
}

export class InMemoryActionIdempotencyLedger implements ActionIdempotencyLedger {
  private readonly byKey = new Map<IdempotencyKey, RecordedAuthorization>();
  private readonly capacity: number;

  constructor(capacity: number = ACTION_IDEMPOTENCY_LEDGER_CAPACITY) {
    this.capacity = capacity;
  }

  getRecorded(idempotencyKey: IdempotencyKey): RecordedAuthorization | null {
    return this.byKey.get(idempotencyKey) ?? null;
  }

  record(idempotencyKey: IdempotencyKey, recorded: RecordedAuthorization): void {
    if (this.capacity <= 0) return;
    if (!this.byKey.has(idempotencyKey) && this.byKey.size >= this.capacity) {
      const oldestKey = this.byKey.keys().next().value;
      if (oldestKey !== undefined) this.byKey.delete(oldestKey);
    }
    this.byKey.set(idempotencyKey, recorded);
  }
}
