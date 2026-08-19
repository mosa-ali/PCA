/**
 * PCA-PA-3B -- Platform Administration dashboard aggregate read model
 * (mission Section 7 / addendum Section 15, `PCA-ADD-PA-041`).
 * Metadata-only KPIs, computed directly from existing tables -- no new
 * schema, no family activity content (structurally impossible: every
 * table this queries carries only account/entitlement/billing metadata).
 *
 * `PCA-ADD-PA-041` explicitly requires per-currency breakdowns (never a
 * forced live-FX rollup) -- every money-shaped aggregate here is grouped
 * by currency_code, never summed across currencies.
 *
 * Every metric that has no authoritative source in this schema is reported
 * via an explicit `capability: 'UNAVAILABLE'` field, never a fabricated
 * zero (mission Section 7's explicit instruction). PCA-ADD-PA-017 UPDATE
 * (Writer65): `families.status` now exists (migration 0016), so
 * `accountsActiveSuspended` below is AVAILABLE.
 */

import { execute, runInTransaction } from '../../db/pool.js';
import { MySqlSettlementRepository } from '../../billing/settlement/MySqlSettlementRepository.js';
import type { SettlementDashboardSummary } from '../../billing/settlement/types.js';

export type MetricCapability = 'AVAILABLE' | 'UNAVAILABLE';

export interface CountMetric {
  readonly capability: MetricCapability;
  readonly value: number | null;
}

export interface GroupedCountMetric {
  readonly capability: MetricCapability;
  readonly byKey: Record<string, number> | null;
}

export interface UtilizationMetric {
  readonly capability: MetricCapability;
  readonly used: number | null;
  readonly limit: number | null;
}

export interface PlatformDashboardSnapshot {
  readonly generatedAt: string;
  readonly accountsTotal: CountMetric;
  readonly accountGrowthByMonth: {
    readonly capability: MetricCapability;
    readonly rows: Array<{ monthUtc: string; created: number }> | null;
  };
  readonly accountsActiveSuspended: { capability: 'AVAILABLE'; active: number; suspended: number };
  readonly parentMemberEntitlementUtilization: UtilizationMetric;
  readonly managedDeviceEntitlementUtilization: UtilizationMetric;
  readonly managedDeviceEntitlementByPlan: {
    readonly capability: MetricCapability;
    readonly rows: Array<{ planRef: string; used: number; reserved: number; limit: number }> | null;
  };
  readonly managedDeviceActive: CountMetric;
  readonly managedDeviceReserved: CountMetric;
  readonly pendingEntitlementRequests: CountMetric;
  readonly entitlementRequestAging: {
    readonly capability: MetricCapability;
    readonly open: number | null;
    readonly oldestCreatedAt: string | null;
    readonly buckets: { lessThanOneDay: number; oneToSevenDays: number; sevenDaysOrMore: number } | null;
  };
  readonly entitlementRequestsByState: GroupedCountMetric;
  readonly subscriptionsByStatus: GroupedCountMetric;
  readonly quotesByStatus: GroupedCountMetric;
  readonly invoicesByStatusAndCurrency: { capability: MetricCapability; rows: Array<{ status: string; currencyCode: string; count: number }> | null };
  readonly paymentAttemptsByStatusAndCurrency: { capability: MetricCapability; rows: Array<{ status: string; currencyCode: string; count: number }> | null };
  readonly refundsByCurrency: { capability: MetricCapability; rows: Array<{ currencyCode: string; count: number }> | null };
  readonly paymentSummaryByCurrency: {
    readonly capability: MetricCapability;
    readonly rows: Array<{ currencyCode: string; total: number; succeeded: number; failed: number; successRate: number | null }> | null;
  };
  readonly openDisputes: CountMetric;
  /**
   * PCA-ADD-PA-041 (Writer65): sourced from the now-complete Settlement /
   * Reconciliation domain (backend/src/billing/settlement/**). AVAILABLE
   * unconditionally -- the settlement_batches table always exists post
   * migration 0015, so an empty result set (no batches yet) is a real,
   * correctly-reported zero, never an UNAVAILABLE placeholder.
   */
  readonly settlementSummary: { capability: MetricCapability; summary: SettlementDashboardSummary | null };
  /**
   * PCA-ADD-PA-041 (Writer65): service-health / exception-queue metrics.
   * `openReconciliationExceptions` is the open UNDER_INVESTIGATION batch
   * count (also present inside settlementSummary; duplicated here as its
   * own top-level field per the mission's explicit ask for a dedicated
   * exception-queue metric). `mostRecentBatchStatusByAccount` is one row
   * per ACTIVE settlement account with its own latest batch (or null if
   * that account has no batches yet -- never fabricated).
   */
  readonly serviceHealth: {
    readonly capability: MetricCapability;
    readonly openReconciliationExceptions: number | null;
    readonly mostRecentBatchStatusByAccount: ReadonlyArray<{
      readonly settlementAccountId: string;
      readonly displayLabel: string;
      readonly settlementCurrency: string;
      readonly mostRecentBatchStatus: string | null;
      readonly mostRecentBatchPeriodEnd: string | null;
    }> | null;
  };
  readonly exceptionQueues: {
    readonly capability: MetricCapability;
    readonly stuckPaymentAttempts: number | null;
    readonly expiredUnredeemedInvitations: number | null;
    readonly unresolvedReconciliations: number | null;
  };
  /** No repository-owned source currently records crash, capability-failure, or latency metrics. */
  readonly operationalSignals: {
    readonly capability: 'UNAVAILABLE';
    readonly crashRate: null;
    readonly capabilityActivationFailures: null;
    readonly latencyBuckets: null;
  };
}

