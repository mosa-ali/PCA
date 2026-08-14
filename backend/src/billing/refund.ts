/**
 * PCA Billing Core -- Refund (`PCA-ADD-BILL-009`). Domain/state storage +
 * validation only -- no provider execution (providerContract.ts's
 * `refund()` is what a future PCA-BILL-2 adapter would actually call
 * against a provider; this service never does).
 *
 * STEP-UP (constraint 29): issueRefund requires a step-up grant already
 * consumed via Agent41's PlatformAdminAuthService.consumeStepUp(stepUpId,
 * adminId, sessionId, 'REFUND') -- this service takes the resulting
 * stepUpId as a required input and records it on the refund row
 * (billing_refunds.step_up_session_id, FK to
 * platform_admin_step_up_sessions) so a reviewer can trace every refund
 * back to the specific step-up grant that authorized it. This service never
 * re-implements step-up verification itself.
 *
 * ENTITLEMENT BOUNDARY (constraint 23): issuing a refund NEVER writes to
 * any entitlement table (none exists in this lane). `entitlementTreatment`
 * is an explicit, caller-supplied flag recording the business decision for
 * a later entitlement-owning lane to act on -- it defaults to
 * NOT_APPLICABLE and this service does not infer or default it to anything
 * that implies an entitlement change.
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt } from './money.js';
import type { Money } from './money.js';
import type { CurrencyCode } from './currency.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';
import type { PlatformAdminAuditService } from '../platformadmin/audit/PlatformAdminAuditService.js';
import { buildBillingAuditEvent } from './audit.js';
import type { BillingAuditActor } from './audit.js';
import type { PaymentRepository, PaymentTransactionRow } from './payment.js';

export type RefundEntitlementTreatment = 'NOT_APPLICABLE' | 'ENTITLEMENT_UNCHANGED' | 'ENTITLEMENT_REDUCTION_PENDING';

export interface RefundRow {
  readonly refundId: string;
  readonly paymentTransactionId: string;
  readonly amount: Money;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly initiatedByAdminId: string;
  readonly stepUpSessionId: string;
  readonly entitlementTreatment: RefundEntitlementTreatment;
  readonly status: 'RECORDED' | 'FAILED';
  readonly createdAt: Date;
}

export interface IssueRefundInput {
  readonly paymentTransactionId: string;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly stepUpSessionId: string;
  readonly entitlementTreatment: RefundEntitlementTreatment;
}

interface RefundSqlRow {
  refund_id: string;
  payment_transaction_id: string;
  amount_minor: number | string;
  currency_code: string;
  reason_code: string;
  reason_note: string | null;
  initiated_by_admin_id: string;
  step_up_session_id: string;
  entitlement_treatment: string;
  status: string;
  created_at: Date;
}

function toDomain(row: RefundSqlRow): RefundRow {
  return {
    refundId: row.refund_id,
    paymentTransactionId: row.payment_transaction_id,
    amount: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    initiatedByAdminId: row.initiated_by_admin_id,
    stepUpSessionId: row.step_up_session_id,
    entitlementTreatment: row.entitlement_treatment as RefundEntitlementTreatment,
    status: row.status as RefundRow['status'],
    createdAt: row.created_at,
  };
}

const MAX_REASON_NOTE_LENGTH = 255;

export class RefundRepository {
  async insert(conn: PoolConnection, input: IssueRefundInput, initiatedByAdminId: string, now: Date): Promise<RefundRow> {
    const refundId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_refunds
         (refund_id, payment_transaction_id, amount_minor, currency_code, reason_code, reason_note, initiated_by_admin_id, step_up_session_id, entitlement_treatment, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECORDED', ?)`,
      [
        refundId,
        input.paymentTransactionId,
        bigIntToSqlParam(input.amountMinor),
        input.currencyCode,
        input.reasonCode,
        input.reasonNote,
        initiatedByAdminId,
        input.stepUpSessionId,
        input.entitlementTreatment,
        now,
      ],
    );
    const { rows } = await execute<RefundSqlRow>(conn, `SELECT * FROM billing_refunds WHERE refund_id = ?`, [refundId]);
    return toDomain(rows[0]);
  }

  async sumRefundedForTransaction(conn: PoolConnection, paymentTransactionId: string): Promise<bigint> {
    const { rows } = await execute<{ total: number | string | null }>(
      conn,
      `SELECT SUM(amount_minor) AS total FROM billing_refunds WHERE payment_transaction_id = ? AND status = 'RECORDED'`,
      [paymentTransactionId],
    );
    const total = rows[0]?.total;
    return total === null || total === undefined ? 0n : sqlAmountMinorToBigInt(total);
  }

  async listForTransaction(conn: PoolConnection, paymentTransactionId: string): Promise<RefundRow[]> {
    const { rows } = await execute<RefundSqlRow>(conn, `SELECT * FROM billing_refunds WHERE payment_transaction_id = ? ORDER BY created_at ASC`, [paymentTransactionId]);
    return rows.map(toDomain);
  }
}

export class RefundExceedsTransactionError extends Error {
  constructor() {
    super('Refund amount would exceed the original PaymentTransaction amount (net of prior refunds).');
    this.name = 'RefundExceedsTransactionError';
  }
}

export class RefundCurrencyMismatchError extends Error {
  constructor() {
    super('Refund currency must match the original PaymentTransaction currency.');
    this.name = 'RefundCurrencyMismatchError';
  }
}

export class RefundService {
  constructor(
    private readonly repository: RefundRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async issueRefund(input: IssueRefundInput, actor: BillingAuditActor, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<RefundRow> {
    requireBillingOperation(roles, 'ISSUE_REFUND');
    if (input.amountMinor <= 0n) throw new Error('Refund amountMinor must be positive.');
    if (input.reasonNote && input.reasonNote.length > MAX_REASON_NOTE_LENGTH) {
      throw new Error(`reasonNote must not exceed ${MAX_REASON_NOTE_LENGTH} characters.`);
    }

    const refund = await runInTransaction(async (conn) => {
      const transaction = await this.paymentRepository.findTransactionById(conn, input.paymentTransactionId);
      if (!transaction) throw new Error(`PaymentTransaction not found: ${input.paymentTransactionId}`);
      if (transaction.price.currencyCode !== input.currencyCode) throw new RefundCurrencyMismatchError();

      const alreadyRefunded = await this.repository.sumRefundedForTransaction(conn, input.paymentTransactionId);
      if (alreadyRefunded + input.amountMinor > transaction.price.amountMinor) throw new RefundExceedsTransactionError();

      return this.repository.insert(conn, input, actor.adminId, now);
    });

    await this.auditService.record(
      buildBillingAuditEvent({
        eventType: 'PAYMENT_REFUNDED',
        actor,
        targetRef: `refund:${refund.refundId}`,
        occurredAt: now,
        metadata: {
          paymentTransactionId: input.paymentTransactionId,
          reasonCode: input.reasonCode,
          entitlementTreatment: input.entitlementTreatment,
        },
      }),
    );
    return refund;
  }

  async listForTransaction(paymentTransactionId: string, roles: readonly PlatformAdminRole[]): Promise<RefundRow[]> {
    requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.listForTransaction(conn, paymentTransactionId));
  }
}
