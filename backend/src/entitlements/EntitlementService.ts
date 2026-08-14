import { FREE_STARTER_TIER } from './types.js';
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
