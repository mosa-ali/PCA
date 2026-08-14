/**
 * PCA Billing Core -- PaymentAttempt (`PCA-ADD-BILL-006`) and
 * PaymentTransaction (`PCA-ADD-BILL-007`).
 *
 * QUOTE/PRICE-BOOK IMMUTABILITY (constraint 12, `PCA-ADD-BILL-043`):
 * `createAttemptFromSnapshot` copies the PriceSnapshot's fields
 * (targetDeviceLimit, amountMinor, currencyCode, priceBookId,
 * priceBookVersion, quoteId) directly onto the new billing_payment_attempts
 * row -- never a live join back to billing_price_books/billing_quotes for
 * the attempt's own amount. A later PriceBook edit or Quote supersession
 * therefore cannot retroactively change an already-created attempt's terms.
 * When the snapshot originates from a Quote, the Quote is consumed
 * (transitioned ACTIVE -> CONSUMED) in the SAME transaction as the attempt
 * insert, so a Quote can never be used to create two attempts.
 *
 * NO REAL PROVIDER EXECUTION: confirmPaymentAttempt takes an already-decided
 * provider transaction reference as input (produced by whatever future
 * PCA-BILL-2 provider adapter calls it) -- this lane never calls a payment
 * provider SDK itself (providerContract.ts's interface has no
 * implementation here).
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt } from './money.js';
import type { Money } from './money.js';
import type { CurrencyCode } from './currency.js';
import type { PriceSnapshot } from './quote.js';
import { QuoteService } from './quote.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';
import type { PlatformAdminAuditService } from '../platformadmin/audit/PlatformAdminAuditService.js';
import { buildBillingAuditEvent } from './audit.js';
import type { BillingAuditActor } from './audit.js';
import type { BillingEntitlementSignal } from './entitlementContract.js';

export type PaymentAttemptStatus = 'CREATED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';

export interface PaymentAttemptRow {
  readonly paymentAttemptId: string;
  readonly accountRef: string;
  readonly invoiceId: string | null;
  readonly increaseRequestRef: string | null;
  readonly paymentMethodId: string | null;
  readonly quoteId: string | null;
  readonly priceBookId: string | null;
  readonly priceBookVersion: number | null;
  readonly targetDeviceLimit: number | null;
  readonly price: Money;
  readonly status: PaymentAttemptStatus;
  readonly provider: string | null;
  readonly providerReference: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PaymentTransactionRow {
  readonly paymentTransactionId: string;
  readonly paymentAttemptId: string;
  readonly accountRef: string;
  readonly invoiceId: string | null;
  readonly price: Money;
  readonly provider: string;
  readonly providerTransactionRef: string;
  readonly quoteId: string | null;
  readonly priceBookId: string | null;
  readonly priceBookVersion: number | null;
  readonly confirmedAt: Date;
}

export interface CreateAttemptInput {
  readonly accountRef: string;
  readonly invoiceId: string | null;
  readonly increaseRequestRef: string | null;
  readonly paymentMethodId: string | null;
}

interface AttemptSqlRow {
  payment_attempt_id: string;
  account_ref: string;
  invoice_id: string | null;
  increase_request_ref: string | null;
  payment_method_id: string | null;
  quote_id: string | null;
  price_book_id: string | null;
  price_book_version: number | null;
  target_device_limit: number | null;
  amount_minor: number | string;
  currency_code: string;
  status: string;
  provider: string | null;
  provider_reference: string | null;
  created_at: Date;
  updated_at: Date;
}

function attemptToDomain(row: AttemptSqlRow): PaymentAttemptRow {
  return {
    paymentAttemptId: row.payment_attempt_id,
    accountRef: row.account_ref,
    invoiceId: row.invoice_id,
    increaseRequestRef: row.increase_request_ref,
    paymentMethodId: row.payment_method_id,
    quoteId: row.quote_id,
    priceBookId: row.price_book_id,
    priceBookVersion: row.price_book_version,
    targetDeviceLimit: row.target_device_limit,
    price: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    status: row.status as PaymentAttemptStatus,
    provider: row.provider,
    providerReference: row.provider_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface TransactionSqlRow {
  payment_transaction_id: string;
  payment_attempt_id: string;
  account_ref: string;
  invoice_id: string | null;
  amount_minor: number | string;
  currency_code: string;
  provider: string;
  provider_transaction_ref: string;
  quote_id: string | null;
  price_book_id: string | null;
  price_book_version: number | null;
  confirmed_at: Date;
}

function transactionToDomain(row: TransactionSqlRow): PaymentTransactionRow {
  return {
    paymentTransactionId: row.payment_transaction_id,
    paymentAttemptId: row.payment_attempt_id,
    accountRef: row.account_ref,
    invoiceId: row.invoice_id,
    price: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    provider: row.provider,
    providerTransactionRef: row.provider_transaction_ref,
    quoteId: row.quote_id,
    priceBookId: row.price_book_id,
    priceBookVersion: row.price_book_version,
    confirmedAt: row.confirmed_at,
  };
}

export class PaymentRepository {
  async insertAttempt(conn: PoolConnection, input: CreateAttemptInput, snapshot: PriceSnapshot, now: Date): Promise<PaymentAttemptRow> {
    const paymentAttemptId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_payment_attempts
         (payment_attempt_id, account_ref, invoice_id, increase_request_ref, payment_method_id, quote_id, price_book_id, price_book_version,
          target_device_limit, amount_minor, currency_code, status, provider, provider_reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', NULL, NULL, ?, ?)`,
      [
        paymentAttemptId,
        input.accountRef,
        input.invoiceId,
        input.increaseRequestRef,
        input.paymentMethodId,
        snapshot.quoteId,
        snapshot.priceBookId,
        snapshot.priceBookVersion,
        snapshot.targetDeviceLimit,
        bigIntToSqlParam(snapshot.price.amountMinor),
        snapshot.price.currencyCode,
        now,
        now,
      ],
    );
    const created = await this.findAttemptById(conn, paymentAttemptId);
    if (!created) throw new Error('PaymentAttempt insert did not persist.');
    return created;
  }

  async findAttemptById(conn: PoolConnection, paymentAttemptId: string): Promise<PaymentAttemptRow | null> {
    const { rows } = await execute<AttemptSqlRow>(conn, `SELECT * FROM billing_payment_attempts WHERE payment_attempt_id = ?`, [paymentAttemptId]);
    return rows[0] ? attemptToDomain(rows[0]) : null;
  }

  /** Guarded: only transitions from CREATED/PENDING, never re-applies a terminal status (idempotency guard analogous to PCA-ADD-BILL-046's discipline). */
  async transitionStatus(conn: PoolConnection, paymentAttemptId: string, from: readonly PaymentAttemptStatus[], to: PaymentAttemptStatus, provider: string | null, providerReference: string | null): Promise<boolean> {
    const placeholders = from.map(() => '?').join(', ');
    const { rowCount } = await execute(
      conn,
      `UPDATE billing_payment_attempts
         SET status = ?, provider = COALESCE(?, provider), provider_reference = COALESCE(?, provider_reference)
       WHERE payment_attempt_id = ? AND status IN (${placeholders})`,
      [to, provider, providerReference, paymentAttemptId, ...from],
    );
    return rowCount > 0;
  }

  async insertTransaction(conn: PoolConnection, attempt: PaymentAttemptRow, provider: string, providerTransactionRef: string, now: Date): Promise<PaymentTransactionRow> {
    const paymentTransactionId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_payment_transactions
         (payment_transaction_id, payment_attempt_id, account_ref, invoice_id, amount_minor, currency_code, provider, provider_transaction_ref,
          quote_id, price_book_id, price_book_version, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentTransactionId,
        attempt.paymentAttemptId,
        attempt.accountRef,
        attempt.invoiceId,
        bigIntToSqlParam(attempt.price.amountMinor),
        attempt.price.currencyCode,
        provider,
        providerTransactionRef,
        attempt.quoteId,
        attempt.priceBookId,
        attempt.priceBookVersion,
        now,
      ],
    );
    const { rows } = await execute<TransactionSqlRow>(conn, `SELECT * FROM billing_payment_transactions WHERE payment_transaction_id = ?`, [paymentTransactionId]);
    return transactionToDomain(rows[0]);
  }

  async findTransactionByAttemptId(conn: PoolConnection, paymentAttemptId: string): Promise<PaymentTransactionRow | null> {
    const { rows } = await execute<TransactionSqlRow>(conn, `SELECT * FROM billing_payment_transactions WHERE payment_attempt_id = ?`, [paymentAttemptId]);
    return rows[0] ? transactionToDomain(rows[0]) : null;
  }

  async findTransactionById(conn: PoolConnection, paymentTransactionId: string): Promise<PaymentTransactionRow | null> {
    const { rows } = await execute<TransactionSqlRow>(conn, `SELECT * FROM billing_payment_transactions WHERE payment_transaction_id = ?`, [paymentTransactionId]);
    return rows[0] ? transactionToDomain(rows[0]) : null;
  }
}

