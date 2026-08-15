// Deterministic in-memory InvitationRepository for tests only.
// Never used as a production substitute for the MySQL implementation (INV-B).
// Mirrors MySqlInvitationRepository's 8-state lifecycle (PCA-ADD-ENR-005)
// exactly, including the append-only transition audit list exposed via
// `transitions` for tests that want to assert on it directly.
const TERMINAL_STATUSES = new Set(['REDEEMED', 'EXPIRED', 'REVOKED']);

export function createInMemoryInvitationRepository() {
  const byId = new Map();
  const byTokenHash = new Map();
  const transitions = [];

  function recordTransition(invitationId, fromStatus, toStatus, at) {
    transitions.push({
      transitionId: `transition-${transitions.length}`,
      invitationId,
      fromStatus,
      toStatus,
      transitionedAt: at,
    });
  }

  // Shared forward-progress transition logic for markInstallRequired/
  // markAppInstalled/markAuthorizationRequired -- same outcome contract as
  // MySqlInvitationRepository.transitionTo.
  function transitionTo(invitationId, toStatus, fromStatuses, at, atField) {
    const record = byId.get(invitationId);
    if (!record) return { outcome: 'NOT_FOUND' };
    if (record.status === toStatus) return { outcome: 'ALREADY_IN_STATE', record: { ...record } };
    if (record.status === 'REVOKED') return { outcome: 'REVOKED' };
    if (record.status === 'REDEEMED') return { outcome: 'ALREADY_REDEEMED' };
    if (record.status === 'EXPIRED' || at.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
    if (!fromStatuses.includes(record.status)) return { outcome: 'INVALID_STATE' };

    const fromStatus = record.status;
    record.status = toStatus;
    record[atField] = at;
    recordTransition(invitationId, fromStatus, toStatus, at);
    return { outcome: 'TRANSITIONED', record: { ...record } };
  }

  return {
    transitions,

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

    async findByIdForFamily(familyId, invitationId) {
      const record = byId.get(invitationId);
      if (!record || record.familyId !== familyId) return null;
      return { ...record };
    },

    async listForFamily(familyId) {
      return [...byId.values()].filter((record) => record.familyId === familyId).map((record) => ({ ...record }));
    },

    async markOpened(invitationId, openedAt) {
      const record = byId.get(invitationId);
      if (!record) throw new Error('invitation not found');
      if (record.status === 'CREATED') {
        record.status = 'OPENED';
        record.openedAt = openedAt;
        recordTransition(invitationId, 'CREATED', 'OPENED', openedAt);
      }
      return { ...record };
    },

    async markInstallRequired(invitationId, at) {
      return transitionTo(invitationId, 'INSTALL_REQUIRED', ['CREATED', 'OPENED'], at, 'installRequiredAt');
    },

    async markAppInstalled(invitationId, at) {
      return transitionTo(
        invitationId,
        'APP_INSTALLED',
        ['CREATED', 'OPENED', 'INSTALL_REQUIRED'],
        at,
        'appInstalledAt',
      );
    },

    async markAuthorizationRequired(invitationId, at) {
      return transitionTo(
        invitationId,
        'AUTHORIZATION_REQUIRED',
        ['CREATED', 'OPENED', 'INSTALL_REQUIRED', 'APP_INSTALLED'],
        at,
        'authorizationRequiredAt',
      );
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
      if (record.status === 'EXPIRED' || redeemedAt.getTime() >= record.expiresAt.getTime()) {
        return { outcome: 'EXPIRED' };
      }
      const fromStatus = record.status;
      record.status = 'REDEEMED';
      record.redeemedAt = redeemedAt;
      recordTransition(invitationId, fromStatus, 'REDEEMED', redeemedAt);
      return { outcome: 'REDEEMED', record: { ...record } };
    },

    async expireIfDue(invitationId, at) {
      const record = byId.get(invitationId);
      if (!record) throw new Error('invitation not found');
      if (TERMINAL_STATUSES.has(record.status) || record.expiresAt.getTime() > at.getTime()) {
        return { ...record };
      }
      const fromStatus = record.status;
      record.status = 'EXPIRED';
      record.expiredAt = at;
      recordTransition(invitationId, fromStatus, 'EXPIRED', at);
      return { ...record };
    },

    async revoke(invitationId, revokedAt) {
      const record = byId.get(invitationId);
      if (!record) throw new Error('invitation not found');
      // REDEEMED is terminal (never overwritten); REVOKED is idempotent
      // (the first revocation's timestamp remains authoritative).
      if (record.status !== 'REDEEMED' && record.status !== 'REVOKED') {
        const fromStatus = record.status;
        record.status = 'REVOKED';
        record.revokedAt = revokedAt;
        recordTransition(invitationId, fromStatus, 'REVOKED', revokedAt);
      }
      return { ...record };
    },

    async revokeForFamily(familyId, invitationId, revokedAt) {
      const record = byId.get(invitationId);
      if (!record || record.familyId !== familyId) return null;
      if (record.status !== 'REDEEMED' && record.status !== 'REVOKED') {
        const fromStatus = record.status;
        record.status = 'REVOKED';
        record.revokedAt = revokedAt;
        recordTransition(invitationId, fromStatus, 'REVOKED', revokedAt);
      }
      return { ...record };
    },
  };
}
