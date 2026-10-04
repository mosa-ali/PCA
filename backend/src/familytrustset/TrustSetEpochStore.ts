import type { OpaqueFamilyId } from './types.js';

/**
 * One durably-persisted, ALREADY-ACCEPTED Family Trust Set epoch: the
 * server-side acceptance history/floors counterpart of the receiving
 * device's own FamilyTrustSetStore (doc 09 Section 3.2/PCA-SEC-017). The
 * server holds this so a later accepted-epoch flow (and, eventually, a
 * device catch-up/floor check) has a durable, monotonic reference of what
 * was accepted -- never as a server-side ACL the server itself enforces.
 *
 * `signedEpochBytes` are the exact canonical bytes that were covered by
 * `signature` (see canonicalize.ts). This layer treats them as opaque and
 * stores them verbatim so a byte-identical redelivery can be recognised as
 * an idempotent retry rather than mistaken for a conflicting epoch.
 */
export interface TrustSetEpochRecord {
  familyId: OpaqueFamilyId;
  trustSetEpoch: number;
  keyEpoch: number;
  supersedesEpoch: number | null;
  signedEpochBytes: Buffer;
  signature: string;
  signerKeyId: string;
  signerDeviceId: string;
  issuedAt: Date;
  /** When this server first durably received the epoch -- caller-supplied, stored verbatim. */
  receivedAt: Date;
}

/**
 * Immutable identity of the head against which an acceptance candidate was
 * validated. The exact signed bytes and signature bind the comparison to
 * the full accepted Trust Set, not only its numeric epoch.
 */
export type ExpectedTrustSetEpochHead = Pick<
  TrustSetEpochRecord,
  'trustSetEpoch' | 'keyEpoch' | 'signedEpochBytes' | 'signature'
>;

/**
 * The outcome of appendAcceptedEpoch. Deliberately a closed result union so
 * a caller can never mistake a rejection for an append. Structurally invalid
 * input throws TrustSetEpochStoreError INVALID_INPUT before any SQL; normal
 * duplicate and stale-head results roll back any transaction-local writes.
 *
 *   APPENDED            -- the epoch was durably inserted and the family's
 *                          acceptance floors were advanced in the same
 *                          transaction.
 *   IDEMPOTENT_MATCH    -- a row for (familyId, trustSetEpoch) already
 *                          exists with the SAME signedEpochBytes, the SAME
 *                          signature and the SAME keyEpoch: this is a
 *                          retry of an epoch that was already accepted.
 *   CONFLICT            -- a row for (familyId, trustSetEpoch) exists but
 *                          differs in bytes, signature or keyEpoch. State
 *                          is unchanged; the caller must treat this as a
 *                          genuine equivocation attempt, never as success.
 *   REJECTED_STALE_AUTHORITY -- the current accepted head no longer matches
 *                          the exact head the caller validated. The append
 *                          is rolled back and must be re-evaluated against
 *                          the new accepted state.
 *   REJECTED_STALE      -- the epoch is below the family's recorded
 *                          acceptance floors (trust-set epoch already
 *                          superseded, or key epoch already rotated past).
 *                          State is unchanged.
 */
export type AppendTrustSetEpochOutcome =
  | { outcome: 'APPENDED' }
  | { outcome: 'IDEMPOTENT_MATCH' }
  | { outcome: 'CONFLICT' }
  | { outcome: 'REJECTED_STALE_AUTHORITY' }
  | { outcome: 'REJECTED_STALE'; reason: 'STALE_TRUST_SET_EPOCH' | 'STALE_KEY_EPOCH' };

/**
 * Durable acceptance-time storage for signed Family Trust Set epochs.
 *
 * PERSISTENCE GRANTS NO AUTHORITY. A row in this store only records that an
 * epoch was accepted by an acceptance flow at some moment; it does not by
 * itself grant, extend or renew any role, membership or key authority, and
 * nothing may treat a stored row as evidence that a signature was verified
 * -- signature verification belongs to the acceptance flow that calls
 * `appendAcceptedEpoch` strictly AFTER it has fully accepted the epoch.
 *
 * ONLY a future accepted-epoch flow (the ordinary FamilyTrustSetEngine
 * acceptance path, and later the recovery path, once wired) may call
 * `appendAcceptedEpoch`. No resolver, route, verifier or policy component
 * may write here.
 */
export interface TrustSetEpochStore {
  /**
   * Append one ALREADY-ACCEPTED epoch and advance the family's acceptance
   * floors atomically. This method performs NO signature or structural
   * acceptance itself -- the caller owns that judgement; this store only
   * enforces durability, per-family serialization, idempotency and the
   * anti-rollback floors. `expectedHead` is the exact accepted head used by
   * the caller's validation; `null` means validation observed no accepted
   * epoch. The store snapshots it before asynchronous work and compares it
   * under the family lock before an ordinary append. It does not verify the
   * candidate signature or bind this head into the candidate's signed bytes.
   *
   * Throws TrustSetEpochStoreError('INVALID_INPUT') for structurally
   * malformed input BEFORE any database operation.
   */
  appendAcceptedEpoch(
    record: TrustSetEpochRecord,
    expectedHead: ExpectedTrustSetEpochHead | null,
  ): Promise<AppendTrustSetEpochOutcome>;

  /**
   * The latest accepted epoch for the family (highest trustSetEpoch), or
   * `null`.
   *
   * `null` is load-bearing, exactly as in FamilyTrustSetStore: it means
   * "no epoch has EVER been durably accepted for this family". An
   * implementation MUST guarantee `null` is returned ONLY for that genuine
   * never-initialized state and MUST NEVER return `null` because of a
   * transient read failure, a corrupted/partially-wiped store, or any
   * other error condition once a real epoch has been persisted -- a
   * persistent implementation must raise/throw on a genuine read failure,
   * never fall back to `null`, since a false "never initialized" answer
   * would let a later flow silently re-trigger trust-on-first-use.
   */
  readLatestEpoch(familyId: OpaqueFamilyId): Promise<TrustSetEpochRecord | null>;

  /** All accepted epochs for the family, ASCENDING by trustSetEpoch. */
  listEpochs(familyId: OpaqueFamilyId): Promise<TrustSetEpochRecord[]>;
}

/**
 * The only failure mode appendAcceptedEpoch raises: structurally invalid
 * input, detected before any SQL runs. Every other submission outcome is
 * reported through AppendTrustSetEpochOutcome, never silently absorbed.
 */
export class TrustSetEpochStoreError extends Error {
  readonly code: 'INVALID_INPUT' = 'INVALID_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'TrustSetEpochStoreError';
  }
}
