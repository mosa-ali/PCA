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

export type CreateInvitationResult =
  | { outcome: 'CREATED' }
  | { outcome: 'DUPLICATE_PENDING_INVITATION' }
  | { outcome: 'CAPACITY_EXCEEDED' };

/**
 * The seat-capacity decision, evaluated INSIDE createAtomically's own
 * transaction so it cannot be raced.
 *
 * Split into two calls on purpose. `lock` is the serialization point: it
 * takes the family's entitlement row with SELECT ... FOR UPDATE (exactly
 * what MySqlSlotReservationRepository.reserve does before its own
 * availability check), so two concurrent invitations for the same family
 * cannot both evaluate capacity against the same pre-insert state.
 * `evaluate` then runs on that SAME locked connection, after the live
 * pending-invitation rows have been counted under the lock, and returns the
 * verdict. Splitting them is what lets the repository take the two locks in
 * a single, consistent order (invitations, then entitlements -- the same
 * order acceptAtomically uses) without a lock-order inversion.
 */
export interface CreateInvitationCapacityGuard {
  /** Lock the family's entitlement row on `conn`. Must not mutate anything. */
  lock(conn: PoolConnection, familyId: OpaqueFamilyId): Promise<void>;
  /**
   * Verdict for admitting ONE more pending invitation, given how many live
   * PENDING invitations the family already holds. Must read only through
   * `conn` so it observes the lock taken above.
   */
  evaluate(conn: PoolConnection, familyId: OpaqueFamilyId, livePendingInvitationCount: number): Promise<'ALLOW' | 'CAPACITY_EXCEEDED'>;
}

export type RemoveMemberResult =
  | { outcome: 'REMOVED' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_A_MEMBER' }
  | { outcome: 'CANNOT_REMOVE_OWNER' };

/**
 * Runs inside the SAME transaction as removeMemberAtomically's guarded
 * UPDATE, after that UPDATE has succeeded and before it commits -- the
 * exact mirror-image of AcceptTransactionHook above (there: consume a
 * seat after ACCEPTED; here: release one after REMOVED). Throwing rolls
 * the removal back, so the family_id clear can never drift from the seat
 * count. `conn` is the transaction's own connection.
 */
export type RemoveMemberTransactionHook = (conn: PoolConnection, familyId: OpaqueFamilyId, removedAccountId: OpaqueAccountId) => Promise<void>;

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
  /**
   * Issues an invitation, with the duplicate-pending check, the seat-capacity
   * check, and the INSERT in ONE transaction under row locks.
   *
   * This REPLACED a bare `create()`. Those three steps used to run as three
   * independent transactions with no locking, so two concurrent invitations
   * for the same family could both pass and produce a duplicate pending
   * invitation and seats beyond the paid entitlement. Implementations MUST
   * guarantee that, for a given family, only one caller can observe "no
   * pending invitation for this email" / "a seat is free" and act on it --
   * the same guarantee acceptAtomically already gives for redemption, and
   * MySqlSlotReservationRepository.reserve for device slots.
   *
   * Time-expired-but-still-PENDING rows are transitioned to EXPIRED inside
   * the same transaction before the decision (the persisted transition
   * expireIfDue already defines), so a stale pending invitation neither
   * blocks a re-invite nor holds a seat.
   *
   * DUPLICATE_PENDING_INVITATION must also be reported when the database's
   * own uniqueness backstop rejects the INSERT -- never surfaced as an
   * unhandled duplicate-key error.
   */
  createAtomically(
    record: FamilyMemberInvitationRecord,
    now: Date,
    capacityGuard?: CreateInvitationCapacityGuard,
  ): Promise<CreateInvitationResult>;
  findByIdForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId): Promise<FamilyMemberInvitationRecord | null>;
  /**
   * Read-only lookup of the family's current PENDING invitation for an
   * email. NOT a concurrency guard: the duplicate-pending invariant is
   * enforced by createAtomically's locked transaction plus the
   * UNIQUE(family_id, pending_invited_email_hash) key from migration 0035.
   */
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
  /**
   * Atomically clears the target account's membership in this family
   * (the parent_accounts.family_id -> NULL transition -- the durable
   * "removed" state this schema already supports, see
   * MySqlFamilyMemberAccountBinder's own precedent for writing that same
   * column) and, via `onRemovedInTransaction`, releases the parent-member
   * seat it consumed, in the SAME transaction. Mirrors acceptAtomically's
   * guarded-UPDATE + disambiguating-SELECT shape exactly, in reverse.
   *
   * OWNER PROTECTION: this schema has no durable OWNER-role column
   * anywhere reachable from this domain (see FamilyMemberInvitationService
   * .removeMember's own doc comment for the full reasoning) -- an account
   * currently bound to `familyId` that holds no ACCEPTED
   * family_member_invitations row for this family is, by construction,
   * this family's Owner (the account whose OWN email verification created
   * it -- ParentAccountService.attemptFamilyGenesis's "no join-an-
   * existing-family path" invariant), and removal is refused
   * (CANNOT_REMOVE_OWNER). Ownership is never revoked through this method.
   *
   * IDEMPOTENT / DOUBLE-FREE SAFE: an account no longer bound to
   * `familyId` (already removed, or never a member of it) reports
   * NOT_A_MEMBER and neither mutates parent_accounts nor invokes
   * `onRemovedInTransaction` -- a retried removal can never double-release
   * a seat. An unknown accountId reports NOT_FOUND. Both outcomes are
   * family-scoped exactly like every other lookup in this repository: an
   * account genuinely bound to a DIFFERENT family also reports
   * NOT_A_MEMBER, never leaking which family it actually belongs to.
   */
  removeMemberAtomically(
    familyId: OpaqueFamilyId,
    targetAccountId: OpaqueAccountId,
    removedAt: Date,
    onRemovedInTransaction?: RemoveMemberTransactionHook,
  ): Promise<RemoveMemberResult>;
}
