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
 */
export function createInMemoryFamilyMemberInvitationRepository({ accountEmailHashes = new Map() } = {}) {
  const byId = new Map();

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

    async create(record) {
      byId.set(record.invitationId, { ...record });
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
      // implementation's prior-acceptance check so both honour one contract.
      const alreadyAMember = [...byId.values()].some(
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
  };
}
