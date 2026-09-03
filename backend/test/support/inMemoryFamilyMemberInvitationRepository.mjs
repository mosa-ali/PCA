// Deterministic in-memory FamilyMemberInvitationRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
// Mirrors inMemoryInvitationRepository.mjs's established shape/conventions.
const TERMINAL_STATUSES = new Set(['ACCEPTED', 'EXPIRED', 'REVOKED']);

/**
 * `accountEmailHashes` is this double's stand-in for the parent_accounts
 * rows the MySQL implementation JOINs against to enforce
 * acceptAtomically's IDENTITY BINDING contract (see
 * FamilyMemberInvitationRepository.ts). Map of accountId -> Buffer email
 * hash. An accepting account with no entry is treated exactly as the real
 * implementation treats a missing parent_accounts row: fail closed,
 * reported as NOT_FOUND.
 *
 * `accountFamilyIds` is this double's stand-in for parent_accounts'
 * family_id column -- what removeMemberAtomically reads/clears. Map of
 * accountId -> familyId|null. An accountId with no entry at all mirrors a
 * row that does not exist (NOT_FOUND); an entry whose value is null or a
 * different family mirrors "not currently a member of this family"
 * (NOT_A_MEMBER, including "already removed"). NOTE: unlike the real
 * schema, accepting an invitation in THIS double does not itself populate
 * accountFamilyIds (the real FamilyMemberAccountBinder write is a
 * best-effort step the SERVICE performs separately, outside this
 * repository's own transaction -- see FamilyMemberInvitationService
 * .acceptInvitation) -- tests that need a removable member seed this map
 * directly via _setAccountFamilyIdForTest, exactly like accountEmailHashes.
 */
