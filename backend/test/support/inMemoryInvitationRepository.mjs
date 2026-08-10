// Deterministic in-memory InvitationRepository for tests only.
// Never used as a production substitute for the PostgreSQL implementation (INV-B).
export function createInMemoryInvitationRepository() {
  const byId = new Map();
  const byTokenHash = new Map();

  return {
    async create(record) {
      byId.set(record.invitationId, { ...record });
      byTokenHash.set(record.tokenHash, record.invitationId);
    },

    async findByTokenHash(tokenHash) {
      const invitationId = byTokenHash.get(tokenHash);
      if (!invitationId) return null;
      const record = byId.get(invitationId);
      return record ? { ...record } : null;
    },

    async markOpened(invitationId, openedAt) {
      const record = byId.get(invitationId);
      if (!record) throw new Error('invitation not found');
      if (record.status === 'CREATED') {
        record.status = 'OPENED';
        record.openedAt = openedAt;
      }
      return { ...record };
    },

    // No `await` occurs before the state mutation below, so this function
    // body runs to completion synchronously once invoked (standard async-
    // function semantics up to the first await). Promise.all over concurrent
    // calls therefore cannot interleave two redemptions of the same record.
    async redeemAtomically(invitationId, redeemedAt) {
      const record = byId.get(invitationId);
      if (!record) return { outcome: 'NOT_FOUND' };
      if (record.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (record.status === 'REDEEMED') return { outcome: 'ALREADY_REDEEMED' };
      if (redeemedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      record.status = 'REDEEMED';
      record.redeemedAt = redeemedAt;
      return { outcome: 'REDEEMED', record: { ...record } };
    },

    async revoke(invitationId, revokedAt) {
      const record = byId.get(invitationId);
      if (!record) throw new Error('invitation not found');
      if (record.status !== 'REDEEMED') {
        record.status = 'REVOKED';
        record.revokedAt = revokedAt;
      }
      return { ...record };
    },
  };
}
