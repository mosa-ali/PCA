/**
 * PCA-PA-2 -- entitlement quantity / increase-request / device-slot domain
 * types. Implements Addendum 002 Sections 5-8.1. `family_id` is treated as
 * an opaque reference string throughout (matching
 * backend/src/invitation/types.ts's OpaqueFamilyId convention), never a
 * hard foreign key into `families`.
 */

export type OpaqueFamilyId = string;

export const FREE_STARTER_TIER = 'FREE_STARTER' as const;

export type LimitType = 'PARENT_MEMBER_LIMIT' | 'MANAGED_DEVICE_LIMIT';

export type EntitlementChangeRequestState =
  | 'PENDING'
  | 'QUOTED'
  | 'PAYMENT_PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'CANCELLED';

export type QuoteKind = 'STANDARD' | 'CUSTOM';

export type SlotReservationStatus = 'RESERVED' | 'CONSUMED' | 'RELEASED';

export type SlotReleaseReason = 'REVOKED' | 'EXPIRED' | 'ENROLLMENT_FAILED' | 'ADMIN_ACTION';

/** PCA-ADD-PA-024: Platform-Administration-owned, durable, never a hardcoded literal. */
export interface EntitlementDefaultsRecord {
  tier: string;
  parentMemberLimit: number;
  managedDeviceLimit: number;
  updatedAt: Date;
  updatedByAdminId: string | null;
}

/** PCA-ADD-PA-025: the durable per-family entitlement record. */
export interface AccountEntitlementRecord {
  familyId: OpaqueFamilyId;
  planRef: string;
  parentMemberLimit: number;
  managedDeviceLimit: number;
  parentMemberUsedCount: number;
  managedDeviceActiveCount: number;
  managedDeviceReservedCount: number;
  overLimitParentMember: boolean;
  overLimitManagedDevice: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** PCA-ADD-PA-029/030: metadata-only read model for MyKids/Platform Admin Web consumers. */
export interface EntitlementReadModel {
  familyId: OpaqueFamilyId;
  planRef: string;
  parentMemberLimit: number;
  parentMemberUsed: number;
  managedDeviceLimit: number;
  managedDeviceActive: number;
  managedDeviceReserved: number;
  availableDeviceSlots: number;
  overLimitParentMember: boolean;
  overLimitManagedDevice: boolean;
  pendingRequestSummary: PendingRequestSummary[];
}

export interface PendingRequestSummary {
  requestId: string;
  limitType: LimitType;
  state: EntitlementChangeRequestState;
  targetLimit: number;
  awaitingAdminQuote: boolean;
}

/** PCA-ADD-BILL-043: immutable quote snapshot, never a live PriceBook/Quote reference (this lane owns no such table). */
export interface QuoteSnapshot {
  quoteKind: QuoteKind;
  quoteRef: string;
  amountMinor: bigint;
  currencyCode: string;
  priceBookVersion: string | null;
  quotedAt: Date;
  expiresAt: Date;
}

export interface EntitlementChangeRequestRecord {
  requestId: string;
  familyId: OpaqueFamilyId;
  limitType: LimitType;
  currentLimitAtRequest: number;
  targetLimit: number;
  state: EntitlementChangeRequestState;
  awaitingAdminQuote: boolean;
  noChargeOverride: boolean;
  quote: QuoteSnapshot | null;
  decidedByAdminId: string | null;
  decisionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlotReservationRecord {
  reservationId: string;
  familyId: OpaqueFamilyId;
  invitationId: string;
  status: SlotReservationStatus;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
  releaseReason: SlotReleaseReason | null;
}
