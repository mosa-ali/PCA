import type { EnvelopeRejectionReason } from '../familyenvelope/FamilyEnvelopeVerifier.js';
import type { FamilyEnvelope, MessageId, OpaqueFamilyId, SenderKeyId } from '../familyenvelope/types.js';

/**
 * This module is the PCA-11 synchronization COORDINATOR layer: it sits in
 * front of FamilyEnvelopeVerifier.evaluateEnvelope (the accepted security
 * pipeline this module never reimplements -- see SyncCoordinator.ts) and
 * adds exactly one new capability the underlying verifier's own doc
 * comment discloses it does NOT have: holding a future, dependency-gated
 * envelope pending until its predecessor arrives or it expires, instead of
 * either applying it immediately (unsafe skip) or rejecting it outright
 * (data loss for a legitimately-delayed message).
 */

export type SyncDependencyReason = 'MISSING_SEQUENCE_PREDECESSOR' | 'MISSING_CORRELATION_PREDECESSOR';

export type SyncRejectReason =
  | EnvelopeRejectionReason
  | 'SEQUENCE_NOT_MONOTONIC'
  | 'PENDING_MESSAGE_ID_CONFLICT'
  | 'PENDING_ENVELOPE_TOO_LARGE'
  | 'PENDING_FAMILY_QUEUE_FULL'
  | 'PENDING_SENDER_QUEUE_FULL'
  | 'PENDING_GLOBAL_QUEUE_FULL';

/**
 * The three outcomes doc-required by the PCA-11 brief. `idempotent` on
 * APPLY_NOW mirrors EnvelopeVerdict's own idempotent flag (a byte-identical
 * redelivery of an already-applied envelope). HOLD_PENDING never implies
 * trust -- see SyncCoordinator's "do not invent family authority" note.
 */
export type SyncDecision =
  | { kind: 'APPLY_NOW'; idempotent: boolean }
  | { kind: 'HOLD_PENDING'; reason: SyncDependencyReason; waitingOnMessageId?: MessageId; waitingOnSequence?: number }
  | { kind: 'REJECT'; reason: SyncRejectReason };

/**
 * A held envelope. Retained verbatim (still-encrypted/opaque payload) so
 * it can be re-run through the FULL security pipeline -- signature,
 * replay, expiry, epoch, version -- at drain time; a pending item is never
 * pre-trusted (doc "a pending item does not become valid merely because
 * ... it waited long enough").
 *
 * `effectiveExpiresAt` is `min(envelope.expiresAt, receivedAt +
 * maxPendingLifetimeMs)` -- a bounded-queue defense-in-depth ceiling
 * independent of whatever expiry the envelope itself declares, so a
 * pathologically long-lived but structurally valid envelope cannot pin
 * queue memory indefinitely.
 */
export interface PendingEnvelopeRecord {
  familyId: OpaqueFamilyId;
  senderKeyId: SenderKeyId;
  messageId: MessageId;
  envelope: FamilyEnvelope;
  canonicalBytes: string;
  receivedAt: Date;
  effectiveExpiresAt: Date;
  reason: SyncDependencyReason;
  waitingOnMessageId: MessageId | null;
  waitingOnSequence: number | null;
}

export type SyncConnectionState = 'OFFLINE' | 'SYNC_PENDING' | 'SYNCING' | 'LIVE' | 'STALE';

export type SyncOutcomeKind = 'RECEIVED' | 'HELD_PENDING' | 'APPLIED' | 'REJECTED' | 'EXPIRED';

/**
 * Local, metadata-only status record -- never family plaintext (doc "PCA
 * infrastructure must not learn readable policy/request content/location/
 * activity/deletion reason/family messages"). Turning this into an
 * outbound, family-E2EE POLICY_RECEIPT/RETENTION_RECEIPT FamilyEnvelope is
 * the caller's job, composed with payload-crypto machinery this
 * protocol-neutral core does not own (CRYPTO_SUITE =
 * PENDING_HUMAN_SECURITY_REVIEW).
 */
export interface SyncReceipt {
  familyId: OpaqueFamilyId;
  messageId: MessageId;
  outcome: SyncOutcomeKind;
  atUtc: Date;
  reason: string | null;
}
