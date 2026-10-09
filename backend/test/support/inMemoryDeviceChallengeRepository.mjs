// Deterministic in-memory DeviceChallengeRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryDeviceChallengeRepository({ isSignerKeyActive = async () => true } = {}) {
  const byId = new Map();

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
      const record = byId.get(challengeId);
      if (!record) return { outcome: 'NOT_FOUND' };
      if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
      if (consumedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (record.deviceId !== verifiedSigner.deviceId || record.familyId !== verifiedSigner.familyId) {
        return { outcome: 'SIGNER_KEY_INACTIVE' };
      }
      const signerKeyActive = await isSignerKeyActive(verifiedSigner);
      // The checker may yield while competing calls enter; re-check the
      // single-use challenge state after it returns before consuming.
      if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
      if (consumedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      if (!signerKeyActive) return { outcome: 'SIGNER_KEY_INACTIVE' };
      record.consumedAt = consumedAt;
      return { outcome: 'CONSUMED', challenge: { ...record } };
    },
  };
}
