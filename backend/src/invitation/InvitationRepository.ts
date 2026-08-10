import type { InvitationId, InvitationRecord, OpaqueFamilyId } from './types.js';

export type RedemptionResult =
  | { outcome: 'REDEEMED'; record: InvitationRecord }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Persistence port for the invitation lifecycle. INV-A ships this interface
 * plus a deterministic in-memory implementation confined to test support.
 * The production PostgreSQL implementation (INV-B) is a separate slice and
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
  redeemAtomically(invitationId: InvitationId, redeemedAt: Date): Promise<RedemptionResult>;
  revoke(invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord>;
  /**
   * Family-scoped revoke: the UPDATE itself is filtered by family_id (not
   * just a preceding read), so this method alone can never revoke another
   * family's invitation even if a future caller skips an ownership check.
   * Returns null if no invitation with that id exists in that family.
   */
  revokeForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord | null>;
}
