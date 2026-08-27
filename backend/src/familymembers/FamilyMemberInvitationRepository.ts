import type { FamilyMemberInvitationId, FamilyMemberInvitationRecord, OpaqueAccountId, OpaqueFamilyId } from './types.js';

export type AcceptResult =
  | { outcome: 'ACCEPTED'; record: FamilyMemberInvitationRecord }
  | { outcome: 'ALREADY_ACCEPTED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Persistence port for the family-member invitation lifecycle, mirroring
 * InvitationRepository.ts's shape and its "family-scoped by design" IDOR
 * defense (an invitation belonging to a different family must be
 * indistinguishable from a nonexistent one).
 *
 * acceptAtomically MUST guarantee exactly one caller observes ACCEPTED for
 * a given invitation even under concurrent attempts -- same guarantee as
 * InvitationRepository.redeemAtomically for device redemption.
 */
export interface FamilyMemberInvitationRepository {
  create(record: FamilyMemberInvitationRecord): Promise<void>;
  findByIdForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId): Promise<FamilyMemberInvitationRecord | null>;
  /** Used to enforce "at most one PENDING invitation per (family, email)" -- see FamilyMemberInvitationService.createInvitation. */
  findPendingByFamilyAndEmailHash(familyId: OpaqueFamilyId, invitedEmailHash: Buffer): Promise<FamilyMemberInvitationRecord | null>;
  listForFamily(familyId: OpaqueFamilyId): Promise<FamilyMemberInvitationRecord[]>;
  acceptAtomically(invitationId: FamilyMemberInvitationId, acceptedByAccountId: OpaqueAccountId, acceptedAt: Date): Promise<AcceptResult>;
  /**
   * Family-scoped revoke: the UPDATE itself is filtered by family_id (not
   * just a preceding read), so this method alone can never revoke another
   * family's invitation even if a future caller skips an ownership check.
   * Returns null if no invitation with that id exists in that family.
   */
  revokeForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId, revokedAt: Date): Promise<FamilyMemberInvitationRecord | null>;
  /**
   * Writes a real, persisted EXPIRED transition the first time this is
   * called for a record that is past expiresAt and still PENDING.
   * Idempotent no-op returning the current record unchanged if the record
   * is not yet due, or already terminal (ACCEPTED/EXPIRED/REVOKED). Throws
   * if the invitation does not exist.
   */
  expireIfDue(invitationId: FamilyMemberInvitationId, at: Date): Promise<FamilyMemberInvitationRecord>;
}
