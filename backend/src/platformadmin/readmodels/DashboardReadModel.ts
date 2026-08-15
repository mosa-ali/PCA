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
  readonly accountsActiveSuspended: { capability: 'AVAILABLE'; active: number; suspended: number };
  readonly parentMemberEntitlementUtilization: UtilizationMetric;
  readonly managedDeviceEntitlementUtilization: UtilizationMetric;
  readonly managedDeviceActive: CountMetric;
  readonly managedDeviceReserved: CountMetric;
  readonly pendingEntitlementRequests: CountMetric;
  readonly entitlementRequestsByState: GroupedCountMetric;
  readonly subscriptionsByStatus: GroupedCountMetric;
  readonly quotesByStatus: GroupedCountMetric;
  readonly invoicesByStatusAndCurrency: { capability: MetricCapability; rows: Array<{ status: string; currencyCode: string; count: number }> | null };
  readonly paymentAttemptsByStatusAndCurrency: { capability: MetricCapability; rows: Array<{ status: string; currencyCode: string; count: number }> | null };
  readonly refundsByCurrency: { capability: MetricCapability; rows: Array<{ currencyCode: string; count: number }> | null };
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
}

interface CountRow {
  cnt: number;
}
interface GroupedRow {
  groupKey: string;
  cnt: number;
}
interface StatusCurrencyRow {
  status: string;
  currency_code: string;
  cnt: number;
}
interface CurrencyRow {
  currency_code: string;
  cnt: number;
}
interface SumRow {
  usedSum: number | string | null;
  limitSum: number | string | null;
}

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export class DashboardReadModel {
  async build(now: Date = new Date()): Promise<PlatformDashboardSnapshot> {
    return runInTransaction(async (conn) => {
      const { rows: accountsRows } = await execute<CountRow>(conn, `SELECT COUNT(*) AS cnt FROM families WHERE deleted_at IS NULL`);
      const { rows: accountStatusRows } = await execute<{ status: 'ACTIVE' | 'SUSPENDED'; cnt: number }>(
        conn,
        `SELECT status, COUNT(*) AS cnt FROM families WHERE deleted_at IS NULL GROUP BY status`,
      );

      const { rows: entitlementSumRows } = await execute<SumRow>(
        conn,
        `SELECT SUM(parent_member_used_count) AS usedSum, SUM(parent_member_limit) AS limitSum FROM account_entitlements`,
      );
      const { rows: deviceSumRows } = await execute<SumRow>(
        conn,
        `SELECT SUM(managed_device_active_count) AS usedSum, SUM(managed_device_limit) AS limitSum FROM account_entitlements`,
      );
      const { rows: reservedRows } = await execute<CountRow>(
        conn,
        `SELECT COALESCE(SUM(managed_device_reserved_count), 0) AS cnt FROM account_entitlements`,
      );
      const { rows: activeDeviceRows } = await execute<CountRow>(
        conn,
        `SELECT COALESCE(SUM(managed_device_active_count), 0) AS cnt FROM account_entitlements`,
      );

      const { rows: pendingRequestRows } = await execute<CountRow>(
        conn,
        `SELECT COUNT(*) AS cnt FROM entitlement_change_requests WHERE state IN ('PENDING', 'QUOTED', 'PAYMENT_PENDING')`,
      );
      const { rows: requestsByStateRows } = await execute<GroupedRow>(
        conn,
        `SELECT state AS groupKey, COUNT(*) AS cnt FROM entitlement_change_requests GROUP BY state`,
      );
      const { rows: subsByStatusRows } = await execute<GroupedRow>(
        conn,
        `SELECT status AS groupKey, COUNT(*) AS cnt FROM billing_subscriptions GROUP BY status`,
      );
      const { rows: quotesByStatusRows } = await execute<GroupedRow>(
        conn,
        `SELECT status AS groupKey, COUNT(*) AS cnt FROM billing_quotes GROUP BY status`,
      );
      const { rows: invoiceRows } = await execute<StatusCurrencyRow>(
        conn,
        `SELECT status, currency_code, COUNT(*) AS cnt FROM billing_invoices GROUP BY status, currency_code`,
      );
      const { rows: paymentAttemptRows } = await execute<StatusCurrencyRow>(
        conn,
        `SELECT status, currency_code, COUNT(*) AS cnt FROM billing_payment_attempts GROUP BY status, currency_code`,
      );
      const { rows: refundRows } = await execute<CurrencyRow>(
        conn,
        `SELECT currency_code, COUNT(*) AS cnt FROM billing_refunds GROUP BY currency_code`,
      );
      const { rows: openDisputeRows } = await execute<CountRow>(
        conn,
        `SELECT COUNT(*) AS cnt FROM billing_disputes WHERE status IN ('OPEN', 'UNDER_REVIEW')`,
      );

      // PCA-ADD-PA-041 (Writer65): reuses the same transaction connection
      // as every other query above -- one consistent point-in-time
      // snapshot, never a second independent transaction.
      const settlementRepository = new MySqlSettlementRepository();
      const settlementSummary = await settlementRepository.dashboardSummary(conn);
      const accountHealth = await settlementRepository.accountHealthSummary(conn);

      const groupedToRecord = (rows: GroupedRow[]): Record<string, number> =>
        Object.fromEntries(rows.map((r) => [r.groupKey, toNumber(r.cnt as unknown as number)]));

      return {
        generatedAt: now.toISOString(),
        accountsTotal: { capability: 'AVAILABLE', value: toNumber(accountsRows[0]?.cnt as unknown as number) },
        accountsActiveSuspended: {
          capability: 'AVAILABLE',
          active: toNumber((accountStatusRows.find((r) => r.status === 'ACTIVE')?.cnt as unknown as number) ?? 0),
          suspended: toNumber((accountStatusRows.find((r) => r.status === 'SUSPENDED')?.cnt as unknown as number) ?? 0),
        },
        parentMemberEntitlementUtilization: {
          capability: 'AVAILABLE',
          used: toNumber(entitlementSumRows[0]?.usedSum ?? null),
          limit: toNumber(entitlementSumRows[0]?.limitSum ?? null),
        },
        managedDeviceEntitlementUtilization: {
          capability: 'AVAILABLE',
          used: toNumber(deviceSumRows[0]?.usedSum ?? null),
          limit: toNumber(deviceSumRows[0]?.limitSum ?? null),
        },
        managedDeviceActive: { capability: 'AVAILABLE', value: toNumber(activeDeviceRows[0]?.cnt as unknown as number) },
        managedDeviceReserved: { capability: 'AVAILABLE', value: toNumber(reservedRows[0]?.cnt as unknown as number) },
        pendingEntitlementRequests: { capability: 'AVAILABLE', value: toNumber(pendingRequestRows[0]?.cnt as unknown as number) },
        entitlementRequestsByState: { capability: 'AVAILABLE', byKey: groupedToRecord(requestsByStateRows) },
        subscriptionsByStatus: { capability: 'AVAILABLE', byKey: groupedToRecord(subsByStatusRows) },
        quotesByStatus: { capability: 'AVAILABLE', byKey: groupedToRecord(quotesByStatusRows) },
        invoicesByStatusAndCurrency: {
          capability: 'AVAILABLE',
          rows: invoiceRows.map((r) => ({ status: r.status, currencyCode: r.currency_code, count: toNumber(r.cnt as unknown as number) })),
        },
        paymentAttemptsByStatusAndCurrency: {
          capability: 'AVAILABLE',
          rows: paymentAttemptRows.map((r) => ({ status: r.status, currencyCode: r.currency_code, count: toNumber(r.cnt as unknown as number) })),
        },
        refundsByCurrency: {
          capability: 'AVAILABLE',
          rows: refundRows.map((r) => ({ currencyCode: r.currency_code, count: toNumber(r.cnt as unknown as number) })),
        },
        openDisputes: { capability: 'AVAILABLE', value: toNumber(openDisputeRows[0]?.cnt as unknown as number) },
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
      };
    });
  }
}
