/**
 * PCA Billing Core -- Invoice / InvoiceLine (`PCA-ADD-BILL-004`/005). Totals
 * are computed via exact integer (bigint) arithmetic only -- see money.ts.
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt, sumMoney } from './money.js';
import type { Money } from './money.js';
import type { CurrencyCode } from './currency.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
export type InvoiceLineType = 'PLAN_CHARGE' | 'PRORATION' | 'DEVICE_LIMIT_INCREASE' | 'CREDIT' | 'OTHER';

export interface InvoiceRow {
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

export interface InvoiceLineInput {
  readonly description: string;
  readonly lineType: InvoiceLineType;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
  readonly quantity: number;
  readonly planId: string | null;
  readonly priceBookId: string | null;
}

export interface CreateInvoiceInput {
  readonly accountRef: string;
  readonly subscriptionId: string | null;
  readonly currencyCode: CurrencyCode;
  readonly dueAt: Date | null;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly lines: readonly InvoiceLineInput[];
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

function toDomain(row: InvoiceSqlRow): InvoiceRow {
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

export class InvoiceRepository {
  async createWithLines(conn: PoolConnection, input: CreateInvoiceInput, now: Date): Promise<InvoiceRow> {
    if (input.lines.some((line) => line.currencyCode !== input.currencyCode)) {
      throw new Error('Every InvoiceLine must share the Invoice currency -- no implicit conversion (PCA-ADD-BILL-031).');
    }
    const total = sumMoney(
      input.lines.map((line) => money(line.amountMinor * BigInt(line.quantity), line.currencyCode)),
      input.currencyCode,
    );
    const invoiceId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_invoices
         (invoice_id, account_ref, subscription_id, status, currency_code, total_amount_minor, created_at, due_at, period_start, period_end)
       VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
      [invoiceId, input.accountRef, input.subscriptionId, input.currencyCode, bigIntToSqlParam(total.amountMinor), now, input.dueAt, input.periodStart, input.periodEnd],
    );
    for (const line of input.lines) {
      await execute(
        conn,
        `INSERT INTO billing_invoice_lines
           (invoice_line_id, invoice_id, description, line_type, amount_minor, currency_code, quantity, plan_id, price_book_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), invoiceId, line.description, line.lineType, bigIntToSqlParam(line.amountMinor), line.currencyCode, line.quantity, line.planId, line.priceBookId, now],
      );
    }
    const created = await this.findById(conn, invoiceId);
    if (!created) throw new Error('Invoice insert did not persist.');
    return created;
  }

  async findById(conn: PoolConnection, invoiceId: string): Promise<InvoiceRow | null> {
    const { rows } = await execute<InvoiceSqlRow>(conn, `SELECT * FROM billing_invoices WHERE invoice_id = ?`, [invoiceId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async updateStatus(conn: PoolConnection, invoiceId: string, status: InvoiceStatus): Promise<void> {
    await execute(conn, `UPDATE billing_invoices SET status = ? WHERE invoice_id = ?`, [status, invoiceId]);
  }
}

export class InvoiceService {
  constructor(private readonly repository: InvoiceRepository) {}

  async createInvoice(input: CreateInvoiceInput, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<InvoiceRow> {
    requireBillingOperation(roles, 'ADMINISTER_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.createWithLines(conn, input, now));
  }

  async getInvoice(invoiceId: string, roles: readonly PlatformAdminRole[]): Promise<InvoiceRow | null> {
    requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.findById(conn, invoiceId));
  }

  async markPaid(invoiceId: string, roles: readonly PlatformAdminRole[]): Promise<void> {
    requireBillingOperation(roles, 'ADMINISTER_BILLING_RECORDS');
    await runInTransaction((conn) => this.repository.updateStatus(conn, invoiceId, 'PAID'));
  }
}
