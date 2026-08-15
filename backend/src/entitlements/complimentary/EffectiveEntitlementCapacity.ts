/**
 * PCA-COMPLIMENTARY-CONSUMPTION-1 (Writer60, Round6) -- EFFECTIVE_ENTITLEMENT_V2.
 *
 * The single source of truth for "what can this family actually consume
 * right now" (base + sum of ACTIVE, currently-effective complimentary
 * grants). Every consumption decision in this codebase --
 * `MySqlSlotReservationRepository.reserve`'s capacity check,
 * `MySqlEntitlementRepository`'s over-limit recomputation
 * (raiseLimit/adjustManagedDeviceCounts/adjustParentMemberUsedCount),
 * `EntitlementService.getEffectiveSnapshot` (used by
 * `ChangeRequestService`'s target-vs-effective-allowance check), and the
 * MyKids read model (`MyKidsComplimentaryReadModel
 * .buildEffectiveEntitlementDto`) -- composes THIS function (or the
 * identical `ComplimentaryGrantRepository.sumActiveAmount` query it calls)
 * rather than independently recomputing `base + sum(active grants)`.
 *
 * Deliberately connection-scoped, never transaction-opening: the caller
 * passes whatever `PoolConnection` it already holds (including one already
 * inside a `SELECT ... FOR UPDATE`-locked transaction, e.g.
 * `MySqlSlotReservationRepository.reserve`'s locked `account_entitlements`
 * row), so composing this function never adds a second lock/transaction
 * and never regresses the existing count-then-insert-safe locking any
 * caller already established.
 *
 * `asOf` gates directly in SQL via `ComplimentaryGrantRepository
 * .sumActiveAmount`'s `effective_from <= asOf AND (expires_at IS NULL OR
 * expires_at > asOf)` clause -- an EXPIRED-but-not-yet-swept grant (i.e.
 * `status` still literally `'ACTIVE'` in the row but `expires_at <= asOf`)
 * is excluded from the sum by that WHERE clause regardless of whether a
 * lazy sweep (`ComplimentaryEntitlementService.sweepExpiry`) has already
 * physically flipped the row's `status` to `'EXPIRED'`. This function's
 * correctness never depends on sweep timing -- callers that don't sweep
 * (every consumption-path caller here) still get the correct effective
 * total.
 */
import type { PoolConnection } from 'mysql2/promise';
import type { ComplimentaryGrantRepository } from './ComplimentaryGrantRepository.js';
import type { EffectiveEntitlementBaseUsage, EffectiveEntitlementSnapshot, OpaqueFamilyId } from './types.js';

function assembleSnapshot(
  base: EffectiveEntitlementBaseUsage,
  complimentaryManagedDeviceCapacity: number,
  complimentaryParentMemberCapacity: number,
): EffectiveEntitlementSnapshot {
  const effectiveManagedDeviceLimit = base.managedDeviceLimit + complimentaryManagedDeviceCapacity;
  const effectiveParentMemberLimit = base.parentMemberLimit + complimentaryParentMemberCapacity;
  return {
    baseParentMemberLimit: base.parentMemberLimit,
    complimentaryParentMemberCapacity,
    effectiveParentMemberLimit,

    baseManagedDeviceLimit: base.managedDeviceLimit,
    complimentaryManagedDeviceCapacity,
    effectiveManagedDeviceLimit,

    parentMemberUsed: base.parentMemberUsed,
    managedDeviceActive: base.managedDeviceActive,
    managedDeviceReserved: base.managedDeviceReserved,

    // PCA-ADD-PA-023-equivalent for the effective limit: never clamped to
    // zero here -- callers that want a UI-safe non-negative figure clamp
    // it themselves (see MyKidsComplimentaryReadModel), but the SSOT value
    // stays exact so `overLimitManagedDevice` composition upstream is
    // never lossy.
    availableDeviceCapacity: effectiveManagedDeviceLimit - base.managedDeviceActive - base.managedDeviceReserved,
    overLimitParentMember: base.parentMemberUsed > effectiveParentMemberLimit,
    overLimitManagedDevice: base.managedDeviceActive + base.managedDeviceReserved > effectiveManagedDeviceLimit,
  };
}

/** Same arithmetic, no DB read -- for callers that have already fetched both complimentary sums and just need the derived snapshot. */
export function assembleEffectiveEntitlementSnapshot(
  base: EffectiveEntitlementBaseUsage,
  complimentaryManagedDeviceCapacity: number,
  complimentaryParentMemberCapacity: number,
): EffectiveEntitlementSnapshot {
  return assembleSnapshot(base, complimentaryManagedDeviceCapacity, complimentaryParentMemberCapacity);
}

/**
 * Reads both complimentary sums (MANAGED_DEVICE_CAPACITY,
 * PARENT_MEMBER_CAPACITY) for `familyId` as of `asOf` on `conn`, and
 * returns the fully assembled EFFECTIVE_ENTITLEMENT_V2 snapshot. This is
 * the primary entrypoint every consumption decision should call.
 */
export async function computeEffectiveEntitlementSnapshot(
  conn: PoolConnection,
  grantRepository: ComplimentaryGrantRepository,
  familyId: OpaqueFamilyId,
  base: EffectiveEntitlementBaseUsage,
  asOf: Date,
): Promise<EffectiveEntitlementSnapshot> {
  const complimentaryManagedDeviceCapacity = await grantRepository.sumActiveAmount(conn, familyId, 'MANAGED_DEVICE_CAPACITY', asOf);
  const complimentaryParentMemberCapacity = await grantRepository.sumActiveAmount(conn, familyId, 'PARENT_MEMBER_CAPACITY', asOf);
  return assembleSnapshot(base, complimentaryManagedDeviceCapacity, complimentaryParentMemberCapacity);
}

/** No-complimentary-repository-wired fallback: base-only, byte-for-byte the pre-Round6 semantics (zero regression when a caller composes this repository without a complimentary dependency). */
export function baseOnlyEffectiveEntitlementSnapshot(base: EffectiveEntitlementBaseUsage): EffectiveEntitlementSnapshot {
  return assembleSnapshot(base, 0, 0);
}
