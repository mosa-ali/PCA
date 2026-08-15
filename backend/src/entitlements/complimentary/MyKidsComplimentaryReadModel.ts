/**
 * PCA-COMPLIMENTARY-ENTITLEMENTS-1 -- the additive MyKids read-model
 * function for `GET /v1/families/:familyId/commercial/entitlement`
 * (COMPLIMENTARY_ENTITLEMENT_GRANT_V1's frozen "MyKids read surface"
 * section). `familyCommercialRoutes.ts` is Coordinator-owned (not in this
 * lane's exclusive ownership per ROUND5_FILE_OWNERSHIP.csv), so this file
 * delivers ONLY the pure read-model function + its wire-safe JSON mapper;
 * the Coordinator composes it into that route's existing response as
 * narrow additive glue, per the frozen contract: "no existing field
 * renamed/removed."
 *
 * PRIVACY (PCA-ADD-COMP-019): this module never reads or returns
 * internalNote, grantedByAdminId, or any category/employee/staff detail --
 * ComplimentaryEntitlementService.buildFreeAccessSummary already returns
 * only the safe {mode, expiresAt, remainingDays} shape, and
 * computeEffectiveCapacity returns only numeric totals.
 */
import type { ComplimentaryEntitlementService } from './ComplimentaryEntitlementService.js';
import type { EffectiveEntitlementBaseUsage, FreeAccessSummary, OpaqueFamilyId } from './types.js';

export interface MyKidsComplimentaryReadModel {
  complimentaryCapacity: { managedDevice: number; parentMember: number };
  effectiveTotal: { managedDeviceLimit: number; parentMemberLimit: number };
  freeAccess: FreeAccessSummary | null;
}

export interface MyKidsComplimentaryReadModelJson {
  complimentaryCapacity: { managedDevice: number; parentMember: number };
  effectiveTotal: { managedDeviceLimit: number; parentMemberLimit: number };
  freeAccess: { mode: 'TIME_LIMITED' | 'PERPETUAL'; expiresAt: string | null; remainingDays: number | null } | null;
}

/**
 * `baseManagedDeviceLimit`/`baseParentMemberLimit` are the family's
 * EXISTING `account_entitlements` limits (already read by the caller,
 * e.g. `FamilyCommercialService.getEntitlement`'s `EntitlementReadModel`)
 * -- this function never mutates or re-derives them, only adds
 * complimentary capacity on top (PCA-ADD-COMP-005). Sequential (not
 * concurrent) awaits deliberately: each call sweeps due-expiry rows for
 * the family inside its own short transaction, and running the three
 * sweeps concurrently would serialize on InnoDB row locks anyway for no
 * benefit, on a read path where a few extra milliseconds is a fine
 * trade-off for the simplest-possible-to-audit implementation.
 */
export async function buildMyKidsComplimentaryReadModel(
  service: ComplimentaryEntitlementService,
  familyId: OpaqueFamilyId,
  baseManagedDeviceLimit: number,
  baseParentMemberLimit: number,
  now: Date,
): Promise<MyKidsComplimentaryReadModel> {
  const deviceCapacity = await service.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', baseManagedDeviceLimit, now);
  const memberCapacity = await service.computeEffectiveCapacity(familyId, 'PARENT_MEMBER_CAPACITY', baseParentMemberLimit, now);
  const freeAccess = await service.buildFreeAccessSummary(familyId, now);
  return {
    complimentaryCapacity: { managedDevice: deviceCapacity.complimentaryAmount, parentMember: memberCapacity.complimentaryAmount },
    effectiveTotal: { managedDeviceLimit: deviceCapacity.effectiveTotal, parentMemberLimit: memberCapacity.effectiveTotal },
    freeAccess,
  };
}

