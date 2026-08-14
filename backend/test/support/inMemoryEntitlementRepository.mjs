// Deterministic in-memory EntitlementRepository for tests only (PCA-MYKIDS-BILL-2).
// Implements backend/src/entitlements/EntitlementRepository.ts's interface shape.
// Never used as a production substitute for MySqlEntitlementRepository.
export function createInMemoryEntitlementRepository() {
  const defaultsByTier = new Map();
  const recordsByFamily = new Map();

  function recompute(record) {
    record.overLimitParentMember = record.parentMemberUsedCount > record.parentMemberLimit;
    record.overLimitManagedDevice = record.managedDeviceActiveCount + record.managedDeviceReservedCount > record.managedDeviceLimit;
    return record;
  }

  return {
    async getDefaults(tier) {
      return defaultsByTier.get(tier) ?? null;
    },

    async updateDefaults(tier, parentMemberLimit, managedDeviceLimit, updatedByAdminId, now) {
      const defaults = { tier, parentMemberLimit, managedDeviceLimit, updatedAt: now, updatedByAdminId };
      defaultsByTier.set(tier, defaults);
      return defaults;
    },

    async getForFamily(familyId) {
      const record = recordsByFamily.get(familyId);
      return record ? { ...record } : null;
    },

    async getOrCreateForFamily(familyId, planRef, defaults, now) {
      const existing = recordsByFamily.get(familyId);
      if (existing) return { ...existing };
      const record = recompute({
        familyId,
        planRef,
        parentMemberLimit: defaults.parentMemberLimit,
        managedDeviceLimit: defaults.managedDeviceLimit,
        parentMemberUsedCount: 0,
        managedDeviceActiveCount: 0,
        managedDeviceReservedCount: 0,
        overLimitParentMember: false,
        overLimitManagedDevice: false,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      recordsByFamily.set(familyId, record);
      return { ...record };
    },

    async lockForFamily(_conn, familyId) {
      const record = recordsByFamily.get(familyId);
      return record ? { ...record } : null;
    },

    async raiseLimit(_conn, familyId, limitType, targetLimit, now) {
      const record = recordsByFamily.get(familyId);
      if (!record) throw new Error(`no entitlement row for family ${familyId}`);
      if (limitType === 'MANAGED_DEVICE_LIMIT') record.managedDeviceLimit = targetLimit;
      else record.parentMemberLimit = targetLimit;
      record.revision += 1;
      record.updatedAt = now;
      recompute(record);
      return { ...record };
    },

    async adjustManagedDeviceCounts(_conn, familyId, reservedDelta, activeDelta, now) {
      const record = recordsByFamily.get(familyId);
      if (!record) throw new Error(`no entitlement row for family ${familyId}`);
      record.managedDeviceReservedCount += reservedDelta;
      record.managedDeviceActiveCount += activeDelta;
      record.revision += 1;
      record.updatedAt = now;
      recompute(record);
      return { ...record };
    },

    async adjustParentMemberUsedCount(_conn, familyId, delta, now) {
      const record = recordsByFamily.get(familyId);
      if (!record) throw new Error(`no entitlement row for family ${familyId}`);
      record.parentMemberUsedCount += delta;
      record.revision += 1;
      record.updatedAt = now;
      recompute(record);
      return { ...record };
    },

    // Test-only helpers, not part of the EntitlementRepository interface.
    _seedDefaults(tier, parentMemberLimit, managedDeviceLimit, now) {
      defaultsByTier.set(tier, { tier, parentMemberLimit, managedDeviceLimit, updatedAt: now, updatedByAdminId: null });
    },
  };
}
