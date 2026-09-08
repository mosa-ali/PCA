/**
 * PCA-ADD-BILL-004/005/006 -- the parent-facing invoice a confirmed payment produces.
 *
 * Until 2026-09-08 nothing wrote `billing_invoices` on the payment path: `InvoiceService`
 * existed only as an operator-RBAC-gated admin call with no caller, so a real confirmed
 * payment raised the entitlement and recorded the `PaymentTransaction`, but the family's
 * "Invoices and receipts" page (`FamilyInvoiceReadRepository`, `account_ref === familyId`)
 * stayed empty forever -- the DEV fixture client issued one, production never did (FABLE-A036).
 *
 * Idempotency without a schema change: the invoice id is DERIVED from the payment transaction
 * id (a SHA-256 name-based UUID), so the primary key is the idempotency key. A redelivered
 * webhook, an out-of-order second event for the same payment, or a re-driven FAILED event can
 * only ever find or race-lose to the same row -- never issue a second invoice. The transaction
 * and attempt rows are then linked to it through their existing `invoice_id` columns.
 *
 * Money: the invoice total is the transaction's own confirmed price, copied exactly (bigint
 * minor units, same currency); nothing is recomputed from a price book that may since have
 * changed (PCA-ADD-BILL-043 snapshot immutability).
 */

import { createHash } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import { InvoiceRepository } from './invoice.js';
import type { InvoiceLineType, InvoiceRow } from './invoice.js';
import type { PaymentAttemptRow, PaymentTransactionRow } from './payment.js';

/** Name-based UUID (RFC 4122 layout, version nibble 5) derived from the payment transaction id. Stable for the life of the transaction. */
export function invoiceIdForPaymentTransaction(paymentTransactionId: string): string {
  if (typeof paymentTransactionId !== 'string' || paymentTransactionId.length === 0) {
    throw new Error('invoiceIdForPaymentTransaction requires a non-empty payment transaction id');
  }
  const digest = createHash('sha256').update(`pca-invoice:${paymentTransactionId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface InvoiceLineDescription {
  readonly description: string;
  readonly lineType: InvoiceLineType;
}

/** What the single invoice line says. Never carries a provider reference, card detail or family data -- the line is parent-visible. */
export function describeInvoiceLine(attempt: Pick<PaymentAttemptRow, 'targetDeviceLimit'>): InvoiceLineDescription {
  // The attempt's own price snapshot says what was bought (PCA-ADD-BILL-043): a snapshotted
  // target device limit is a device-limit purchase whether or not the change-request
  // reference is present on the attempt row.
  if (attempt.targetDeviceLimit !== null) {
    return { description: `Managed device allowance increase to ${attempt.targetDeviceLimit}`, lineType: 'DEVICE_LIMIT_INCREASE' };
  }
  return { description: 'Confirmed payment', lineType: 'OTHER' };
}

export interface IssuedInvoice {
  readonly invoice: InvoiceRow;
  /** False when the invoice already existed (redelivery, re-drive, or a lost race with a concurrent issuer). */
  readonly created: boolean;
}

export class PaymentInvoiceIssuer {
  constructor(private readonly repository: InvoiceRepository = new InvoiceRepository()) {}

  /** Idempotent post-commit write, same discipline as the payment notifications: safe to call on every delivery of a confirmed payment. */
  async issuePaidInvoiceForTransaction(transaction: PaymentTransactionRow, attempt: PaymentAttemptRow, now: Date): Promise<IssuedInvoice> {
    return runInTransaction((conn) => this.issueWithin(conn, transaction, attempt, now));
  }

  async issueWithin(conn: PoolConnection, transaction: PaymentTransactionRow, attempt: PaymentAttemptRow, now: Date): Promise<IssuedInvoice> {
    const invoiceId = invoiceIdForPaymentTransaction(transaction.paymentTransactionId);
    const existing = await this.repository.findById(conn, invoiceId);
    if (existing) {
      await this.link(conn, invoiceId, transaction, attempt);
      return { invoice: existing, created: false };
    }
    const line = describeInvoiceLine(attempt);
    let invoice: InvoiceRow;
    try {
      invoice = await this.repository.createWithLines(
        conn,
        {
          accountRef: transaction.accountRef,
          subscriptionId: null,
          currencyCode: transaction.price.currencyCode,
          dueAt: null,
          periodStart: null,
          periodEnd: null,
          lines: [
            {
              description: line.description,
              lineType: line.lineType,
              amountMinor: transaction.price.amountMinor,
              currencyCode: transaction.price.currencyCode,
              quantity: 1,
              planId: null,
              priceBookId: transaction.priceBookId,
            },
          ],
        },
        now,
        { invoiceId, status: 'PAID' },
      );
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const raced = await this.repository.findById(conn, invoiceId);
      if (!raced) throw error;
      await this.link(conn, invoiceId, transaction, attempt);
      return { invoice: raced, created: false };
    }
    await this.link(conn, invoiceId, transaction, attempt);
    return { invoice, created: true };
  }

  private async link(conn: PoolConnection, invoiceId: string, transaction: PaymentTransactionRow, attempt: PaymentAttemptRow): Promise<void> {
    await execute(conn, `UPDATE billing_payment_transactions SET invoice_id = ? WHERE payment_transaction_id = ? AND invoice_id IS NULL`, [invoiceId, transaction.paymentTransactionId]);
    await execute(conn, `UPDATE billing_payment_attempts SET invoice_id = ? WHERE payment_attempt_id = ? AND invoice_id IS NULL`, [invoiceId, attempt.paymentAttemptId]);
  }
}