interface CountRow {
  count: number | string;
}
interface GroupedRow {
  group_key: string;
  count: number | string;
}
interface StatusCurrencyRow {
  status_value: string;
  currency_code_value: string;
  count: number | string;
}
interface CurrencyRow {
  currency_code_value: string;
  count: number | string;
}
interface SumRow {
  used_sum: number | string | null;
  limit_sum: number | string | null;
}
interface GrowthRow {
  month_utc: string;
  count: number | string;
}
interface PlanUtilizationRow {
  plan_reference: string;
  used: number | string;
  reserved: number | string;
  limit_count: number | string;
}
interface RequestAgingRow {
  open_count: number | string;
  oldest_created_at: Date | null;
  less_than_one_day: number | string;
  one_to_seven_days: number | string;
  seven_days_or_more: number | string;
}
interface PaymentSummaryRow {
  currency_code_value: string;
  total: number | string;
  succeeded: number | string;
  failed: number | string;
}
interface CountOnlyRow {
  count: number | string;
}

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function firstDayOfUtcMonth(now: Date, monthsBack: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

export class DashboardReadModel {
  async build(now: Date = new Date()): Promise<PlatformDashboardSnapshot> {
    return runInTransaction(async (conn) => {
      const growthStart = firstDayOfUtcMonth(now, 11);
      const { rows: accountsRows } = await execute<CountRow>(conn, `SELECT COUNT(*) AS count FROM families WHERE deleted_at IS NULL`);
      const { rows: accountGrowthRows } = await execute<GrowthRow>(
        conn,
        `SELECT DATE_FORMAT(created_at, '%Y-%m-01') AS month_utc, COUNT(*) AS count
           FROM families
          WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?
          GROUP BY DATE_FORMAT(created_at, '%Y-%m-01')
          ORDER BY month_utc`,
        [growthStart, now],
      );
      const { rows: accountStatusRows } = await execute<{ account_status: 'ACTIVE' | 'SUSPENDED'; count: number | string }>(
        conn,
        `SELECT status AS account_status, COUNT(*) AS count FROM families WHERE deleted_at IS NULL GROUP BY status`,
      );

      const { rows: entitlementSumRows } = await execute<SumRow>(
        conn,
        `SELECT SUM(parent_member_used_count) AS used_sum, SUM(parent_member_limit) AS limit_sum FROM account_entitlements`,
      );
      const { rows: deviceSumRows } = await execute<SumRow>(
        conn,
        `SELECT SUM(managed_device_active_count) AS used_sum, SUM(managed_device_limit) AS limit_sum FROM account_entitlements`,
      );
      const { rows: devicePlanRows } = await execute<PlanUtilizationRow>(
        conn,
        `SELECT plan_ref AS plan_reference,
                COALESCE(SUM(managed_device_active_count), 0) AS used,
                COALESCE(SUM(managed_device_reserved_count), 0) AS reserved,
                COALESCE(SUM(managed_device_limit), 0) AS limit_count
           FROM account_entitlements
          GROUP BY plan_ref
          ORDER BY plan_ref`,
      );
      const { rows: reservedRows } = await execute<CountRow>(
        conn,
        `SELECT COALESCE(SUM(managed_device_reserved_count), 0) AS count FROM account_entitlements`,
      );
      const { rows: activeDeviceRows } = await execute<CountRow>(
        conn,
        `SELECT COALESCE(SUM(managed_device_active_count), 0) AS count FROM account_entitlements`,
      );

      const { rows: pendingRequestRows } = await execute<CountRow>(
        conn,
        `SELECT COUNT(*) AS count FROM entitlement_change_requests WHERE state IN ('PENDING', 'QUOTED', 'PAYMENT_PENDING')`,
      );
      const { rows: requestAgingRows } = await execute<RequestAgingRow>(
        conn,
        `SELECT COUNT(*) AS open_count,
                MIN(created_at) AS oldest_created_at,
                SUM(created_at >= DATE_SUB(?, INTERVAL 1 DAY)) AS less_than_one_day,
                SUM(created_at < DATE_SUB(?, INTERVAL 1 DAY) AND created_at >= DATE_SUB(?, INTERVAL 7 DAY)) AS one_to_seven_days,
                SUM(created_at < DATE_SUB(?, INTERVAL 7 DAY)) AS seven_days_or_more
           FROM entitlement_change_requests
          WHERE state IN ('PENDING', 'QUOTED', 'PAYMENT_PENDING')`,
        [now, now, now, now],
      );
      const { rows: requestsByStateRows } = await execute<GroupedRow>(
        conn,
        `SELECT state AS group_key, COUNT(*) AS count FROM entitlement_change_requests GROUP BY state`,
      );
      const { rows: subsByStatusRows } = await execute<GroupedRow>(
        conn,
        `SELECT status AS group_key, COUNT(*) AS count FROM billing_subscriptions GROUP BY status`,
      );
      const { rows: quotesByStatusRows } = await execute<GroupedRow>(
        conn,
        `SELECT status AS group_key, COUNT(*) AS count FROM billing_quotes GROUP BY status`,
      );
      const { rows: invoiceRows } = await execute<StatusCurrencyRow>(
        conn,
        `SELECT status AS status_value, currency_code AS currency_code_value, COUNT(*) AS count
           FROM billing_invoices
          GROUP BY status, currency_code`,
      );
      const { rows: paymentAttemptRows } = await execute<StatusCurrencyRow>(
        conn,
        `SELECT status AS status_value, currency_code AS currency_code_value, COUNT(*) AS count
           FROM billing_payment_attempts
          GROUP BY status, currency_code`,
      );
      const { rows: paymentSummaryRows } = await execute<PaymentSummaryRow>(
        conn,
        `SELECT currency_code AS currency_code_value,
                COUNT(*) AS total,
                SUM(status = 'CONFIRMED') AS succeeded,
                SUM(status IN ('FAILED', 'CANCELLED')) AS failed
           FROM billing_payment_attempts
          GROUP BY currency_code
          ORDER BY currency_code`,
      );
      const { rows: refundRows } = await execute<CurrencyRow>(
        conn,
        `SELECT currency_code AS currency_code_value, COUNT(*) AS count
           FROM billing_refunds
          GROUP BY currency_code`,
      );
      const { rows: openDisputeRows } = await execute<CountRow>(
        conn,
        `SELECT COUNT(*) AS count FROM billing_disputes WHERE status IN ('OPEN', 'UNDER_REVIEW')`,
      );
      const { rows: stuckPaymentRows } = await execute<CountOnlyRow>(
        conn,
        `SELECT COUNT(*) AS count
           FROM billing_payment_attempts
          WHERE status IN ('CREATED', 'PENDING') AND updated_at < DATE_SUB(?, INTERVAL 24 HOUR)`,
        [now],
      );
      const { rows: expiredInvitationRows } = await execute<CountOnlyRow>(
        conn,
        `SELECT COUNT(*) AS count
           FROM enrollment_invitations
          WHERE status IN ('CREATED', 'OPENED')
             AND expires_at <= ?`,
        [now],
      );

      // PCA-ADD-PA-041 (Writer65): reuses the same transaction connection
      // as every other query above -- one consistent point-in-time
      // snapshot, never a second independent transaction.
      const settlementRepository = new MySqlSettlementRepository();
      const settlementSummary = await settlementRepository.dashboardSummary(conn);
      const accountHealth = await settlementRepository.accountHealthSummary(conn);

      const groupedToRecord = (rows: GroupedRow[]): Record<string, number> =>
        Object.fromEntries(rows.map((r) => [r.group_key, toNumber(r.count)]));

      return {
        generatedAt: now.toISOString(),
        accountsTotal: { capability: 'AVAILABLE', value: toNumber(accountsRows[0]?.count ?? null) },
        accountGrowthByMonth: {
          capability: 'AVAILABLE',
          rows: accountGrowthRows.map((row) => ({ monthUtc: row.month_utc, created: toNumber(row.count) })),
        },
        accountsActiveSuspended: {
          capability: 'AVAILABLE',
          active: toNumber(accountStatusRows.find((r) => r.account_status === 'ACTIVE')?.count ?? 0),
          suspended: toNumber(accountStatusRows.find((r) => r.account_status === 'SUSPENDED')?.count ?? 0),
        },
        parentMemberEntitlementUtilization: {
          capability: 'AVAILABLE',
          used: toNumber(entitlementSumRows[0]?.used_sum ?? null),
          limit: toNumber(entitlementSumRows[0]?.limit_sum ?? null),
        },
        managedDeviceEntitlementUtilization: {
          capability: 'AVAILABLE',
          used: toNumber(deviceSumRows[0]?.used_sum ?? null),
          limit: toNumber(deviceSumRows[0]?.limit_sum ?? null),
        },
        managedDeviceEntitlementByPlan: {
          capability: 'AVAILABLE',
          rows: devicePlanRows.map((row) => ({ planRef: row.plan_reference, used: toNumber(row.used), reserved: toNumber(row.reserved), limit: toNumber(row.limit_count) })),
        },
        managedDeviceActive: { capability: 'AVAILABLE', value: toNumber(activeDeviceRows[0]?.count ?? null) },
        managedDeviceReserved: { capability: 'AVAILABLE', value: toNumber(reservedRows[0]?.count ?? null) },
        pendingEntitlementRequests: { capability: 'AVAILABLE', value: toNumber(pendingRequestRows[0]?.count ?? null) },
        entitlementRequestAging: {
          capability: 'AVAILABLE',
          open: toNumber(requestAgingRows[0]?.open_count ?? null),
          oldestCreatedAt: requestAgingRows[0]?.oldest_created_at?.toISOString() ?? null,
          buckets: {
            lessThanOneDay: toNumber(requestAgingRows[0]?.less_than_one_day ?? 0),
            oneToSevenDays: toNumber(requestAgingRows[0]?.one_to_seven_days ?? 0),
            sevenDaysOrMore: toNumber(requestAgingRows[0]?.seven_days_or_more ?? 0),
          },
        },
        entitlementRequestsByState: { capability: 'AVAILABLE', byKey: groupedToRecord(requestsByStateRows) },
        subscriptionsByStatus: { capability: 'AVAILABLE', byKey: groupedToRecord(subsByStatusRows) },
        quotesByStatus: { capability: 'AVAILABLE', byKey: groupedToRecord(quotesByStatusRows) },
        invoicesByStatusAndCurrency: {
          capability: 'AVAILABLE',
          rows: invoiceRows.map((r) => ({ status: r.status_value, currencyCode: r.currency_code_value, count: toNumber(r.count) })),
        },
        paymentAttemptsByStatusAndCurrency: {
          capability: 'AVAILABLE',
          rows: paymentAttemptRows.map((r) => ({ status: r.status_value, currencyCode: r.currency_code_value, count: toNumber(r.count) })),
        },
        refundsByCurrency: {
          capability: 'AVAILABLE',
          rows: refundRows.map((r) => ({ currencyCode: r.currency_code_value, count: toNumber(r.count) })),
        },
        paymentSummaryByCurrency: {
          capability: 'AVAILABLE',
          rows: paymentSummaryRows.map((row) => {
            const total = toNumber(row.total);
            const succeeded = toNumber(row.succeeded);
            const failed = toNumber(row.failed);
            const terminal = succeeded + failed;
            return { currencyCode: row.currency_code_value, total, succeeded, failed, successRate: terminal === 0 ? null : succeeded / terminal };
          }),
        },
        openDisputes: { capability: 'AVAILABLE', value: toNumber(openDisputeRows[0]?.count ?? null) },
        settlementSummary: { capability: 'AVAILABLE', summary: settlementSummary },
        serviceHealth: {
          capability: 'AVAILABLE',
          openReconciliationExceptions: settlementSummary.underInvestigationBatchCount,
          mostRecentBatchStatusByAccount: accountHealth.map((row) => ({
            settlementAccountId: row.settlementAccountId,
            displayLabel: row.displayLabel,
            settlementCurrency: row.settlementCurrency,
            mostRecentBatchStatus: row.mostRecentBatch?.status ?? null,
            mostRecentBatchPeriodEnd: row.mostRecentBatch?.periodEnd.toISOString() ?? null,
          })),
        },
        exceptionQueues: {
          capability: 'AVAILABLE',
          stuckPaymentAttempts: toNumber(stuckPaymentRows[0]?.count ?? null),
          expiredUnredeemedInvitations: toNumber(expiredInvitationRows[0]?.count ?? null),
          unresolvedReconciliations: settlementSummary.underInvestigationBatchCount,
        },
        operationalSignals: {
          capability: 'UNAVAILABLE',
          crashRate: null,
          capabilityActivationFailures: null,
          latencyBuckets: null,
        },
      };
    });
  }
}
