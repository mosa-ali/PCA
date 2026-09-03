// Wire shape of GET /platform-admin/accounts and GET
// /platform-admin/accounts/:accountId, transcribed from
// backend/src/http/routes/platformadmin/accountsRoutes.ts's toAccountDto.
export interface AccountEntitlementSummary {
  planRef: string | null;
  parentMemberLimit: number;
  managedDeviceLimit: number;
  parentMemberUsedCount: number;
  managedDeviceActiveCount: number;
  managedDeviceReservedCount: number;
  overLimitParentMember: boolean;
  overLimitManagedDevice: boolean;
}

export interface AccountLatestSubscription {
  subscriptionId: string;
  planId: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export interface AccountSummaryDto {
  familyId: string;
  createdAt: string | null;
  deletedAt: string | null;
  // Data-availability envelope (mirrors DashboardReadModel's `MetricCapability`
  // idiom, backend/src/platformadmin/readmodels/DashboardReadModel.ts) --
  // NOT the account's operational status. It is always 'AVAILABLE' today
  // (families.status is a plain, always-computable column) and is never a
  // suspension indicator; use `status` below for that.
  statusCapability: string;
  status: AccountStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
  entitlement: AccountEntitlementSummary | null;
  // Omitted entirely from the wire response (not sent as null) for a role
  // without VIEW_BILLING_RECORDS -- PLATFORM_ADMIN and SUPPORT_ADMIN, per
  // toAccountDto in backend/src/http/routes/platformadmin/accountsRoutes.ts.
  // `null` already means "this family has no subscription", so absence is
  // the only unambiguous "you may not see it" signal; optional here so a
  // consumer must truthiness-check rather than assume presence.
  latestSubscription?: AccountLatestSubscription | null;
}

/** Response shape of POST .../suspend and POST .../reactivate (accountsRoutes.ts). */
export interface AccountStatusChangeResult {
  familyId: string;
  status: AccountStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
