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

/**
 * PCA-ADD-BILL-043: immutable quote snapshot, never a live PriceBook/Quote
 * reference (this lane owns no such table). `priceBookVersion` is
 * `number | null` to match Agent44's canonical Billing Core representation
 * (`billing_price_books.price_book_version` INT UNSIGNED /
 * `BillingEntitlementSignal.priceBookVersion`, PCA-PA-2-R1) -- an integer
 * version number, never a formatted/opaque string.
 */
export interface QuoteSnapshot {
  quoteKind: QuoteKind;
  quoteRef: string;
  amountMinor: bigint;
  currencyCode: string;
  priceBookVersion: number | null;
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

/** MySQL INT UNSIGNED upper bound -- matches billing_price_books.price_book_version's column type exactly (PCA-PA-2-R1). */
const MYSQL_INT_UNSIGNED_MAX = 4294967295;

/**
 * PCA-PA-2-R1: validates a priceBookVersion value against Agent44's
 * canonical Billing Core representation and semantics
 * (billing_price_books.price_book_version INT UNSIGNED /
 * BillingEntitlementSignal.priceBookVersion; versions start at 1, per
 * PriceBookRepository.publishWithinTransaction's `COALESCE(MAX(...), 0) + 1`).
 * Throws for anything other than null or a positive integer within MySQL
 * INT UNSIGNED range -- never silently coerces a float, string, NaN, or
 * Infinity (no parseInt, no truncation). This is a typed-service-authority
 * contract check (a malformed value here is a caller bug, not an ordinary
 * business outcome), mirroring this codebase's no-default-case discipline
 * for programming errors (e.g. authz/policy.ts's resolveRequirements).
 */
export function assertValidPriceBookVersion(value: number | null): void {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`priceBookVersion must be an integer or null, received: ${String(value)}`);
  }
  if (value <= 0 || value > MYSQL_INT_UNSIGNED_MAX) {
    throw new TypeError(`priceBookVersion must be between 1 and ${MYSQL_INT_UNSIGNED_MAX}, received: ${value}`);
  }
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