export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly quoteService: QuoteService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  /**
   * Creates a PaymentAttempt from an already-resolved PriceSnapshot
   * (standard PriceBook lookup or custom Quote, quote.ts). If the snapshot
   * carries a quoteId, the quote is consumed in the SAME transaction --
   * a Quote that has already been consumed/expired cannot be reused
   * (QuoteExpiredError propagates and the whole transaction rolls back, so
   * no orphaned attempt is ever created against a dead quote).
   */
  async createAttemptFromSnapshot(input: CreateAttemptInput, snapshot: PriceSnapshot, now: Date = new Date()): Promise<PaymentAttemptRow> {
    return runInTransaction(async (conn) => {
      if (snapshot.quoteId) await this.quoteService.consumeWithinTransaction(conn, snapshot.quoteId, now);
      return this.repository.insertAttempt(conn, input, snapshot, now);
    });
  }

  /**
   * `PCA-ADD-BILL-035`: server-side confirmation is the ONLY path to
   * CONFIRMED -- this method exists to be called from an authoritative
   * server-to-server verification (a future provider adapter's webhook/
   * queryPayment handler), never from a client-reported redirect outcome.
   * Idempotent: a duplicate call for an attempt already CONFIRMED is a
   * no-op returning the existing transaction, never a second transaction
   * row (billing_payment_transactions.payment_attempt_id is UNIQUE).
   */
  async confirmPaymentAttempt(paymentAttemptId: string, provider: string, providerTransactionRef: string, actor: BillingAuditActor, now: Date = new Date()): Promise<PaymentTransactionRow> {
    const { transaction, newlyConfirmed } = await runInTransaction(async (conn) => {
      const existing = await this.repository.findTransactionByAttemptId(conn, paymentAttemptId);
      if (existing) return { transaction: existing, newlyConfirmed: false };

      const transitioned = await this.repository.transitionStatus(conn, paymentAttemptId, ['CREATED', 'PENDING'], 'CONFIRMED', provider, providerTransactionRef);
      if (!transitioned) {
        const attempt = await this.repository.findAttemptById(conn, paymentAttemptId);
        if (attempt?.status === 'CONFIRMED') {
          const tx = await this.repository.findTransactionByAttemptId(conn, paymentAttemptId);
          if (tx) return { transaction: tx, newlyConfirmed: false };
        }
        throw new Error(`PaymentAttempt ${paymentAttemptId} cannot be confirmed from its current status.`);
      }
      const attempt = await this.repository.findAttemptById(conn, paymentAttemptId);
      if (!attempt) throw new Error(`PaymentAttempt not found: ${paymentAttemptId}`);
      const inserted = await this.repository.insertTransaction(conn, attempt, provider, providerTransactionRef, now);
      return { transaction: inserted, newlyConfirmed: true };
    });

    if (newlyConfirmed) {
      await this.auditService.record(
        buildBillingAuditEvent({
          eventType: 'PAYMENT_CONFIRMED',
          actor,
          targetRef: `payment_transaction:${transaction.paymentTransactionId}`,
          occurredAt: now,
          metadata: { paymentAttemptId: transaction.paymentAttemptId, provider: transaction.provider },
        }),
      );
    }
    return transaction;
  }

  async markFailed(paymentAttemptId: string, now: Date = new Date()): Promise<void> {
    await runInTransaction((conn) => this.repository.transitionStatus(conn, paymentAttemptId, ['CREATED', 'PENDING'], 'FAILED', null, null));
  }

  async getAttempt(paymentAttemptId: string, roles: readonly PlatformAdminRole[]): Promise<PaymentAttemptRow | null> {
    requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.findAttemptById(conn, paymentAttemptId));
  }

  /** Builds the Billing -> Entitlement output contract DTO for a given attempt (constraint 14). Read-only projection; never writes anything entitlement-related. */
  async toEntitlementSignal(paymentAttemptId: string): Promise<BillingEntitlementSignal> {
    return runInTransaction(async (conn) => {
      const attempt = await this.repository.findAttemptById(conn, paymentAttemptId);
      if (!attempt) throw new Error(`PaymentAttempt not found: ${paymentAttemptId}`);
      const transaction = await this.repository.findTransactionByAttemptId(conn, paymentAttemptId);
      return {
        increaseRequestRef: attempt.increaseRequestRef,
        targetDeviceLimit: attempt.targetDeviceLimit,
        amountMinor: attempt.price.amountMinor,
        currencyCode: attempt.price.currencyCode,
        quoteId: attempt.quoteId,
        priceBookId: attempt.priceBookId,
        priceBookVersion: attempt.priceBookVersion,
        paymentAttemptId: attempt.paymentAttemptId,
        paymentTransactionId: transaction?.paymentTransactionId ?? null,
        provider: attempt.provider,
        providerReference: attempt.providerReference,
        paymentAttemptStatus: attempt.status,
        confirmedAt: transaction ? transaction.confirmedAt.toISOString() : null,
      };
    });
  }
}
