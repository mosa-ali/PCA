// Deterministic in-memory DeviceChallengeRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryDeviceChallengeRepository() {
  const byId = new Map();

  return {
    async create(record) {
      byId.set(record.challengeId, { ...record });
    },

    async findById(challengeId) {
      const record = byId.get(challengeId);
      return record ? { ...record } : null;
    },

    // No `await` before the state check/mutation below, so this function
    // body runs to completion synchronously once invoked -- concurrent
    // callers (including a replayed signature) cannot interleave and both
    // observe CONSUMED for the same challenge.
    async consumeAtomically(challengeId, consumedAt) {
      const record = byId.get(challengeId);
      if (!record) return { outcome: 'NOT_FOUND' };
      if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
      if (consumedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      record.consumedAt = consumedAt;
      return { outcome: 'CONSUMED', challenge: { ...record } };
    },
  };
}
