/**
 * PCA-MYKIDS-BILL-2 -- family-scoped, read-only invoice query.
 *
 * WHY THIS IS A STANDALONE QUERY, NOT AN EXTENSION OF `InvoiceRepository`
 * (billing/invoice.ts): that file is an accepted PCA-BILL-1 (Agent44) file
 * outside this lane's ownership boundary, and it exposes no "list invoices
 * for an accountRef" method (only `findById`/`createWithLines`/
 * `updateStatus`) -- `InvoiceService.getInvoice` is also RBAC-gated to
 * `VIEW_BILLING_RECORDS` (APP_OWNER/FINANCE_ADMIN/AUDITOR_READ_ONLY roles
 * only), which a family caller never holds and this mission forbids faking.
 * Exactly like billing/shared/paymentAttemptLookup.ts's own precedent (a
 * standalone query composed alongside an accepted repository rather than
 * editing it), this module runs its own narrow, read-only, family-scoped
 * SELECT against the SAME `billing_invoices`/`billing_invoice_lines` tables
 * -- reusing the exact row-mapping discipline (money via
 * sqlAmountMinorToBigInt/money) `InvoiceRepository` itself uses, never
 * re-deriving amounts or writing to these tables.
 */
import { execute, runInTransaction } from '../db/pool.js';
import { money, sqlAmountMinorToBigInt } from '../billing/money.js';
import type { Money } from '../billing/money.js';
import type { CurrencyCode } from '../billing/currency.js';
import type { InvoiceLineType, InvoiceStatus } from '../billing/invoice.js';

export interface FamilyInvoiceRow {
  readonly invoiceId: string;
  readonly accountRef: string;
  readonly subscriptionId: string | null;
  readonly status: InvoiceStatus;
  readonly total: Money;
  readonly createdAt: Date;
  readonly dueAt: Date | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
}

export interface FamilyInvoiceLineRow {
  readonly invoiceLineId: string;
  readonly invoiceId: string;
  readonly description: string;
  readonly lineType: InvoiceLineType;
  readonly amount: Money;
  readonly quantity: number;
}

interface InvoiceSqlRow {
  invoice_id: string;
  account_ref: string;
  subscription_id: string | null;
  status: string;
  currency_code: string;
  total_amount_minor: number | string;
  created_at: Date;
  due_at: Date | null;
  period_start: Date | null;
  period_end: Date | null;
}

interface InvoiceLineSqlRow {
  invoice_line_id: string;
  invoice_id: string;
  description: string;
  line_type: string;
  amount_minor: number | string;
  currency_code: string;
  quantity: number;
}

function toInvoice(row: InvoiceSqlRow): FamilyInvoiceRow {
  return {
    invoiceId: row.invoice_id,
    accountRef: row.account_ref,
    subscriptionId: row.subscription_id,
    status: row.status as InvoiceStatus,
    total: money(sqlAmountMinorToBigInt(row.total_amount_minor), row.currency_code as CurrencyCode),
    createdAt: row.created_at,
    dueAt: row.due_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  };
}

function toLine(row: InvoiceLineSqlRow): FamilyInvoiceLineRow {
  return {
    invoiceLineId: row.invoice_line_id,
    invoiceId: row.invoice_id,
    description: row.description,
    lineType: row.line_type as InvoiceLineType,
    amount: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    quantity: row.quantity,
  };
}

export class FamilyInvoiceReadRepository {
  /** Every invoice for this family (accountRef === familyId, see CheckoutService's identical convention), newest first. Never queries by any other family's accountRef -- the caller (FamilyCommercialService) always supplies an already-authorized familyId. */
  async listForFamily(familyId: string): Promise<FamilyInvoiceRow[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<InvoiceSqlRow>(conn, `SELECT * FROM billing_invoices WHERE account_ref = ? ORDER BY created_at DESC`, [familyId]),
    );
    return rows.map(toInvoice);
  }

  /** Family-scoped single-invoice read: returns null (never another family's invoice) if the invoice does not exist OR belongs to a different family -- same one-code "not found" discipline as CheckoutService.getCheckoutStatus, so a caller can never distinguish the two (IDOR-safe by construction). */
  async findForFamily(familyId: string, invoiceId: string): Promise<FamilyInvoiceRow | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<InvoiceSqlRow>(conn, `SELECT * FROM billing_invoices WHERE invoice_id = ? AND account_ref = ?`, [invoiceId, familyId]),
    );
    return rows[0] ? toInvoice(rows[0]) : null;
  }

  async listLines(invoiceId: string): Promise<FamilyInvoiceLineRow[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<InvoiceLineSqlRow>(conn, `SELECT * FROM billing_invoice_lines WHERE invoice_id = ? ORDER BY created_at ASC`, [invoiceId]),
    );
    return rows.map(toLine);
  }
}
