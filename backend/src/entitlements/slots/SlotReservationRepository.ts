import type { OpaqueFamilyId, SlotReleaseReason, SlotReservationRecord } from '../types.js';

export type ReserveOutcome =
  | { outcome: 'RESERVED'; record: SlotReservationRecord }
  | { outcome: 'ALREADY_RESERVED_FOR_INVITATION'; record: SlotReservationRecord }
  | { outcome: 'NO_AVAILABLE_SLOT' }
  | { outcome: 'ENTITLEMENT_NOT_FOUND' };

export type ReleaseOutcome = { outcome: 'RELEASED' } | { outcome: 'ALREADY_RELEASED' } | { outcome: 'ALREADY_CONSUMED' } | { outcome: 'NOT_FOUND' };

export type ConsumeOutcome = { outcome: 'CONSUMED' } | { outcome: 'ALREADY_CONSUMED' } | { outcome: 'INVALID_STATE' } | { outcome: 'NOT_FOUND' };

/**
 * Persistence port for the concurrency-safe managed-device slot pipeline
 * (PCA-ADD-PA-036/037/038). `reserve` is the release-blocking correctness
 * primitive this workstream exists to get right: it MUST evaluate
 * "reserved + active < limit" and create the reservation row atomically,
 * via a single row lock on the family's account_entitlements row (never a
 * separate COUNT-then-INSERT).
 */
export interface SlotReservationRepository {
  reserve(familyId: OpaqueFamilyId, invitationId: string, now: Date, expiresAt: Date): Promise<ReserveOutcome>;
  releaseByInvitationId(invitationId: string, reason: SlotReleaseReason, now: Date): Promise<ReleaseOutcome>;
  consumeByInvitationId(invitationId: string, now: Date): Promise<ConsumeOutcome>;
  /** Lazily releases every RESERVED reservation for `familyId` whose expiresAt has passed. Returns the count released. */
  reconcileExpiredForFamily(familyId: OpaqueFamilyId, now: Date): Promise<number>;
  findByInvitationId(invitationId: string): Promise<SlotReservationRecord | null>;
  listForFamily(familyId: OpaqueFamilyId): Promise<SlotReservationRecord[]>;
}
