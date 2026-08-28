import type { PoolConnection } from 'mysql2/promise';
import type { FamilyMemberInvitationId, FamilyMemberInvitationRecord, InvitedFamilyRole, OpaqueAccountId, OpaqueFamilyId } from './types.js';

export type AcceptResult =
  | { outcome: 'ACCEPTED'; record: FamilyMemberInvitationRecord }
  | { outcome: 'ALREADY_ACCEPTED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Runs inside the SAME transaction as acceptAtomically's accepting UPDATE,
 * after that UPDATE has succeeded and before it commits. Throwing rolls the
 * acceptance back, so a caller can attach an effect that must never drift
 * from the invitation's own lifecycle (see
 * FamilyMemberInvitationService.acceptInvitation's parent-member seat
 * consumption). `conn` is the transaction's own connection -- the same
 * "hand the caller the connection it must use" convention
 * `EntitlementRepository.lockForFamily/adjustParentMemberUsedCount` already
 * establish. An implementation with no real transaction (the in-memory test
 * double) passes null and is documented as such.
 */
export type AcceptTransactionHook = (conn: PoolConnection, record: FamilyMemberInvitationRecord) => Promise<void>;

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
  /**
   * IDENTITY BINDING (required of every implementation): acceptance MUST be
   * refused unless the accepting account's own registered email hash equals
   * this invitation's `invited_email_hash`, and that check MUST be part of
   * the same atomic guard as the status/expiry predicates -- never a
   * separate read-then-write pair. Without it, any authenticated account
   * that merely learns an invitationId can take the role a completely
   * different person was invited to. A non-addressee is reported as
   * NOT_FOUND, deliberately indistinguishable from a nonexistent
   * invitation, matching this repository's family-scoped IDOR posture
   * everywhere else -- and checked BEFORE the revoked/accepted/expired
   * disambiguation, so a stranger learns nothing about an invitation's real
   * state either.
   */
  acceptAtomically(
    invitationId: FamilyMemberInvitationId,
    acceptedByAccountId: OpaqueAccountId,
    acceptedAt: Date,
    onAcceptedInTransaction?: AcceptTransactionHook,
  ): Promise<AcceptResult>;
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
  /**
   * Revises a still-PENDING invitation's offered role -- e.g. an Owner
   * realizes they meant VIEWER, not ADMINISTRATOR, before the person has
   * accepted. Family-scoped exactly like revokeForFamily. Returns null if
   * no PENDING invitation with that id exists in that family (already
   * accepted/expired/revoked, or never existed, or wrong family --
   * deliberately not disambiguated, same IDOR-avoidance posture as every
   * other family-scoped lookup in this repository).
   */
  updateRoleForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId, newRole: InvitedFamilyRole): Promise<FamilyMemberInvitationRecord | null>;
}