export function createInMemoryFamilyMemberInvitationRepository({ accountEmailHashes = new Map(), accountFamilyIds = new Map() } = {}) {
  const byId = new Map();
  const accountFamilyId = new Map(accountFamilyIds);

  function isAddressee(accountId, record) {
    const hash = accountEmailHashes.get(accountId);
    return Boolean(hash) && Buffer.compare(hash, record.invitedEmailHash) === 0;
  }

  return {
    // Test-only mutator, not part of the FamilyMemberInvitationRepository
    // interface -- registers the email hash an account is known by.
    _setAccountEmailHashForTest(accountId, emailHash) {
      accountEmailHashes.set(accountId, emailHash);
    },

    // Test-only mutator, not part of the FamilyMemberInvitationRepository
    // interface -- registers which family (if any) an account currently
    // belongs to, mirroring parent_accounts.family_id.
    _setAccountFamilyIdForTest(accountId, familyId) {
      accountFamilyId.set(accountId, familyId);
    },

    // Test-only seeding helper, NOT part of the
    // FamilyMemberInvitationRepository interface (the interface's own
    // create() was replaced by createAtomically below). Writes a row
    // verbatim, bypassing every lifecycle decision -- how a test stands up
    // an already-ACCEPTED/EXPIRED/REVOKED row that a real prior request
    // would have produced.
    async create(record) {
      byId.set(record.invitationId, { ...record });
    },

    /**
     * Mirrors MySqlFamilyMemberInvitationRepository.createAtomically's own
     * transaction step for step, in the SAME order (which is load-bearing:
     * the real implementation deliberately takes the invitation-side lock,
     * then the entitlement row, so a concurrent create and accept cannot
     * invert on each other):
     *   1. capacityGuard.lock -- the serialization point.
     *   2. persist the due PENDING -> EXPIRED transitions, so a stale
     *      pending invitation neither blocks a re-invite nor holds a seat.
     *   3. authoritative read of what is still live, then the
     *      duplicate-pending decision, then the capacity verdict against
     *      that live count (which EXCLUDES this record -- it is not
     *      inserted yet, exactly like the real SELECT).
     *   4. insert.
     * `capacityGuard` is optional: undefined when no entitlement repository
     * is wired, in which case there is no configured limit to enforce.
     * `null` stands in for the transaction connection this double doesn't
     * have -- the same sentinel acceptAtomically and removeMemberAtomically
     * already pass to their own hooks.
     */
    async createAtomically(record, now, capacityGuard) {
      if (capacityGuard) await capacityGuard.lock(null, record.familyId);

      for (const stored of byId.values()) {
        if (stored.familyId === record.familyId && stored.status === 'PENDING' && stored.expiresAt.getTime() <= now.getTime()) {
          stored.status = 'EXPIRED';
          stored.expiredAt = now;
        }
      }

      const livePending = [...byId.values()].filter((r) => r.familyId === record.familyId && r.status === 'PENDING');
      if (livePending.some((r) => Buffer.compare(r.invitedEmailHash, record.invitedEmailHash) === 0)) {
        return { outcome: 'DUPLICATE_PENDING_INVITATION' };
      }

      if (capacityGuard) {
        const verdict = await capacityGuard.evaluate(null, record.familyId, livePending.length);
        if (verdict === 'CAPACITY_EXCEEDED') return { outcome: 'CAPACITY_EXCEEDED' };
      }

      byId.set(record.invitationId, { ...record });
      return { outcome: 'CREATED' };
    },

    async findByIdForFamily(familyId, invitationId) {
      const record = byId.get(invitationId);
      if (!record || record.familyId !== familyId) return null;
      return { ...record };
    },

    async findPendingByFamilyAndEmailHash(familyId, invitedEmailHash) {
      const match = [...byId.values()]
        .filter((r) => r.familyId === familyId && r.status === 'PENDING' && Buffer.compare(r.invitedEmailHash, invitedEmailHash) === 0)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return match ? { ...match } : null;
    },

    async listForFamily(familyId) {
      return [...byId.values()].filter((r) => r.familyId === familyId).map((r) => ({ ...r }));
    },

    async acceptAtomically(invitationId, acceptedByAccountId, acceptedAt, onAcceptedInTransaction) {
      const record = byId.get(invitationId);
      if (!record) return { outcome: 'NOT_FOUND' };
      // Identity binding checked BEFORE any state disambiguation, exactly as
      // the MySQL implementation does -- a non-addressee is NOT_FOUND and
      // learns nothing about the invitation's real state.
      if (!isAddressee(acceptedByAccountId, record)) return { outcome: 'NOT_FOUND' };
      if (record.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (record.status === 'ACCEPTED') return { outcome: 'ALREADY_ACCEPTED' };
      if (record.status === 'EXPIRED' || acceptedAt.getTime() >= record.expiresAt.getTime()) {
        return { outcome: 'EXPIRED' };
      }
      const accepted = { ...record, status: 'ACCEPTED', acceptedAt, acceptedByAccountId };
      // The real implementation runs the hook inside the same transaction as
      // the UPDATE, so a throw rolls the acceptance back -- reproduced here
      // by only publishing the mutation once the hook has resolved. `null`
      // stands in for the transaction connection this double doesn't have.
      // SEAT IS PER MEMBER, NOT PER ACCEPTANCE -- mirrors the MySQL
      // implementation's prior-acceptance check so both honour one contract,
      // INCLUDING its `pa.family_id = fmi.family_id` scoping: a prior
      // ACCEPTED row only proves this account is already holding a seat
      // while the account is STILL BOUND to that family. removeMember
      // clears parent_accounts.family_id and releases the seat but never
      // retires the ACCEPTED invitation row, so an unscoped count let a
      // remove -> re-invite -> re-accept cycle rejoin a member for free,
      // driving used_count to zero while membership grew without bound.
      const stillBoundToThisFamily = accountFamilyId.get(acceptedByAccountId) === record.familyId;
      const alreadyAMember =
        stillBoundToThisFamily &&
        [...byId.values()].some(
          (other) =>
            other.invitationId !== invitationId &&
            other.familyId === record.familyId &&
            other.status === 'ACCEPTED' &&
            other.acceptedByAccountId === acceptedByAccountId,
        );
      if (onAcceptedInTransaction && !alreadyAMember) await onAcceptedInTransaction(null, { ...accepted });
      byId.set(invitationId, accepted);
      return { outcome: 'ACCEPTED', record: { ...accepted } };
    },

    async revokeForFamily(familyId, invitationId, revokedAt) {
      const record = byId.get(invitationId);
      if (!record || record.familyId !== familyId) return null;
      if (record.status !== 'ACCEPTED' && record.status !== 'REVOKED') {
        record.status = 'REVOKED';
        record.revokedAt = revokedAt;
      }
      return { ...record };
    },

    async expireIfDue(invitationId, at) {
      const record = byId.get(invitationId);
      if (!record) throw new Error('family member invitation not found');
      if (TERMINAL_STATUSES.has(record.status) || record.expiresAt.getTime() > at.getTime()) {
        return { ...record };
      }
      record.status = 'EXPIRED';
      record.expiredAt = at;
      return { ...record };
    },

    async updateRoleForFamily(familyId, invitationId, newRole) {
      const record = byId.get(invitationId);
      if (!record || record.familyId !== familyId || record.status !== 'PENDING') return null;
      record.role = newRole;
      return { ...record };
    },

    // Mirrors MySqlFamilyMemberInvitationRepository.removeMemberAtomically's
    // guarded-write + disambiguation shape, in reverse of acceptAtomically
    // above -- see this file's own header comment on accountFamilyIds.
    async removeMemberAtomically(familyId, targetAccountId, _removedAt, onRemovedInTransaction) {
      if (!accountFamilyId.has(targetAccountId)) return { outcome: 'NOT_FOUND' };
      const currentFamilyId = accountFamilyId.get(targetAccountId);
      if (currentFamilyId !== familyId) return { outcome: 'NOT_A_MEMBER' };

      const hasAcceptedInvitation = [...byId.values()].some(
        (r) => r.familyId === familyId && r.acceptedByAccountId === targetAccountId && r.status === 'ACCEPTED',
      );
      if (!hasAcceptedInvitation) return { outcome: 'CANNOT_REMOVE_OWNER' };

      // Hook runs BEFORE the mutation is published, mirroring
      // acceptAtomically's own double above: a throw here must leave
      // accountFamilyId untouched, exactly like a real rolled-back
      // transaction.
      if (onRemovedInTransaction) await onRemovedInTransaction(null, familyId, targetAccountId);
      accountFamilyId.set(targetAccountId, null);
      return { outcome: 'REMOVED' };
    },
  };
}
