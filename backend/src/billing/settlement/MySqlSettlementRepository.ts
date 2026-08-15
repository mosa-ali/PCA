import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry } from '../../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt } from '../money.js';
import type { Money } from '../money.js';
import type { CurrencyCode } from '../currency.js';
import type { SettlementRepository } from './SettlementRepository.js';
import type {
  AttributeTransactionInput,
  CreateSettlementAccountInput,
  OpenSettlementBatchInput,
  RecordedSettlementFxSnapshotRecord,
  ReconciliationStatus,
  SettlementAccountRecord,
  SettlementAccountStatus,
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementDashboardSummary,
} from './types.js';

interface AccountSqlRow {
  settlement_account_id: string;
  provider_ref: string;
  display_label: string;
  settlement_currency: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function accountToDomain(row: AccountSqlRow): SettlementAccountRecord {
  return {
    settlementAccountId: row.settlement_account_id,
    providerRef: row.provider_ref,
    displayLabel: row.display_label,
    settlementCurrency: row.settlement_currency as CurrencyCode,
    status: row.status as SettlementAccountStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface BatchSqlRow {
  settlement_batch_id: string;
  settlement_account_ref: string;
  settlement_currency: string;
  period_start: Date;
  period_end: Date;
  expected_gross_minor: number | string;
  fees_minor: number | string;
  net_minor: number | string;
  received_minor: number | string;
  difference_minor: number | string;
  status: string;
  provider_ref: string;
  resolution_reason: string | null;
  resolved_by_admin_id: string | null;
  resolved_at: Date | null;
  created_by_admin_id: string;
  created_at: Date;
  updated_at: Date;
}

function batchToDomain(row: BatchSqlRow): SettlementBatchRecord {
  const currency = row.settlement_currency as CurrencyCode;
  return {
    settlementBatchId: row.settlement_batch_id,
    settlementAccountRef: row.settlement_account_ref,
    settlementCurrency: currency,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    expectedGross: money(sqlAmountMinorToBigInt(row.expected_gross_minor), currency),
    fees: money(sqlAmountMinorToBigInt(row.fees_minor), currency),
    net: money(sqlAmountMinorToBigInt(row.net_minor), currency),
    received: money(sqlAmountMinorToBigInt(row.received_minor), currency),
    differenceMinor: BigInt(row.difference_minor),
    status: row.status as ReconciliationStatus,
    providerRef: row.provider_ref,
    resolutionReason: row.resolution_reason,
    resolvedByAdminId: row.resolved_by_admin_id,
    resolvedAt: row.resolved_at,
    createdByAdminId: row.created_by_admin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ItemSqlRow {
  settlement_batch_item_id: string;
  settlement_batch_id: string;
  payment_transaction_id: string;
  amount_minor: number | string;
  currency_code: string;
  created_at: Date;
}

function itemToDomain(row: ItemSqlRow): SettlementBatchItemRecord {
  return {
    settlementBatchItemId: row.settlement_batch_item_id,
    settlementBatchId: row.settlement_batch_id,
    paymentTransactionId: row.payment_transaction_id,
    amount: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    createdAt: row.created_at,
  };
}

interface FxSqlRow {
  settlement_fx_snapshot_id: string;
  settlement_batch_item_id: string;
  source_currency: string;
  settlement_currency: string;
  recorded_rate: string;
  effective_timestamp: Date;
  provider_ref: string;
  created_at: Date;
}

function fxToDomain(row: FxSqlRow): RecordedSettlementFxSnapshotRecord {
  return {
    settlementFxSnapshotId: row.settlement_fx_snapshot_id,
    settlementBatchItemId: row.settlement_batch_item_id,
    sourceCurrency: row.source_currency as CurrencyCode,
    settlementCurrency: row.settlement_currency as CurrencyCode,
    recordedRate: row.recorded_rate,
    effectiveTimestamp: row.effective_timestamp,
    providerRef: row.provider_ref,
    createdAt: row.created_at,
  };
}

async function selectAccountById(conn: PoolConnection, settlementAccountId: string, forUpdate: boolean): Promise<SettlementAccountRecord | null> {
  const { rows } = await execute<AccountSqlRow>(
    conn,
    `SELECT * FROM settlement_accounts WHERE settlement_account_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [settlementAccountId],
  );
  return rows[0] ? accountToDomain(rows[0]) : null;
}

async function selectBatchById(conn: PoolConnection, settlementBatchId: string, forUpdate: boolean): Promise<SettlementBatchRecord | null> {
  const { rows } = await execute<BatchSqlRow>(
    conn,
    `SELECT * FROM settlement_batches WHERE settlement_batch_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [settlementBatchId],
  );
  return rows[0] ? batchToDomain(rows[0]) : null;
}

export class MySqlSettlementRepository implements SettlementRepository {
  async createAccount(conn: PoolConnection, input: CreateSettlementAccountInput, accountId: string, now: Date): Promise<SettlementAccountRecord> {
    await execute(
      conn,
      `INSERT INTO settlement_accounts (settlement_account_id, provider_ref, display_label, settlement_currency, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [accountId, input.providerRef, input.displayLabel, input.settlementCurrency, now, now],
    );
    const created = await selectAccountById(conn, accountId, false);
    if (!created) throw new Error(`settlement_accounts row missing for ${accountId} immediately after insert`);
    return created;
  }

  async getAccountById(conn: PoolConnection, settlementAccountId: string): Promise<SettlementAccountRecord | null> {
    return selectAccountById(conn, settlementAccountId, false);
  }

  async lockAccountById(conn: PoolConnection, settlementAccountId: string): Promise<SettlementAccountRecord | null> {
    return selectAccountById(conn, settlementAccountId, true);
  }

  async listAccounts(conn: PoolConnection): Promise<SettlementAccountRecord[]> {
    const { rows } = await execute<AccountSqlRow>(conn, `SELECT * FROM settlement_accounts ORDER BY created_at DESC, settlement_account_id DESC`, []);
    return rows.map(accountToDomain);
  }

  async setAccountStatus(conn: PoolConnection, settlementAccountId: string, status: 'ACTIVE' | 'INACTIVE', now: Date): Promise<SettlementAccountRecord | null> {
    await execute(conn, `UPDATE settlement_accounts SET status = ?, updated_at = ? WHERE settlement_account_id = ?`, [status, now, settlementAccountId]);
    return selectAccountById(conn, settlementAccountId, false);
  }

  async openBatch(
    conn: PoolConnection,
    input: OpenSettlementBatchInput,
    batchId: string,
    receivedMinor: bigint,
    netMinor: bigint,
    differenceMinor: bigint,
    status: ReconciliationStatus,
    now: Date,
  ): Promise<SettlementBatchRecord> {
    await execute(
      conn,
      `INSERT INTO settlement_batches
         (settlement_batch_id, settlement_account_ref, settlement_currency, period_start, period_end,
          expected_gross_minor, fees_minor, net_minor, received_minor, difference_minor,
          status, provider_ref, resolution_reason, resolved_by_admin_id, resolved_at,
          created_by_admin_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
      [
        batchId,
        input.settlementAccountRef,
        input.settlementCurrency,
        input.periodStart,
        input.periodEnd,
        bigIntToSqlParam(input.expectedGross.amountMinor),
        bigIntToSqlParam(input.fees.amountMinor),
        bigIntToSqlParam(netMinor),
        bigIntToSqlParam(receivedMinor),
        bigIntToSqlParam(differenceMinor),
        status,
        input.providerRef,
        input.createdByAdminId,
        now,
        now,
      ],
    );
    const created = await selectBatchById(conn, batchId, false);
    if (!created) throw new Error(`settlement_batches row missing for ${batchId} immediately after insert`);
    return created;
  }

  async getBatchById(conn: PoolConnection, settlementBatchId: string): Promise<SettlementBatchRecord | null> {
    return selectBatchById(conn, settlementBatchId, false);
  }

  async lockBatchById(conn: PoolConnection, settlementBatchId: string): Promise<SettlementBatchRecord | null> {
    return selectBatchById(conn, settlementBatchId, true);
  }

  async listBatchesForAccount(conn: PoolConnection, settlementAccountRef: string): Promise<SettlementBatchRecord[]> {
    const { rows } = await execute<BatchSqlRow>(
      conn,
      `SELECT * FROM settlement_batches WHERE settlement_account_ref = ? ORDER BY period_start DESC, settlement_batch_id DESC`,
      [settlementAccountRef],
    );
    return rows.map(batchToDomain);
  }

  async listAllBatches(conn: PoolConnection): Promise<SettlementBatchRecord[]> {
    const { rows } = await execute<BatchSqlRow>(conn, `SELECT * FROM settlement_batches ORDER BY period_start DESC, settlement_batch_id DESC`, []);
    return rows.map(batchToDomain);
  }

  async tryResolveBatch(
    conn: PoolConnection,
    settlementBatchId: string,
    resolutionReason: string,
    resolvedByAdminId: string,
    now: Date,
  ): Promise<{ applied: boolean; record: SettlementBatchRecord | null }> {
    const { rowCount } = await execute(
      conn,
      `UPDATE settlement_batches
       SET status = 'RESOLVED', resolution_reason = ?, resolved_by_admin_id = ?, resolved_at = ?, updated_at = ?
       WHERE settlement_batch_id = ? AND status = 'UNDER_INVESTIGATION'`,
      [resolutionReason, resolvedByAdminId, now, now, settlementBatchId],
    );
    const record = await selectBatchById(conn, settlementBatchId, false);
    return { applied: rowCount > 0, record };
  }

  async tryAttributeTransaction(
    conn: PoolConnection,
    input: AttributeTransactionInput,
    itemId: string,
    fxSnapshotId: string | null,
    now: Date,
  ): Promise<{ applied: boolean; item: SettlementBatchItemRecord | null }> {
    try {
      await execute(
        conn,
        `INSERT INTO settlement_batch_items (settlement_batch_item_id, settlement_batch_id, payment_transaction_id, amount_minor, currency_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [itemId, input.settlementBatchId, input.paymentTransactionId, bigIntToSqlParam(input.amount.amountMinor), input.amount.currencyCode, now],
      );
    } catch (error) {
      // UNIQUE KEY settlement_batch_items_transaction_key (migration 0015)
      // is the database-authoritative double-attribution guard: under
      // concurrent attempts to attribute the SAME payment_transaction_id
      // to two batches, InnoDB resolves the race and exactly one INSERT
      // succeeds -- the loser observes ER_DUP_ENTRY here, never a
      // successful insert, and reports applied=false rather than throwing.
      if (isDuplicateEntry(error)) return { applied: false, item: null };
      throw error;
    }
    if (input.fxSnapshot && fxSnapshotId) {
      await execute(
        conn,
        `INSERT INTO settlement_fx_snapshots
           (settlement_fx_snapshot_id, settlement_batch_item_id, source_currency, settlement_currency, recorded_rate, effective_timestamp, provider_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fxSnapshotId,
          itemId,
          input.amount.currencyCode,
          input.fxSnapshot.settlementCurrency,
          input.fxSnapshot.recordedRate,
          input.fxSnapshot.effectiveTimestamp,
          input.fxSnapshot.providerRef,
          now,
        ],
      );
    }
    const { rows } = await execute<ItemSqlRow>(conn, `SELECT * FROM settlement_batch_items WHERE settlement_batch_item_id = ?`, [itemId]);
    return { applied: true, item: rows[0] ? itemToDomain(rows[0]) : null };
  }

  async listItemsForBatch(conn: PoolConnection, settlementBatchId: string): Promise<SettlementBatchItemRecord[]> {
    const { rows } = await execute<ItemSqlRow>(
      conn,
      `SELECT * FROM settlement_batch_items WHERE settlement_batch_id = ? ORDER BY created_at ASC, settlement_batch_item_id ASC`,
      [settlementBatchId],
    );
    return rows.map(itemToDomain);
  }

  async getFxSnapshotForItem(conn: PoolConnection, settlementBatchItemId: string): Promise<RecordedSettlementFxSnapshotRecord | null> {
    const { rows } = await execute<FxSqlRow>(conn, `SELECT * FROM settlement_fx_snapshots WHERE settlement_batch_item_id = ?`, [settlementBatchItemId]);
    return rows[0] ? fxToDomain(rows[0]) : null;
  }

  async isTransactionAlreadyAttributed(conn: PoolConnection, paymentTransactionId: string): Promise<boolean> {
    const { rows } = await execute<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM settlement_batch_items WHERE payment_transaction_id = ?`, [paymentTransactionId]);
    return Number(rows[0]?.n ?? 0) > 0;
  }

  async dashboardSummary(conn: PoolConnection): Promise<SettlementDashboardSummary> {
    const { rows: statusRows } = await execute<{ status: string; n: number }>(
      conn,
      `SELECT status, COUNT(*) AS n FROM settlement_batches GROUP BY status`,
      [],
    );
    const counts: Record<ReconciliationStatus, number> = { MATCHED: 0, UNDER_INVESTIGATION: 0, RESOLVED: 0 };
    for (const row of statusRows) counts[row.status as ReconciliationStatus] = Number(row.n);

    const { rows: currencyRows } = await execute<{ settlement_currency: string; total_net: number | string; total_received: number | string; total_difference: number | string }>(
      conn,
      `SELECT settlement_currency,
              COALESCE(SUM(net_minor), 0) AS total_net,
              COALESCE(SUM(received_minor), 0) AS total_received,
              COALESCE(SUM(difference_minor), 0) AS total_difference
       FROM settlement_batches
       GROUP BY settlement_currency`,
      [],
    );
    return {
      matchedBatchCount: counts.MATCHED,
      underInvestigationBatchCount: counts.UNDER_INVESTIGATION,
      resolvedBatchCount: counts.RESOLVED,
      byCurrency: currencyRows.map((row) => {
        const currency = row.settlement_currency as CurrencyCode;
        return {
          currencyCode: currency,
          totalNet: money(sqlAmountMinorToBigInt(row.total_net), currency),
          totalReceived: money(sqlAmountMinorToBigInt(row.total_received), currency),
          totalDifferenceMinor: BigInt(row.total_difference).toString(10),
        };
      }),
    };
  }
}

export type { SettlementRepository };
export type { Money };
