// Deterministic in-memory FamilyMemberInvitationRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
// Mirrors inMemoryInvitationRepository.mjs's established shape/conventions.
const TERMINAL_STATUSES = new Set(['ACCEPTED', 'EXPIRED', 'REVOKED']);

export function createInMemoryFamilyMemberInvitationRepository() {
  const byId = new Map();

  return {
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

    async acceptAtomically(invitationId, acceptedByAccountId, acceptedAt) {
      const record = byId.get(invitationId);
      if (!record) return { outcome: 'NOT_FOUND' };
      if (record.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (record.status === 'ACCEPTED') return { outcome: 'ALREADY_ACCEPTED' };
      if (record.status === 'EXPIRED' || acceptedAt.getTime() >= record.expiresAt.getTime()) {
        return { outcome: 'EXPIRED' };
      }
      record.status = 'ACCEPTED';
      record.acceptedAt = acceptedAt;
      record.acceptedByAccountId = acceptedByAccountId;
      return { outcome: 'ACCEPTED', record: { ...record } };
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
