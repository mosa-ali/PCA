/**
 * PCA-COMPLIMENTARY-ENTITLEMENTS-1 (Writer58) -- durable, explicit, audited
 * complimentary entitlement grant domain types. Implements
 * docs/implementation/addenda/PCA_ADDENDUM_004_COMPLIMENTARY_ENTITLEMENTS.md
 * Section 2/3 (`PCA-ADD-COMP-003` through `PCA-ADD-COMP-009`).
 *
 * `family_id` is treated as an opaque reference string throughout, matching
 * `backend/src/entitlements/types.ts`'s `OpaqueFamilyId` convention -- never
 * a hard foreign key into `families`.
 *
 * ARCHITECTURAL SEPARATION FROM BILLING (PCA-ADD-COMP-001/002): nothing in
 * this module ever imports from, or is imported by, `backend/src/billing/**`.
 * No type here can represent an Invoice/PaymentAttempt/PaymentTransaction/
 * ProviderEvent/PriceBook row.
 */

export type OpaqueFamilyId = string;
export type PlatformAdminIdRef = string;

/**
 * PCA-ADD-COMP-004: the bounded "grant scope" enum -- never combined into
 * one record. This is the wire/DTO field named `entitlementType` per the
 * frozen COMPLIMENTARY_ENTITLEMENT_GRANT_V1 interface contract.
 */
export const COMPLIMENTARY_ENTITLEMENT_TYPES = ['COMMERCIAL_ACCESS', 'MANAGED_DEVICE_CAPACITY', 'PARENT_MEMBER_CAPACITY'] as const;
export type ComplimentaryEntitlementType = (typeof COMPLIMENTARY_ENTITLEMENT_TYPES)[number];

/** PCA-ADD-COMP-007: the bounded category enum. */
export const COMPLIMENTARY_GRANT_CATEGORIES = [
  'FOUNDER',
  'STAFF',
  'STAFF_FAMILY',
  'BETA_TESTER',
  'PARTNER',
  'PROMOTION',
  'SUPPORT_EXCEPTION',
  'LIFETIME_COMPLIMENTARY',
  'TEMPORARY_COMPLIMENTARY',
  'OTHER',
] as const;
export type ComplimentaryGrantCategory = (typeof COMPLIMENTARY_GRANT_CATEGORIES)[number];

/**
 * ACTIVE -> REVOKED (admin action) or ACTIVE -> EXPIRED (expiresAt passed)
 * are the only transitions; both are terminal. PCA-ADD-COMP-006.
 */
export const COMPLIMENTARY_GRANT_STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type ComplimentaryGrantStatus = (typeof COMPLIMENTARY_GRANT_STATUSES)[number];

/**
 * COMMERCIAL_ACCESS grants are boolean-shaped (free access is either
 * granted or not -- there is no meaningful "amount" of access), so this
 * fixed marker is stored in `amount_or_allowance` for that entitlement
 * type only. MANAGED_DEVICE_CAPACITY/PARENT_MEMBER_CAPACITY grants store
 * their real additive integer allowance in that same column.
 */
export const COMMERCIAL_ACCESS_MARKER_AMOUNT = 1;

/** PCA-ADD-COMP-003: the durable grant record, field-for-field per the addendum's minimum field list. */
export interface ComplimentaryGrantRecord {
  grantId: string;
  familyId: OpaqueFamilyId;
  entitlementType: ComplimentaryEntitlementType;
  category: ComplimentaryGrantCategory;
  amountOrAllowance: number;
  effectiveFrom: Date;
  expiresAt: Date | null;
  status: ComplimentaryGrantStatus;
  reasonCode: string;
  internalNote: string | null;
  grantedByAdminId: PlatformAdminIdRef;
  createdAt: Date;
  revokedAt: Date | null;
  revokedByAdminId: PlatformAdminIdRef | null;
  revision: number;
}

export interface CreateComplimentaryGrantInput {
  familyId: OpaqueFamilyId;
  entitlementType: ComplimentaryEntitlementType;
  category: ComplimentaryGrantCategory;
  amountOrAllowance: number;
  effectiveFrom: Date;
  expiresAt: Date | null;
  reasonCode: string;
  internalNote: string | null;
  grantedByAdminId: PlatformAdminIdRef;
}

/**
 * PCA-ADD-COMP-005: the computed (never persisted) effective-capacity
 * summary for one entitlementType -- BASE/PLAN_ALLOWANCE is supplied by the
 * caller (read from the existing `account_entitlements` row this module
 * never mutates); `complimentaryAmount` is `sum(ACTIVE grants)` for that
 * family+entitlementType, computed fresh at read/decision time.
 */
export interface EffectiveCapacity {
  entitlementType: ComplimentaryEntitlementType;
  baseAmount: number;
  complimentaryAmount: number;
  effectiveTotal: number;
}

/** PCA-ADD-COMP-018: MyKids-safe free-access summary -- never internalNote/grantedByAdminId/category detail. */
export interface FreeAccessSummary {
  mode: 'TIME_LIMITED' | 'PERPETUAL';
  expiresAt: Date | null;
  remainingDays: number | null;
}

/**
 * PCA-COMPLIMENTARY-CONSUMPTION-1 (Writer60, Round6) -- the caller-supplied
 * BASE usage a consumption decision is being evaluated against. Always read
 * from the family's existing `account_entitlements` row (never derived,
 * never persisted by this module); the SSOT function in
 * `EffectiveEntitlementCapacity.ts` combines this with the family's current
 * ACTIVE complimentary grants.
 */
export interface EffectiveEntitlementBaseUsage {
  parentMemberLimit: number;
  managedDeviceLimit: number;
  parentMemberUsed: number;
  managedDeviceActive: number;
  managedDeviceReserved: number;
}

/**
 * EFFECTIVE_ENTITLEMENT_V2 (frozen field set, ROUND6_INTERFACE_CONTRACTS.md).
 * The single, exact shape every consumption decision (slot reservation,
 * change-request target validation, over-limit computation, MyKids read
 * model) reads through -- no service independently recomputes
 * `base + sum(active grants)`; see `EffectiveEntitlementCapacity
 * .computeEffectiveEntitlementSnapshot`, the one function that assembles
 * this shape everywhere it is used.
 */
export interface EffectiveEntitlementSnapshot {
  baseParentMemberLimit: number;
  complimentaryParentMemberCapacity: number;
  effectiveParentMemberLimit: number;

  baseManagedDeviceLimit: number;
  complimentaryManagedDeviceCapacity: number;
  effectiveManagedDeviceLimit: number;

  parentMemberUsed: number;
  managedDeviceActive: number;
  managedDeviceReserved: number;

  availableDeviceCapacity: number;
  overLimitParentMember: boolean;
  overLimitManagedDevice: boolean;
}