/**
 * EFFECTIVE_ENTITLEMENT_V2 MyKids-facing DTO (PCA-COMPLIMENTARY-CONSUMPTION-1,
 * Writer60 Round6) -- additive fields (base/complimentary/effective/
 * active/reserved/available/expiry) for `GET /v1/families/:familyId/
 * commercial/entitlement`. Delivered here as a pure function; per file
 * ownership (ROUND6_FILE_OWNERSHIP.csv) `familyCommercialRoutes.ts` is
 * Coordinator-owned, so the Coordinator composes this into that route's
 * existing response this round.
 *
 * PRIVACY (PCA-ADD-COMP-019, still binding): never reads or returns
 * internalNote/grantedByAdminId -- `expiresAt` below is derived only from
 * the public `entitlementType`/`status`/`expiresAt` fields of
 * ComplimentaryGrantRecord, the same privacy-safe subset
 * buildFreeAccessSummary already relies on.
 */
export interface MyKidsEffectiveEntitlementDto {
  managedDevice: {
    base: number;
    complimentary: number;
    effective: number;
    active: number;
    reserved: number;
    available: number;
  };
  parentMember: {
    base: number;
    complimentary: number;
    effective: number;
    used: number;
  };
  /** Soonest expiresAt among the family's currently-ACTIVE MANAGED_DEVICE_CAPACITY/PARENT_MEMBER_CAPACITY grants; null if none are active or all are perpetual (expiresAt IS NULL). */
  complimentaryExpiresAt: string | null;
}

export async function buildEffectiveEntitlementDto(
  service: ComplimentaryEntitlementService,
  familyId: OpaqueFamilyId,
  base: EffectiveEntitlementBaseUsage,
  now: Date,
): Promise<MyKidsEffectiveEntitlementDto> {
  const snapshot = await service.computeEffectiveEntitlementSnapshot(familyId, base, now);
  // listForFamily also sweeps due expiries first, so a grant whose
  // expiresAt has just passed is excluded from soonestExpiry below by the
  // same status transition the snapshot's sum already excluded it from.
  const grants = await service.listForFamily(familyId, now);
  const soonestExpiry = grants.reduce<Date | null>((soonest, grant) => {
    if (grant.status !== 'ACTIVE') return soonest;
    if (grant.entitlementType !== 'MANAGED_DEVICE_CAPACITY' && grant.entitlementType !== 'PARENT_MEMBER_CAPACITY') return soonest;
    if (grant.expiresAt === null) return soonest;
    if (grant.expiresAt.getTime() <= now.getTime()) return soonest;
    return !soonest || grant.expiresAt.getTime() < soonest.getTime() ? grant.expiresAt : soonest;
  }, null);
  return {
    managedDevice: {
      base: snapshot.baseManagedDeviceLimit,
      complimentary: snapshot.complimentaryManagedDeviceCapacity,
      effective: snapshot.effectiveManagedDeviceLimit,
      active: snapshot.managedDeviceActive,
      reserved: snapshot.managedDeviceReserved,
      available: Math.max(snapshot.availableDeviceCapacity, 0),
    },
    parentMember: {
      base: snapshot.baseParentMemberLimit,
      complimentary: snapshot.complimentaryParentMemberCapacity,
      effective: snapshot.effectiveParentMemberLimit,
      used: snapshot.parentMemberUsed,
    },
    complimentaryExpiresAt: soonestExpiry ? soonestExpiry.toISOString() : null,
  };
}

export function myKidsComplimentaryReadModelToJson(model: MyKidsComplimentaryReadModel): MyKidsComplimentaryReadModelJson {
  return {
    complimentaryCapacity: { ...model.complimentaryCapacity },
    effectiveTotal: { ...model.effectiveTotal },
    freeAccess: model.freeAccess
      ? {
          mode: model.freeAccess.mode,
          expiresAt: model.freeAccess.expiresAt ? model.freeAccess.expiresAt.toISOString() : null,
          remainingDays: model.freeAccess.remainingDays,
        }
      : null,
  };
}
