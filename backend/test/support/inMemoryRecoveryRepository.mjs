// Deterministic in-memory RecoveryRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryRecoveryRepository() {
  const byFamilyId = new Map();

  function clone(record) {
    return { ...record, ciphertext: Buffer.from(record.ciphertext) };
  }

  return {
    async getEnvelope(familyId) {
      const record = byFamilyId.get(familyId);
      return record ? clone(record) : null;
    },

    // No `await` before the mutation below, so this function body runs to
    // completion synchronously once invoked -- concurrent stores with the
    // same expectedVersion cannot both "win".
    async storeEnvelope(familyId, ciphertext, expectedVersion, now) {
      const existing = byFamilyId.get(familyId);
      const currentVersion = existing ? existing.version : 0;
      if (expectedVersion !== currentVersion) {
        return { outcome: 'VERSION_MISMATCH', currentVersion: existing ? existing.version : null };
      }
      const record = {
        familyId,
        ciphertext: Buffer.from(ciphertext),
        version: currentVersion + 1,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };
      byFamilyId.set(familyId, record);
      return { outcome: 'STORED', record: clone(record) };
    },

    async deleteEnvelope(familyId) {
      if (!byFamilyId.has(familyId)) return { outcome: 'NOT_FOUND' };
      byFamilyId.delete(familyId);
      return { outcome: 'DELETED' };
    },
  };
}
