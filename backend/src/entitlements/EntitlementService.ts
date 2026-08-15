import { FREE_STARTER_TIER } from './types.js';
import type { EffectiveEntitlementSnapshot } from './complimentary/types.js';
import type { EntitlementRepository } from './EntitlementRepository.js';
import type { ChangeRequestRepository } from './requests/ChangeRequestRepository.js';
import type { AccountEntitlementRecord, EntitlementReadModel, OpaqueFamilyId } from './types.js';

/**
 * PCA-ADD-PA-021/024: every family begins on FREE_STARTER, whose defaults
 * are read from the durable entitlement_defaults configuration -- never a
 * hardcoded literal. getOrCreateForFamily is the single lazy-initialization
 * point every other entitlements service (change requests, slot
 * reservation) calls before touching a family's entitlement row, so a
 * family's row is created exactly once, at first use, with whatever
 * FREE_STARTER default was live at that moment -- a later default change
 * never rewrites it (PCA-ADD-PA-024).
 */
export class EntitlementService {
  private readonly entitlementRepository: EntitlementRepository;
  private readonly changeRequestRepository: ChangeRequestRepository;

  constructor(entitlementRepository: EntitlementRepository, changeRequestRepository: ChangeRequestRepository) {
    this.entitlementRepository = entitlementRepository;
    this.changeRequestRepository = changeRequestRepository;
  }

  async getOrCreateForFamily(familyId: OpaqueFamilyId, now: Date): Promise<AccountEntitlementRecord> {
    const existing = await this.entitlementRepository.getForFamily(familyId);
    if (existing) return existing;
    const defaults = await this.entitlementRepository.getDefaults(FREE_STARTER_TIER);
    if (!defaults) throw new Error(`entitlement_defaults row missing for tier ${FREE_STARTER_TIER}`);
    return this.entitlementRepository.getOrCreateForFamily(familyId, FREE_STARTER_TIER, defaults, now);
  }

  async getForFamily(familyId: OpaqueFamilyId): Promise<AccountEntitlementRecord | null> {
    return this.entitlementRepository.getForFamily(familyId);
  }

  /**
   * EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
   * Round6) -- the SSOT read surface this service exists to provide (per
   * ROUND6_FILE_OWNERSHIP.csv: EntitlementService.ts is the "SSOT wiring
   * point"). Ensures the family's row exists first (same lazy-init
   * `getOrCreateForFamily` every other method here already goes through),
   * then delegates the actual base+complimentary assembly to
   * `EntitlementRepository.getEffectiveSnapshotForFamily` -- which itself
   * composes the same shared `EffectiveEntitlementCapacity
   * .computeEffectiveEntitlementSnapshot` function every other consumption
   * decision in this codebase composes. `ChangeRequestService.createRequest`
   * / `createAndApproveNoChargeDeviceIncrease` call this method (via the
   * `entitlementService` reference they already hold) instead of wiring
   * their own complimentary dependency.
   */
  async getEffectiveSnapshot(familyId: OpaqueFamilyId, now: Date): Promise<EffectiveEntitlementSnapshot> {
    await this.getOrCreateForFamily(familyId, now);
    const snapshot = await this.entitlementRepository.getEffectiveSnapshotForFamily(familyId, now);
    if (!snapshot) throw new Error(`account_entitlements row missing for family ${familyId} after getOrCreateForFamily`);
    return snapshot;
  }

  async buildReadModel(familyId: OpaqueFamilyId, now: Date): Promise<EntitlementReadModel> {
    const entitlement = await this.getOrCreateForFamily(familyId, now);
    const openRequests = await this.changeRequestRepository.listOpenForFamily(familyId);
    return {
      familyId: entitlement.familyId,
      planRef: entitlement.planRef,
      parentMemberLimit: entitlement.parentMemberLimit,
      parentMemberUsed: entitlement.parentMemberUsedCount,
      managedDeviceLimit: entitlement.managedDeviceLimit,
      managedDeviceActive: entitlement.managedDeviceActiveCount,
      managedDeviceReserved: entitlement.managedDeviceReservedCount,
      availableDeviceSlots: Math.max(entitlement.managedDeviceLimit - entitlement.managedDeviceActiveCount - entitlement.managedDeviceReservedCount, 0),
      overLimitParentMember: entitlement.overLimitParentMember,
      overLimitManagedDevice: entitlement.overLimitManagedDevice,
      pendingRequestSummary: openRequests.map((request) => ({
        requestId: request.requestId,
        limitType: request.limitType,
        state: request.state,
        targetLimit: request.targetLimit,
        awaitingAdminQuote: request.awaitingAdminQuote,
      })),
    };
  }
}
