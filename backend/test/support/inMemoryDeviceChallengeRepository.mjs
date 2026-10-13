// Deterministic in-memory DeviceChallengeRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryDeviceChallengeRepository({ isSignerKeyActive = async () => true } = {}) {
  const byId = new Map();
  const minDateMs = Date.UTC(1000, 0, 1, 0, 0, 0, 0);
  const maxDateMs = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

  return {
    async create(record) {
      byId.set(record.challengeId, { ...record });
    },

    async findById(challengeId) {
      const record = byId.get(challengeId);
      return record ? { ...record } : null;
    },

    // The signer-key checker may yield. The challenge state is rechecked
    // after that await before mutation so concurrent in-memory verifications
    // still have exactly one winner.
    async consumeAtomically(challengeId, consumedAt, verifiedSigner) {
      if (!(consumedAt instanceof Date) || !Number.isFinite(consumedAt.getTime()) ||
          consumedAt.getTime() < minDateMs || consumedAt.getTime() > maxDateMs) {
        return { outcome: 'EXPIRED' };
      }
      const safeConsumedAt = new Date(consumedAt.getTime());
      const safeSigner = { ...verifiedSigner };
      const record = byId.get(challengeId);
      if (!record) return { outcome: 'NOT_FOUND' };
      if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
      if (safeConsumedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (record.deviceId !== safeSigner.deviceId || record.familyId !== safeSigner.familyId) {
        return { outcome: 'SIGNER_KEY_INACTIVE' };
      }
      const signerKeyActive = await isSignerKeyActive(safeSigner);
      // The checker may yield while competing calls enter; re-check the
      // single-use challenge state after it returns before consuming.
      if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
      if (safeConsumedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (!signerKeyActive) return { outcome: 'SIGNER_KEY_INACTIVE' };
      record.consumedAt = safeConsumedAt;
      return { outcome: 'CONSUMED', challenge: { ...record } };
    },
  };
}
