/**
 * PCA Billing Core -- PaymentMethod (`PCA-ADD-BILL-008`/024). Provider-safe
 * metadata ONLY -- see migrations/0007_billing_core.sql's own PAYMENT
 * SECURITY header note and backend/test/schema-privacy.test.mjs /
 * backend/test/db/schema-privacy.mysql.test.mjs for the schema-privacy
 * proof that no PAN/CVV/raw-credential column exists here.
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';

export type PaymentMethodStatus = 'ACTIVE' | 'REMOVED';

export interface PaymentMethodRow {
  readonly paymentMethodId: string;
  readonly accountRef: string;
  readonly provider: string;
  readonly providerPaymentMethodRef: string;
  readonly brand: string | null;
  readonly displayLabel: string;
  readonly last4: string | null;
  readonly expiryMonth: number | null;
  readonly expiryYear: number | null;
  readonly status: PaymentMethodStatus;
  readonly createdAt: Date;
}

export interface AddPaymentMethodInput {
  readonly accountRef: string;
  readonly provider: string;
  readonly providerPaymentMethodRef: string;
  readonly brand: string | null;
  readonly displayLabel: string;
  readonly last4: string | null;
  readonly expiryMonth: number | null;
  readonly expiryYear: number | null;
}

interface PaymentMethodSqlRow {
  payment_method_id: string;
  account_ref: string;
  provider: string;
  provider_payment_method_ref: string;
  brand: string | null;
  display_label: string;
  last4: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  status: string;
  created_at: Date;
}

function toDomain(row: PaymentMethodSqlRow): PaymentMethodRow {
  return {
    paymentMethodId: row.payment_method_id,
    accountRef: row.account_ref,
    provider: row.provider,
    providerPaymentMethodRef: row.provider_payment_method_ref,
    brand: row.brand,
    displayLabel: row.display_label,
    last4: row.last4,
    expiryMonth: row.expiry_month,
    expiryYear: row.expiry_year,
    status: row.status as PaymentMethodStatus,
    createdAt: row.created_at,
  };
}

export class PaymentMethodRepository {
  async insert(conn: PoolConnection, input: AddPaymentMethodInput, now: Date): Promise<PaymentMethodRow> {
    const paymentMethodId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_payment_methods
         (payment_method_id, account_ref, provider, provider_payment_method_ref, brand, display_label, last4, expiry_month, expiry_year, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [paymentMethodId, input.accountRef, input.provider, input.providerPaymentMethodRef, input.brand, input.displayLabel, input.last4, input.expiryMonth, input.expiryYear, now],
    );
    const created = await this.findById(conn, paymentMethodId);
    if (!created) throw new Error('PaymentMethod insert did not persist.');
    return created;
  }

  async findById(conn: PoolConnection, paymentMethodId: string): Promise<PaymentMethodRow | null> {
    const { rows } = await execute<PaymentMethodSqlRow>(conn, `SELECT * FROM billing_payment_methods WHERE payment_method_id = ?`, [paymentMethodId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForAccount(conn: PoolConnection, accountRef: string): Promise<PaymentMethodRow[]> {
    const { rows } = await execute<PaymentMethodSqlRow>(
      conn,
      `SELECT * FROM billing_payment_methods WHERE account_ref = ? AND status = 'ACTIVE' ORDER BY created_at DESC`,
      [accountRef],
    );
    return rows.map(toDomain);
  }

  async remove(conn: PoolConnection, paymentMethodId: string): Promise<void> {
    await execute(conn, `UPDATE billing_payment_methods SET status = 'REMOVED' WHERE payment_method_id = ?`, [paymentMethodId]);
  }
}

export class PaymentMethodService {
  constructor(private readonly repository: PaymentMethodRepository) {}

  async addPaymentMethod(input: AddPaymentMethodInput, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<PaymentMethodRow> {
    // Security fix (adversarial review, 2026-09-02): this is a write, and must be gated on
    // ADMINISTER_BILLING_RECORDS (APP_OWNER/FINANCE_ADMIN only), not VIEW_PAYMENT_INSTRUMENTS
    // (which also allows AUDITOR_READ_ONLY) -- the read-scoped operation was previously used here
    // by mistake, letting a read-only auditor create billing_payment_methods rows once a real
    // HTTP route was wired to this method.
    requireBillingOperation(roles, 'ADMINISTER_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.insert(conn, input, now));
  }

  async listForAccount(accountRef: string, roles: readonly PlatformAdminRole[]): Promise<PaymentMethodRow[]> {
    requireBillingOperation(roles, 'VIEW_PAYMENT_INSTRUMENTS');
    return runInTransaction((conn) => this.repository.listForAccount(conn, accountRef));
  }
}
