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

export interface AccountSummaryDto {
  familyId: string;
  createdAt: string | null;
  deletedAt: string | null;
  statusCapability: string;
  entitlement: AccountEntitlementSummary | null;
  latestSubscription: AccountLatestSubscription | null;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
