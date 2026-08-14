/**
 * PCA-BILL-2A -- a small read-only query helper against
 * billing_payment_attempts, used by the webhook pipeline to resolve which
 * PaymentAttempt a provider's `providerPaymentRef` refers to.
 *
 * This is deliberately NOT added as a method on payment.ts's
 * PaymentRepository (an accepted, do-not-edit PCA-BILL-1 file) -- it is a
 * standalone query in this lane's own file, composed alongside that
 * repository rather than extending it. Uses the exact same `execute`/
 * `runInTransaction` primitives and row-mapping discipline as payment.ts
 * for consistency.
 */
import { execute, runInTransaction } from '../../db/pool.js';
import { money, sqlAmountMinorToBigInt } from '../money.js';
import type { CurrencyCode } from '../currency.js';
import type { PaymentAttemptRow, PaymentAttemptStatus } from '../payment.js';

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

function toDomain(row: AttemptSqlRow): PaymentAttemptRow {
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

/** Finds the (at most one, by convention) PaymentAttempt currently carrying this (provider, providerReference) pair. */
export async function findPaymentAttemptByProviderReference(provider: string, providerReference: string): Promise<PaymentAttemptRow | null> {
  const { rows } = await runInTransaction((conn) =>
    execute<AttemptSqlRow>(conn, `SELECT * FROM billing_payment_attempts WHERE provider = ? AND provider_reference = ?`, [provider, providerReference]),
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

/**
 * PCA-BILL-2A-R1 correction (checkout split-state fix): finds the single
 * NOT-YET-TERMINAL (`CREATED` or `PENDING`) PaymentAttempt for a given
 * entitlement change-request, if one exists. This is the lookup
 * `CheckoutService.createCheckoutSession` performs FIRST, before ever
 * calling `PaymentService.createAttemptFromSnapshot`/the provider, so a
 * retried checkout-create call for the same `requestId` reuses the
 * existing attempt instead of creating a second, orphaned one.
 *
 * `increase_request_ref` is a bounded opaque VARCHAR (never a foreign key,
 * see payment.ts's own header) so this is a plain indexed lookup
 * (`billing_payment_attempts_increase_request_ref_idx`, migration 0007),
 * not a join. Ordered by `created_at DESC` and capped at one row purely as
 * defensive belt-and-suspenders -- by this lane's own invariant (a request
 * can only be in one checkout flow at a time, enforced by
 * ChangeRequestService's own QUOTED/PAYMENT_PENDING state machine) there
 * should never be more than one CREATED/PENDING attempt per request, but
 * this query does not assume that going in.
 */
export async function findActivePaymentAttemptByIncreaseRequestRef(increaseRequestRef: string): Promise<PaymentAttemptRow | null> {
  const { rows } = await runInTransaction((conn) =>
    execute<AttemptSqlRow>(
      conn,
      `SELECT * FROM billing_payment_attempts
         WHERE increase_request_ref = ? AND status IN ('CREATED', 'PENDING')
       ORDER BY created_at DESC
       LIMIT 1`,
      [increaseRequestRef],
    ),
  );
  return rows[0] ? toDomain(rows[0]) : null;
}
