/**
 * PCA-BILL-2A-R1 correction -- durable, concurrency-safe refund
 * orchestration (FIX 2: refund split-state, FIX 3: cumulative-refund
 * balance race). Composes (never edits) the accepted PCA-BILL-1 files
 * refund.ts (`RefundService`/`RefundRepository`) and payment.ts
 * (`PaymentRepository`), plus this lane's own provider registry.
 *
 * FIX 2 -- DURABLE REFUND INTENT: the original `billingRefundRoutes.ts`
 * called `provider.refund(...)` FIRST, with no local row of ANY kind
 * existing beforehand. If the provider call succeeded and the subsequent
 * `RefundService.issueRefund` call then threw, money had moved at the
 * provider with ZERO durable local trace -- worse than a false-success
 * bug, a silent loss of record. This service now inserts a `CREATED` row
 * into `billing_refund_operations` (migration 0008) FIRST -- before the
 * provider is ever called -- and moves that row through
 * CREATED -> PROVIDER_CONFIRMED -> FINALIZED (or -> FAILED) as each step
 * actually completes, so a provider-confirmed refund ALWAYS has a durable
 * local operation record, even if `RefundService.issueRefund` itself later
 * fails (the row simply stays PROVIDER_CONFIRMED, ready for recovery).
 *
 * FIX 3 -- CUMULATIVE-REFUND CONCURRENCY: `RefundService.issueRefund`'s own
 * cumulative-refund check runs inside a transaction but never locks the
 * parent `billing_payment_transactions` row before summing prior refunds
 * (refund.ts, accepted, not editable by this lane) -- under this
 * codebase's standard READ COMMITTED isolation (db/pool.ts), two
 * concurrent transactions can both read the same "already refunded" sum
 * before either commits, both pass the check, and both insert. This
 * service closes that gap ONE LAYER UP: `claimOperation` takes a
 * `SELECT ... FOR UPDATE` lock on the EXISTING `billing_payment_transactions`
 * row (a lock on an existing row genuinely serializes two concurrent
 * transactions targeting the same payment_transaction_id, even under READ
 * COMMITTED) and re-sums `billing_refund_operations`
 * (CREATED/PROVIDER_CONFIRMED/FINALIZED) for that transaction, BEFORE ever
 * inserting a new CREATED row -- all inside ONE transaction holding the
 * lock. Only an operation that passes this real DB-arbitrated check can
 * ever reach `provider.refund`. See
 * backend/test/db/refundBalanceRaceConcurrency.mysql.test.mjs for the real
 * two-independent-connection proof.
 *
 * IDEMPOTENCY: `idempotency_key` (UNIQUE, migration 0008) is the sole
 * concurrency/retry-recognition primitive, mirroring
 * ProviderEventRepository.recordIfNew's discipline exactly -- a duplicate
 * key is looked up and its existing row returned, never re-arbitrated or
 * re-inserted. The admin CLIENT supplies this key in the refund request
 * body (billingRefundRoutes.ts) -- it is the caller's declaration of "this
 * is the same logical refund attempt, retry it" versus "this is a new,
 * distinct refund".
 */
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry, runInTransaction } from '../../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt } from '../money.js';
import type { Money } from '../money.js';
import type { CurrencyCode } from '../currency.js';
import { requireBillingOperation } from '../rbac.js';
import type { PlatformAdminRole } from '../../platformadmin/auth/types.js';
import { RefundCurrencyMismatchError, RefundExceedsTransactionError, type RefundRow, type RefundService } from '../refund.js';
import type { PaymentProviderRegistry } from '../provider/providerRegistry.js';
import type { PaymentRepository } from '../payment.js';
import type { BillingAuditActor } from '../audit.js';

export type RefundOperationState = 'CREATED' | 'PROVIDER_CONFIRMED' | 'FINALIZED' | 'FAILED';

