// Wire shapes for the Entitlement + Entitlement-Request HTTP surface
// (backend/src/http/routes/platformadmin/entitlementRoutes.ts). The closed
// EntitlementChangeRequestState union has NO 'PENDING_ADMIN_QUOTE' literal --
// "awaiting admin quote" is the separate `awaitingAdminQuote` boolean
// alongside state:'PENDING' (ROUND4_INTERFACE_CONTRACTS.md).
export type LimitType = 'PARENT_MEMBER_LIMIT' | 'MANAGED_DEVICE_LIMIT';
export const LIMIT_TYPES: LimitType[] = ['PARENT_MEMBER_LIMIT', 'MANAGED_DEVICE_LIMIT'];

export type EntitlementChangeRequestState = 'PENDING' | 'QUOTED' | 'PAYMENT_PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';
export const ENTITLEMENT_REQUEST_STATES: EntitlementChangeRequestState[] = ['PENDING', 'QUOTED', 'PAYMENT_PENDING', 'APPROVED', 'DENIED', 'CANCELLED'];

export interface PendingRequestSummary {
  requestId: string;
  limitType: LimitType;
  state: EntitlementChangeRequestState;
  targetLimit: number;
  awaitingAdminQuote: boolean;
}

export interface FamilyEntitlement {
  familyId: string;
  planRef: string | null;
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

/** Normalized quote shape used internally by the UI -- amountMinor is always the wire decimal string, never coerced through Number(). */
export interface NormalizedQuote {
  quoteKind: string | null;
  quoteRef: string | null;
  amountMinor: string | null;
  currencyCode: string | null;
  priceBookVersion: number | null;
  quotedAt: string | null;
  expiresAt: string | null;
}

/** The NESTED shape returned by per-family list + single-request detail routes. */
export interface EntitlementRequestDto {
  requestId: string;
  familyId: string;
  limitType: LimitType;
  currentLimitAtRequest: number;
  targetLimit: number;
  state: EntitlementChangeRequestState;
  awaitingAdminQuote: boolean;
  noChargeOverride: boolean;
  quote: NormalizedQuote | null;
  decidedByAdminId: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The FLAT shape returned by GET /platform-admin/entitlement-requests -- CAUTION: different field names than EntitlementRequestDto's nested `quote{}` (ROUND4_INTERFACE_CONTRACTS.md). */
export interface FlatEntitlementRequestListItem {
  requestId: string;
  familyId: string;
  limitType: LimitType;
  currentLimitAtRequest: number;
  targetLimit: number;
  state: EntitlementChangeRequestState;
  awaitingAdminQuote: boolean;
  noChargeOverride: boolean;
  quoteAmountMinor: string | null;
  quoteCurrencyCode: string | null;
  quoteExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Internal normalized shape the UI renders from, regardless of which of the two wire shapes above it came from. */
export interface NormalizedEntitlementRequest {
  requestId: string;
  familyId: string;
  limitType: LimitType;
  currentLimitAtRequest: number;
  targetLimit: number;
  state: EntitlementChangeRequestState;
  awaitingAdminQuote: boolean;
  noChargeOverride: boolean;
  quote: NormalizedQuote | null;
  createdAt: string;
  updatedAt: string;
}

export function normalizeFromDetail(dto: EntitlementRequestDto): NormalizedEntitlementRequest {
  return {
    requestId: dto.requestId,
    familyId: dto.familyId,
    limitType: dto.limitType,
    currentLimitAtRequest: dto.currentLimitAtRequest,
    targetLimit: dto.targetLimit,
    state: dto.state,
    awaitingAdminQuote: dto.awaitingAdminQuote,
    noChargeOverride: dto.noChargeOverride,
    quote: dto.quote,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

export function normalizeFromFlatListItem(item: FlatEntitlementRequestListItem): NormalizedEntitlementRequest {
  return {
    requestId: item.requestId,
    familyId: item.familyId,
    limitType: item.limitType,
    currentLimitAtRequest: item.currentLimitAtRequest,
    targetLimit: item.targetLimit,
    state: item.state,
    awaitingAdminQuote: item.awaitingAdminQuote,
    noChargeOverride: item.noChargeOverride,
    quote:
      item.quoteAmountMinor !== null && item.quoteCurrencyCode !== null
        ? { quoteKind: null, quoteRef: null, amountMinor: item.quoteAmountMinor, currencyCode: item.quoteCurrencyCode, priceBookVersion: null, quotedAt: null, expiresAt: item.quoteExpiresAt }
        : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** "Awaiting admin quote" renders from state==='PENDING' && awaitingAdminQuote===true -- never from a nonexistent 'PENDING_ADMIN_QUOTE' state literal. */
export function isAwaitingAdminQuote(request: Pick<NormalizedEntitlementRequest, 'state' | 'awaitingAdminQuote'>): boolean {
  return request.state === 'PENDING' && request.awaitingAdminQuote === true;
}
