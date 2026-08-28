// Wire shape of GET /platform-admin/dashboard, transcribed directly from
// backend/src/platformadmin/readmodels/DashboardReadModel.ts's
// PlatformDashboardSnapshot -- not guessed from the interface-contract doc,
// which explicitly hedges this shape as "not yet frozen."
export type MetricCapability = 'AVAILABLE' | 'UNAVAILABLE';

export interface CountMetric {
  capability: MetricCapability;
  value: number | null;
}

export interface GroupedCountMetric {
  capability: MetricCapability;
  byKey: Record<string, number> | null;
}

export interface UtilizationMetric {
  capability: MetricCapability;
  used: number | null;
  limit: number | null;
}

export interface StatusCurrencyRow {
  status: string;
  currencyCode: string;
  count: number;
}

export interface CurrencyCountRow {
  currencyCode: string;
  count: number;
}

export interface SettlementDashboardSummary {
  matchedBatchCount: number;
  underInvestigationBatchCount: number;
  resolvedBatchCount: number;
  byCurrency: Array<{
    currencyCode: string;
    totalNet: { amountMinor: string; currencyCode: string };
    totalReceived: { amountMinor: string; currencyCode: string };
    totalDifferenceMinor: string;
  }>;
}

export interface MostRecentBatchStatusRow {
  settlementAccountId: string;
  displayLabel: string;
  settlementCurrency: string;
  mostRecentBatchStatus: string | null;
  mostRecentBatchPeriodEnd: string | null;
}

export interface PlatformDashboardSnapshot {
  generatedAt: string;
  accountsTotal: CountMetric;
  accountsActiveSuspended: { capability: MetricCapability; active?: number | null; suspended?: number | null; reason?: string };
  parentMemberEntitlementUtilization: UtilizationMetric;
  managedDeviceEntitlementUtilization: UtilizationMetric;
  managedDeviceActive: CountMetric;
  managedDeviceReserved: CountMetric;
  pendingEntitlementRequests: CountMetric;
  entitlementRequestsByState: GroupedCountMetric;
  subscriptionsByStatus: GroupedCountMetric;
  quotesByStatus: GroupedCountMetric;
  // These six fields are omitted entirely from the wire response (not sent
  // as null/empty) for a role without VIEW_BILLING_RECORDS /
  // VIEW_SETTLEMENT_RECORDS -- PLATFORM_ADMIN and SUPPORT_ADMIN, per
  // backend/src/http/routes/platformadmin/dashboardRoutes.ts. Optional here
  // so Dashboard.tsx must guard on canViewBilling/canViewSettlement instead
  // of assuming presence.
  invoicesByStatusAndCurrency?: { capability: MetricCapability; rows: StatusCurrencyRow[] | null };
  paymentAttemptsByStatusAndCurrency?: { capability: MetricCapability; rows: StatusCurrencyRow[] | null };
  refundsByCurrency?: { capability: MetricCapability; rows: CurrencyCountRow[] | null };
  openDisputes?: CountMetric;
  settlementSummary?: { capability: MetricCapability; summary: SettlementDashboardSummary | null };
  serviceHealth?: {
    capability: MetricCapability;
    openReconciliationExceptions: number | null;
    mostRecentBatchStatusByAccount: MostRecentBatchStatusRow[] | null;
  };
}