export interface RefundOperationRow {
  readonly refundOperationId: string;
  readonly paymentTransactionId: string;
  readonly amount: Money;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly initiatedByAdminId: string;
  readonly stepUpSessionId: string;
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly providerRefundRef: string | null;
  readonly state: RefundOperationState;
  readonly refundId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InitiateRefundInput {
  readonly paymentTransactionId: string;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly stepUpSessionId: string;
  readonly idempotencyKey: string;
  readonly provider: string;
}

interface RefundOperationSqlRow {
  refund_operation_id: string;
  payment_transaction_id: string;
  amount_minor: number | string;
  currency_code: string;
  reason_code: string;
  reason_note: string | null;
  initiated_by_admin_id: string;
  step_up_session_id: string;
  provider: string;
  idempotency_key: string;
  provider_refund_ref: string | null;
  state: string;
  refund_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: RefundOperationSqlRow): RefundOperationRow {
  return {
    refundOperationId: row.refund_operation_id,
    paymentTransactionId: row.payment_transaction_id,
    amount: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    initiatedByAdminId: row.initiated_by_admin_id,
    stepUpSessionId: row.step_up_session_id,
    provider: row.provider,
    idempotencyKey: row.idempotency_key,
    providerRefundRef: row.provider_refund_ref,
    state: row.state as RefundOperationState,
    refundId: row.refund_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RefundOperationTransactionNotFoundError extends Error {
  constructor(paymentTransactionId: string) {
    super(`PaymentTransaction not found: ${paymentTransactionId}`);
    this.name = 'RefundOperationTransactionNotFoundError';
  }
}

interface PaymentTransactionLockRow {
  payment_transaction_id: string;
  amount_minor: number | string;
  currency_code: string;
}

export class RefundOperationRepository {
  private async findByIdempotencyKey(conn: PoolConnection, idempotencyKey: string): Promise<RefundOperationRow | null> {
    const { rows } = await execute<RefundOperationSqlRow>(conn, `SELECT * FROM billing_refund_operations WHERE idempotency_key = ?`, [idempotencyKey]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findById(refundOperationId: string): Promise<RefundOperationRow | null> {
    const { rows } = await runInTransaction((conn) => execute<RefundOperationSqlRow>(conn, `SELECT * FROM billing_refund_operations WHERE refund_operation_id = ?`, [refundOperationId]));
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /**
   * The sole entry point that ever creates a `billing_refund_operations`
   * row. See this file's header for the full FIX 2/FIX 3 rationale: this
   * is where idempotent-replay detection AND the real DB-arbitrated
   * cumulative-balance check both happen, atomically, BEFORE the caller is
   * ever allowed to proceed to `provider.refund`.
   */
  async claimOperation(input: InitiateRefundInput, initiatedByAdminId: string, now: Date): Promise<{ operation: RefundOperationRow; isNew: boolean }> {
    return runInTransaction(async (conn) => {
      // Fast idempotent-replay path: a plain unique-key lookup, no lock
      // needed -- if this exact logical refund attempt was already
      // initiated, return its current state untouched.
      const existing = await this.findByIdempotencyKey(conn, input.idempotencyKey);
      if (existing) return { operation: existing, isNew: false };

      // Real concurrency arbitration primitive (FIX 3): lock the EXISTING
      // PaymentTransaction row. Two concurrent claimOperation calls for the
      // SAME payment_transaction_id (with DIFFERENT idempotency keys) will
      // genuinely serialize here -- the second blocks until the first
      // commits or rolls back, even under READ COMMITTED, because this is
      // a lock on a row that already exists.
      const { rows: txRows } = await execute<PaymentTransactionLockRow>(
        conn,
        `SELECT payment_transaction_id, amount_minor, currency_code FROM billing_payment_transactions WHERE payment_transaction_id = ? FOR UPDATE`,
        [input.paymentTransactionId],
      );
      const transaction = txRows[0];
      if (!transaction) throw new RefundOperationTransactionNotFoundError(input.paymentTransactionId);
      if (transaction.currency_code !== input.currencyCode) throw new RefundCurrencyMismatchError();

      const { rows: sumRows } = await execute<{ total: number | string | null }>(
        conn,
        `SELECT SUM(amount_minor) AS total FROM billing_refund_operations WHERE payment_transaction_id = ? AND state IN ('CREATED', 'PROVIDER_CONFIRMED', 'FINALIZED')`,
        [input.paymentTransactionId],
      );
      const alreadyClaimed = sumRows[0]?.total === null || sumRows[0]?.total === undefined ? 0n : sqlAmountMinorToBigInt(sumRows[0].total);
      const transactionAmount = sqlAmountMinorToBigInt(transaction.amount_minor);
      if (alreadyClaimed + input.amountMinor > transactionAmount) throw new RefundExceedsTransactionError();

      const refundOperationId = randomUUID();
      try {
        await execute(
          conn,
          `INSERT INTO billing_refund_operations
             (refund_operation_id, payment_transaction_id, amount_minor, currency_code, reason_code, reason_note, initiated_by_admin_id, step_up_session_id, provider, idempotency_key, provider_refund_ref, state, refund_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'CREATED', NULL, ?, ?)`,
          [
            refundOperationId,
            input.paymentTransactionId,
            bigIntToSqlParam(input.amountMinor),
            input.currencyCode,
            input.reasonCode,
            input.reasonNote,
            initiatedByAdminId,
            input.stepUpSessionId,
            input.provider,
            input.idempotencyKey,
            now,
            now,
          ],
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          // Lost a genuine concurrent race for the SAME idempotency key
          // (both callers retried at the exact same instant) -- the other
          // side's row is now authoritative; return it.
          const raced = await this.findByIdempotencyKey(conn, input.idempotencyKey);
          if (raced) return { operation: raced, isNew: false };
        }
        throw error;
      }

      const { rows } = await execute<RefundOperationSqlRow>(conn, `SELECT * FROM billing_refund_operations WHERE refund_operation_id = ?`, [refundOperationId]);
      return { operation: toDomain(rows[0]), isNew: true };
    });
  }

  /** Guarded: only transitions FROM CREATED, so a duplicate/racing call is a safe no-op re-read. */
  async markProviderConfirmed(refundOperationId: string, providerRefundRef: string, now: Date): Promise<RefundOperationRow> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE billing_refund_operations SET state = 'PROVIDER_CONFIRMED', provider_refund_ref = ?, updated_at = ? WHERE refund_operation_id = ? AND state = 'CREATED'`,
        [providerRefundRef, now, refundOperationId],
      );
      const { rows } = await execute<RefundOperationSqlRow>(conn, `SELECT * FROM billing_refund_operations WHERE refund_operation_id = ?`, [refundOperationId]);
      return toDomain(rows[0]);
    });
  }

  /** Guarded: only transitions FROM CREATED. */
  async markFailed(refundOperationId: string, now: Date): Promise<RefundOperationRow> {
    return runInTransaction(async (conn) => {
      await execute(conn, `UPDATE billing_refund_operations SET state = 'FAILED', updated_at = ? WHERE refund_operation_id = ? AND state = 'CREATED'`, [now, refundOperationId]);
      const { rows } = await execute<RefundOperationSqlRow>(conn, `SELECT * FROM billing_refund_operations WHERE refund_operation_id = ?`, [refundOperationId]);
      return toDomain(rows[0]);
    });
  }

  /** Guarded: only transitions FROM PROVIDER_CONFIRMED -- the step this lane's recovery path resumes from. */
  async markFinalized(refundOperationId: string, refundId: string, now: Date): Promise<RefundOperationRow> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE billing_refund_operations SET state = 'FINALIZED', refund_id = ?, updated_at = ? WHERE refund_operation_id = ? AND state = 'PROVIDER_CONFIRMED'`,
        [refundId, now, refundOperationId],
      );
      const { rows } = await execute<RefundOperationSqlRow>(conn, `SELECT * FROM billing_refund_operations WHERE refund_operation_id = ?`, [refundOperationId]);
      return toDomain(rows[0]);
    });
  }
}

export type RefundOrchestrationOutcome =
  | { readonly outcome: 'FINALIZED'; readonly operation: RefundOperationRow; readonly refund: RefundRow }
  | { readonly outcome: 'PENDING_FINALIZATION'; readonly operation: RefundOperationRow; readonly finalizeError: string }
  | { readonly outcome: 'PROVIDER_REFUND_FAILED'; readonly operation: RefundOperationRow }
  | { readonly outcome: 'PROVIDER_CALL_ERROR'; readonly operation: RefundOperationRow; readonly error: string }
  | { readonly outcome: 'TRANSACTION_NOT_FOUND' }
  | { readonly outcome: 'CURRENCY_MISMATCH' }
  | { readonly outcome: 'EXCEEDS_BALANCE' }
  | { readonly outcome: 'UNKNOWN_PROVIDER' };

/**
 * The single orchestration entry point `billingRefundRoutes.ts` calls.
 * Idempotent end-to-end: calling this again with the SAME `idempotencyKey`
 * (whether because the client genuinely retried, or because a prior call
 * died partway through) always resumes from wherever the operation
 * actually got to -- it NEVER re-calls `provider.refund` for an operation
 * already at PROVIDER_CONFIRMED or FINALIZED (see the CREATED-state guard
 * below), and NEVER re-arbitrates/re-inserts a CREATED row for a key that
 * already has one (see `RefundOperationRepository.claimOperation`).
 */
export class RefundOrchestrationService {
  constructor(
    private readonly repository: RefundOperationRepository,
    private readonly refundService: RefundService,
    private readonly paymentRepository: PaymentRepository,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initiateRefund(input: InitiateRefundInput, actor: BillingAuditActor, roles: readonly PlatformAdminRole[]): Promise<RefundOrchestrationOutcome> {
    requireBillingOperation(roles, 'ISSUE_REFUND');

    let claim;
    try {
      claim = await this.repository.claimOperation(input, actor.adminId, this.now());
    } catch (error) {
      if (error instanceof RefundOperationTransactionNotFoundError) return { outcome: 'TRANSACTION_NOT_FOUND' };
      if (error instanceof RefundCurrencyMismatchError) return { outcome: 'CURRENCY_MISMATCH' };
      if (error instanceof RefundExceedsTransactionError) return { outcome: 'EXCEEDS_BALANCE' };
      throw error;
    }

    let operation = claim.operation;

    if (operation.state === 'FINALIZED') {
      // Idempotent replay of an already-completed refund -- surface the
      // existing billing_refunds row so the caller can return the same
      // success payload as the original call.
      const refunds = await this.refundService.listForTransaction(operation.paymentTransactionId, roles);
      const refund = refunds.find((r) => r.refundId === operation.refundId);
      if (refund) return { outcome: 'FINALIZED', operation, refund };
      // refund_id set but the row itself is missing -- should be
      // unreachable (billing_refunds is never deleted), but fail closed to
      // PENDING_FINALIZATION rather than crash if it ever happens.
      return { outcome: 'PENDING_FINALIZATION', operation, finalizeError: 'FINALIZED operation has no matching billing_refunds row.' };
    }
    if (operation.state === 'FAILED') {
      return { outcome: 'PROVIDER_REFUND_FAILED', operation };
    }

    let provider;
    try {
      provider = this.providerRegistry.resolve(operation.provider);
    } catch {
      return { outcome: 'UNKNOWN_PROVIDER' };
    }

    if (operation.state === 'CREATED') {
      const transaction = await runInTransaction((conn) => this.paymentRepository.findTransactionById(conn, operation.paymentTransactionId));
      if (!transaction) return { outcome: 'TRANSACTION_NOT_FOUND' };

      let providerResult;
      try {
        providerResult = await provider.refund(transaction.providerTransactionRef, operation.amount.amountMinor, operation.reasonCode, operation.idempotencyKey);
      } catch (error) {
        // Provider call itself threw (network/timeout/etc): the CREATED
        // row is untouched -- durable, not lost -- a later retry with the
        // same idempotencyKey re-enters here and tries the provider call
        // again (never re-arbitrates the balance, never double-inserts).
        return { outcome: 'PROVIDER_CALL_ERROR', operation, error: error instanceof Error ? error.message : String(error) };
      }

      if (providerResult.status === 'FAILED') {
        const failed = await this.repository.markFailed(operation.refundOperationId, this.now());
        return { outcome: 'PROVIDER_REFUND_FAILED', operation: failed };
      }

      // CONFIRMED or PENDING both count as "the provider accepted this
      // refund" for durability purposes here (mirrors the pre-correction
      // route's own CONFIRMED/PENDING-both-proceed behavior) -- durably
      // record it BEFORE ever calling RefundService.issueRefund.
      operation = await this.repository.markProviderConfirmed(operation.refundOperationId, providerResult.providerRefundRef, this.now());
    }

    // operation.state is now PROVIDER_CONFIRMED -- either just reached
    // above, or resumed directly here on a retry (provider.refund is NEVER
    // called again once an operation has passed this point).
    try {
      const refund = await this.refundService.issueRefund(
        {
          paymentTransactionId: operation.paymentTransactionId,
          amountMinor: operation.amount.amountMinor,
          currencyCode: operation.amount.currencyCode,
          reasonCode: operation.reasonCode,
          reasonNote: operation.reasonNote,
          stepUpSessionId: operation.stepUpSessionId,
          entitlementTreatment: 'NOT_APPLICABLE',
        },
        actor,
        roles,
      );
      const finalized = await this.repository.markFinalized(operation.refundOperationId, refund.refundId, this.now());
      return { outcome: 'FINALIZED', operation: finalized, refund };
    } catch (error) {
      // RefundService.issueRefund threw AFTER the provider already
      // confirmed the refund -- this is exactly the split-state FIX 2
      // closes: the operation row remains PROVIDER_CONFIRMED, durable, NOT
      // lost. A retry with the same idempotencyKey resumes exactly here.
      return { outcome: 'PENDING_FINALIZATION', operation, finalizeError: error instanceof Error ? error.message : String(error) };
    }
  }
}
