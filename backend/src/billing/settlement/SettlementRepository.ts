import type { PoolConnection } from 'mysql2/promise';
import type {
  AttributeTransactionInput,
  CreateSettlementAccountInput,
  OpenSettlementBatchInput,
  RecordedSettlementFxSnapshotRecord,
  ReconciliationStatus,
  SettlementAccountHealthRow,
  SettlementAccountRecord,
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementDashboardSummary,
  SettlementUsdRollup,
} from './types.js';

/** Persistence port for the Settlement / Reconciliation domain. Every mutation runs on the caller's transaction connection so audit writes stay atomic with the domain write, exactly like ComplimentaryGrantRepository/EntitlementRepository already do in this codebase. */
export interface SettlementRepository {
  createAccount(conn: PoolConnection, input: CreateSettlementAccountInput, accountId: string, now: Date): Promise<SettlementAccountRecord>;
  getAccountById(conn: PoolConnection, settlementAccountId: string): Promise<SettlementAccountRecord | null>;
  lockAccountById(conn: PoolConnection, settlementAccountId: string): Promise<SettlementAccountRecord | null>;
  listAccounts(conn: PoolConnection): Promise<SettlementAccountRecord[]>;
  setAccountStatus(conn: PoolConnection, settlementAccountId: string, status: 'ACTIVE' | 'INACTIVE', now: Date): Promise<SettlementAccountRecord | null>;

  openBatch(
    conn: PoolConnection,
    input: OpenSettlementBatchInput,
    batchId: string,
    receivedMinor: bigint,
    netMinor: bigint,
    differenceMinor: bigint,
    status: ReconciliationStatus,
    now: Date,
  ): Promise<SettlementBatchRecord>;
  getBatchById(conn: PoolConnection, settlementBatchId: string): Promise<SettlementBatchRecord | null>;
  lockBatchById(conn: PoolConnection, settlementBatchId: string): Promise<SettlementBatchRecord | null>;
  listBatchesForAccount(conn: PoolConnection, settlementAccountRef: string): Promise<SettlementBatchRecord[]>;
  listAllBatches(conn: PoolConnection): Promise<SettlementBatchRecord[]>;
  /** Single conditional UPDATE, WHERE status = 'UNDER_INVESTIGATION' -- returns applied=false if another request already resolved (or the batch was never UNDER_INVESTIGATION). */
  tryResolveBatch(
    conn: PoolConnection,
    settlementBatchId: string,
    resolutionReason: string,
    resolvedByAdminId: string,
    now: Date,
  ): Promise<{ applied: boolean; record: SettlementBatchRecord | null }>;

  /**
   * Attributes a PaymentTransaction to a batch. Relies on the DB's UNIQUE
   * KEY on payment_transaction_id (migration 0015) for the actual
   * double-attribution guarantee -- returns applied=false (never throws)
   * when a concurrent/prior attribution already claimed this transaction,
   * so exactly one caller among any number of concurrent attempts observes
   * applied=true.
   */
  tryAttributeTransaction(conn: PoolConnection, input: AttributeTransactionInput, itemId: string, fxSnapshotId: string | null, now: Date): Promise<{ applied: boolean; item: SettlementBatchItemRecord | null }>;
  listItemsForBatch(conn: PoolConnection, settlementBatchId: string): Promise<SettlementBatchItemRecord[]>;
  getFxSnapshotForItem(conn: PoolConnection, settlementBatchItemId: string): Promise<RecordedSettlementFxSnapshotRecord | null>;
  isTransactionAlreadyAttributed(conn: PoolConnection, paymentTransactionId: string): Promise<boolean>;

  dashboardSummary(conn: PoolConnection): Promise<SettlementDashboardSummary>;

  /** PCA-ADD-PA-041 (Writer65): one row per settlement account with its own most recent batch, for the Platform Admin dashboard's service-health widget. */
  accountHealthSummary(conn: PoolConnection): Promise<SettlementAccountHealthRow[]>;

  /**
   * PCA-ADD-BILL-020 (Writer65): admin-recorded, immutable, one-time
   * USD-normalization rate for a single non-USD batch. Returns
   * applied=false (never throws) if the batch already has a recorded rate
   * or does not exist -- same conditional-write discipline as
   * tryResolveBatch/tryAttributeTransaction.
   */
  tryRecordUsdNormalization(conn: PoolConnection, settlementBatchId: string, rate: string, adminId: string, now: Date): Promise<{ applied: boolean; record: SettlementBatchRecord | null }>;

  /** PCA-ADD-BILL-020 (Writer65): the cross-batch USD rollup itself -- see SettlementUsdRollup's doc comment for inclusion/exclusion rules. */
  usdRollup(conn: PoolConnection): Promise<SettlementUsdRollup>;
}
