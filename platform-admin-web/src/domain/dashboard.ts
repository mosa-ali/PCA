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

export interface PlatformDashboardSnapshot {
  generatedAt: string;
  accountsTotal: CountMetric;
  accountsActiveSuspended: { capability: 'UNAVAILABLE'; reason: string };
  parentMemberEntitlementUtilization: UtilizationMetric;
  managedDeviceEntitlementUtilization: UtilizationMetric;
  managedDeviceActive: CountMetric;
  managedDeviceReserved: CountMetric;
  pendingEntitlementRequests: CountMetric;
  entitlementRequestsByState: GroupedCountMetric;
  subscriptionsByStatus: GroupedCountMetric;
  quotesByStatus: GroupedCountMetric;
  invoicesByStatusAndCurrency: { capability: MetricCapability; rows: StatusCurrencyRow[] | null };
  paymentAttemptsByStatusAndCurrency: { capability: MetricCapability; rows: StatusCurrencyRow[] | null };
  refundsByCurrency: { capability: MetricCapability; rows: CurrencyCountRow[] | null };
  openDisputes: CountMetric;
}
