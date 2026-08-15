import type { InvitationId, InvitationRecord, OpaqueFamilyId } from './types.js';

export type RedemptionResult =
  | { outcome: 'REDEEMED'; record: InvitationRecord }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Result of an INSTALL_REQUIRED / APP_INSTALLED / AUTHORIZATION_REQUIRED
 * forward-progress transition (PCA-ADD-ENR-005). ALREADY_IN_STATE is a
 * non-error idempotent outcome (the record was already at the requested
 * target status -- a client retry or duplicate report is safe). INVALID_STATE
 * covers an out-of-order request (e.g. requesting INSTALL_REQUIRED after the
 * record already reached AUTHORIZATION_REQUIRED) that is neither a no-op nor
 * one of the other named terminal outcomes.
 */
export type TransitionResult =
  | { outcome: 'TRANSITIONED'; record: InvitationRecord }
  | { outcome: 'ALREADY_IN_STATE'; record: InvitationRecord }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'INVALID_STATE' };

/**
 * Persistence port for the invitation lifecycle. INV-A ships this interface
 * plus a deterministic in-memory implementation confined to test support.
 * MySqlInvitationRepository (INV-B) is the production implementation and
 * must not be faked or assumed here.
 *
 * redeemAtomically MUST guarantee exactly one caller observes REDEEMED for a
 * given invitation even under concurrent attempts.
 */
export interface InvitationRepository {
  create(record: InvitationRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  /** Family-scoped by design: an invitation belonging to a different family must be indistinguishable from a nonexistent one. */
  findByIdForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId): Promise<InvitationRecord | null>;
  listForFamily(familyId: OpaqueFamilyId): Promise<InvitationRecord[]>;
  markOpened(invitationId: InvitationId, openedAt: Date): Promise<InvitationRecord>;
  /** PCA-ADD-ENR-005/008: CREATED/OPENED -> INSTALL_REQUIRED (child device reports the app is not yet installed, about to hand off to the store). */
  markInstallRequired(invitationId: InvitationId, at: Date): Promise<TransitionResult>;
  /** PCA-ADD-ENR-005/008: CREATED/OPENED/INSTALL_REQUIRED -> APP_INSTALLED (install/App Link continuation resumed enrollment). */
  markAppInstalled(invitationId: InvitationId, at: Date): Promise<TransitionResult>;
  /** PCA-ADD-ENR-005: CREATED/OPENED/INSTALL_REQUIRED/APP_INSTALLED -> AUTHORIZATION_REQUIRED (device bootstrap material prepared, awaiting parent authorization). */
  markAuthorizationRequired(invitationId: InvitationId, at: Date): Promise<TransitionResult>;
  redeemAtomically(invitationId: InvitationId, redeemedAt: Date): Promise<RedemptionResult>;
  revoke(invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord>;
  /**
   * Family-scoped revoke: the UPDATE itself is filtered by family_id (not
   * just a preceding read), so this method alone can never revoke another
   * family's invitation even if a future caller skips an ownership check.
   * Returns null if no invitation with that id exists in that family.
   */
  revokeForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord | null>;
  /**
   * PCA-ADD-ENR-005: writes a real, audited EXPIRED transition the first
   * time this is called for a record that is past expiresAt and still
   * non-terminal (CREATED/OPENED/INSTALL_REQUIRED/APP_INSTALLED/
   * AUTHORIZATION_REQUIRED). Idempotent no-op returning the current record
   * unchanged if the record is not yet due, or already terminal
   * (REDEEMED/EXPIRED/REVOKED). Throws if the invitation does not exist.
   */
  expireIfDue(invitationId: InvitationId, at: Date): Promise<InvitationRecord>;
}
