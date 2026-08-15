/**
 * PCA-BILL-3 (Writer62, Round6) -- Settlement / Reconciliation domain types
 * (SETTLEMENT_RECONCILIATION_V1, ROUND6_INTERFACE_CONTRACTS.md).
 * Provider-neutral, no SDK binding. Every monetary field reuses
 * `billing/money.ts`'s exact `Money` shape (`amountMinor: bigint` +
 * `currencyCode: CurrencyCode`) -- never a parallel representation.
 *
 * NEVER stores full banking credentials/passwords/PINs/raw provider API
 * keys/raw private keys anywhere in this domain -- `providerRef` is always
 * an opaque secret-reference (billing/provider/secretResolver.ts's existing
 * indirection pattern), and `displayLabel` is always a pre-masked string
 * (e.g. "****1234") supplied by the caller, never derived from a raw
 * secret by this domain.
 */
import type { CurrencyCode } from '../currency.js';
import type { Money } from '../money.js';

export type SettlementAccountStatus = 'ACTIVE' | 'INACTIVE';

export interface SettlementAccountRecord {
  readonly settlementAccountId: string;
  /** Opaque secret-reference only -- never a raw credential. Resolved via SecretResolver.resolve, never read directly. */
  readonly providerRef: string;
  /** Masked/display-safe label only, e.g. "****1234". */
  readonly displayLabel: string;
  readonly settlementCurrency: CurrencyCode;
  readonly status: SettlementAccountStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateSettlementAccountInput {
  readonly providerRef: string;
  readonly displayLabel: string;
  readonly settlementCurrency: CurrencyCode;
}

export type ReconciliationStatus = 'MATCHED' | 'UNDER_INVESTIGATION' | 'RESOLVED';

export interface SettlementBatchRecord {
  readonly settlementBatchId: string;
  readonly settlementAccountRef: string;
  readonly settlementCurrency: CurrencyCode;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly expectedGross: Money;
  readonly fees: Money;
  readonly net: Money;
  readonly received: Money;
  /** Exact bigint = receivedMinor - netMinor. May be negative (received short of net) -- signed, never clamped. */
  readonly differenceMinor: bigint;
  readonly status: ReconciliationStatus;
  readonly providerRef: string;
  readonly resolutionReason: string | null;
  readonly resolvedByAdminId: string | null;
  readonly resolvedAt: Date | null;
  readonly createdByAdminId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OpenSettlementBatchInput {
  readonly settlementAccountRef: string;
  readonly settlementCurrency: CurrencyCode;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly expectedGross: Money;
  readonly fees: Money;
  readonly received: Money;
  readonly providerRef: string;
  readonly createdByAdminId: string;
}

export interface SettlementBatchItemRecord {
  readonly settlementBatchItemId: string;
  readonly settlementBatchId: string;
  readonly paymentTransactionId: string;
  readonly amount: Money;
  readonly createdAt: Date;
}

export interface RecordedSettlementFxSnapshotRecord {
  readonly settlementFxSnapshotId: string;
  readonly settlementBatchItemId: string;
  readonly sourceCurrency: CurrencyCode;
  readonly settlementCurrency: CurrencyCode;
  /** Exact decimal representation (string, e.g. "3.7500000000") -- never a live-fetched float. */
  readonly recordedRate: string;
  readonly effectiveTimestamp: Date;
  readonly providerRef: string;
  readonly createdAt: Date;
}

export interface AttributeTransactionInput {
  readonly settlementBatchId: string;
  readonly paymentTransactionId: string;
  /** The source transaction's own Money -- copied as an immutable snapshot onto the batch item, never re-read live later. */
  readonly amount: Money;
  /**
   * Present only when the transaction's currency differs from the batch's
   * settlement currency -- an immutable, administrator-recorded snapshot,
   * never a live-fetched rate (see RecordedSettlementFxSnapshotRecord doc).
   */
  readonly fxSnapshot: {
    readonly settlementCurrency: CurrencyCode;
    readonly recordedRate: string;
    readonly effectiveTimestamp: Date;
    readonly providerRef: string;
  } | null;
}

export type SettlementErrorCode =
  | 'NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'CURRENCY_MISMATCH'
  | 'ALREADY_ATTRIBUTED'
  | 'NOT_UNDER_INVESTIGATION'
  | 'INVALID_INPUT'
  | 'FX_SNAPSHOT_REQUIRED'
  | 'FX_SNAPSHOT_NOT_ALLOWED';

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  constructor(code: SettlementErrorCode, message?: string) {
    super(message ?? `Settlement operation failed: ${code}`);
    this.name = 'SettlementError';
    this.code = code;
  }
}

/**
 * Safe settlement summary for the Platform Admin dashboard
 * (COORDINATOR_BINDING_REQUIRED -- Writer62 delivers this DTO/function
 * only, never edits DashboardReadModel.ts itself). Aggregate, currency-safe
 * money only -- no family activity, no raw provider references.
 */
export interface SettlementDashboardSummary {
  readonly matchedBatchCount: number;
  readonly underInvestigationBatchCount: number;
  readonly resolvedBatchCount: number;
  /** One entry per currency that has at least one batch; aggregate net/received/difference across all batches in that currency. */
  readonly byCurrency: ReadonlyArray<{
    readonly currencyCode: CurrencyCode;
    readonly totalNet: Money;
    readonly totalReceived: Money;
    readonly totalDifferenceMinor: string;
  }>;
}
