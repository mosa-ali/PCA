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

/**
 * The opaque owner namespace an idempotency key must never collide across.
 *
 * This exists because two callers share this ledger for genuinely unrelated
 * purposes: familyrbac records per-family parent-action authorizations, and
 * ModelLifecycleService records platform-wide emergency-directive replays by
 * directiveId. With no scope those two key spaces would overlap, and so would
 * two different families' -- one writer could displace another's record, and
 * any caller could evict another owner's replay protection by guessing keys.
 *
 * It is deliberately a free-form string rather than a familyId: the platform
 * caller belongs to no family. Both real callers derive it from
 * already-authenticated identity (see ParentActionAuthorizationService and
 * ModelLifecycleService), never from request-supplied content.
 */
export type IdempotencyScope = string;

/**
 * The scope ModelLifecycleService records emergency-directive replays under.
 * One platform-wide namespace, matching the directives themselves: a model
 * rollback/disable directive is a platform artifact, not a family one.
 */
export const PLATFORM_EMERGENCY_DIRECTIVE_SCOPE = 'platform:model-emergency-directive' as const;

export interface ActionIdempotencyLedger {
  getRecorded(scope: IdempotencyScope, idempotencyKey: IdempotencyKey): Promise<RecordedAuthorization | null>;
  record(scope: IdempotencyScope, idempotencyKey: IdempotencyKey, recorded: RecordedAuthorization): Promise<void>;
}

/**
 * Bounded, in-memory reference ActionIdempotencyLedger.
 *
 * FIRST WRITER WINS, and the durable implementation must agree on that:
 * `record` for a (scope, key) that is already present is a no-op, never an
 * overwrite. The durable implementation gets this for free from a plain INSERT
 * arbitrated by the primary key (mirroring MySqlMessageIdempotencyLedger's
 * "never silently overwrite" discipline), and it is the safer of the two
 * options here: overwriting would let a caller that reuses another owner's key
 * permanently displace that owner's recorded authorization, so the owner's
 * next legitimate retry would silently become a re-evaluation. A mismatching
 * (actionId, requestFingerprint) already forces a fresh evaluation at the call
 * site, so keeping the first record costs nothing and preserves it.
 *
 * The capacity bound is GLOBAL across scopes, not per scope, and eviction is
 * FIFO by insertion order -- matching what this class did before scopes
 * existed. A per-scope bound would not bound memory at all, since the number
 * of scopes is not bounded by anything this class controls, and unbounded
 * memory in a replay-protection structure is the failure mode to avoid.
 */
export class InMemoryActionIdempotencyLedger implements ActionIdempotencyLedger {
  private readonly byScope = new Map<IdempotencyScope, Map<IdempotencyKey, RecordedAuthorization>>();
  /** Insertion order across every scope, so eviction is genuinely oldest-first. */
  private readonly insertionOrder: Array<readonly [IdempotencyScope, IdempotencyKey]> = [];
  private readonly capacity: number;

  constructor(capacity: number = ACTION_IDEMPOTENCY_LEDGER_CAPACITY) {
    this.capacity = capacity;
  }

  async getRecorded(scope: IdempotencyScope, idempotencyKey: IdempotencyKey): Promise<RecordedAuthorization | null> {
    return this.byScope.get(scope)?.get(idempotencyKey) ?? null;
  }

  async record(scope: IdempotencyScope, idempotencyKey: IdempotencyKey, recorded: RecordedAuthorization): Promise<void> {
    if (this.capacity <= 0) return;
    const existing = this.byScope.get(scope);
    if (existing?.has(idempotencyKey)) return; // first writer wins -- see this class's doc comment

    if (this.insertionOrder.length >= this.capacity) this.evictOldest();

    const scopeEntries = existing ?? new Map<IdempotencyKey, RecordedAuthorization>();
    if (!existing) this.byScope.set(scope, scopeEntries);
    scopeEntries.set(idempotencyKey, recorded);
    this.insertionOrder.push([scope, idempotencyKey]);
  }

  private evictOldest(): void {
    const oldest = this.insertionOrder.shift();
    if (oldest === undefined) return;
    const [scope, idempotencyKey] = oldest;
    const scopeEntries = this.byScope.get(scope);
    if (scopeEntries === undefined) return;
    scopeEntries.delete(idempotencyKey);
    if (scopeEntries.size === 0) this.byScope.delete(scope);
  }
}
