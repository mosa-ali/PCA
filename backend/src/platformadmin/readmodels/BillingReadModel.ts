/**
 * PCA-PA-3B -- Platform Administration safe billing READ views (mission
 * Section 15): subscriptions, invoices (+lines), payment attempts,
 * payment transactions, refunds, disputes. Read-only bounded lists --
 * none of the underlying `billing/*` Service classes expose a listing
 * method (confirmed by the API contract inventory: every existing Billing
 * Core repository is keyed lookups only, no cross-account/global list).
 * This module adds exactly that, composing the SAME tables those services
 * already own, never mutating them and never duplicating their business
 * logic (publish/refund/dispute mutation still goes exclusively through
 * `billing/priceBook.ts` / `billing/refundOrchestration/*` / `billing/dispute.ts`).
 *
 * No raw provider payload is ever selected -- every SELECT below lists
 * only the columns `billing/*`'s own domain types already expose
 * (`provider_reference`/`provider_transaction_ref` are opaque references,
 * never a payload blob; `billing_provider_events`' raw payload column, if
 * any, is never touched by this module).
 */

import { execute, runInTransaction } from '../../db/pool.js';
import { money, sqlAmountMinorToBigInt } from '../../billing/money.js';
import type { Money } from '../../billing/money.js';
import type { CurrencyCode } from '../../billing/currency.js';
import type { PageRequest, PageResult } from '../api/pagination.js';

export interface SubscriptionListRow {
  readonly subscriptionId: string;
  readonly accountRef: string;
  readonly planId: string;
  readonly status: string;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly createdAt: Date;
  readonly canceledAt: Date | null;
}

export interface InvoiceListRow {
  readonly invoiceId: string;
  readonly accountRef: string;
  readonly subscriptionId: string | null;
  readonly status: string;
  readonly total: Money;
  readonly createdAt: Date;
  readonly dueAt: Date | null;
}

export interface PaymentAttemptListRow {
  readonly paymentAttemptId: string;
  readonly accountRef: string;
  readonly invoiceId: string | null;
  readonly increaseRequestRef: string | null;
  readonly amount: Money;
  readonly status: string;
  readonly provider: string | null;
  readonly providerReference: string | null;
  readonly createdAt: Date;
}

export interface PaymentTransactionListRow {
  readonly paymentTransactionId: string;
  readonly paymentAttemptId: string;
  readonly accountRef: string;
  readonly amount: Money;
  readonly provider: string;
  readonly providerTransactionRef: string;
  readonly confirmedAt: Date;
}

export interface RefundListRow {
  readonly refundId: string;
  readonly paymentTransactionId: string;
  readonly amount: Money;
  readonly reasonCode: string;
  readonly status: string;
  readonly entitlementTreatment: string;
  readonly initiatedByAdminId: string;
  readonly createdAt: Date;
}

export interface DisputeListRow {
  readonly disputeId: string;
  readonly paymentTransactionId: string;
  readonly status: string;
  readonly evidenceDueAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PlanListRow {
  readonly planId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly status: string;
  readonly billingCadence: string;
  readonly defaultParentMemberLimit: number;
  readonly defaultManagedDeviceLimit: number;
  readonly priceBookId: string | null;
  readonly createdAt: Date;
}

export interface PendingCustomQuoteRow {
  readonly requestId: string;
  readonly familyId: string;
  readonly limitType: string;
  readonly targetLimit: number;
  readonly currentLimitAtRequest: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PendingCustomQuoteFilter {
  readonly familyId?: string;
  readonly sinceCreatedAt?: Date;
  readonly untilCreatedAt?: Date;
}

function buildFilterClause(filters: Array<[string, unknown]>): { clause: string; params: unknown[] } {
  const present = filters.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (present.length === 0) return { clause: '', params: [] };
  return {
    clause: `WHERE ${present.map(([col]) => `${col} = ?`).join(' AND ')}`,
    params: present.map(([, value]) => value),
  };
}

export class BillingReadModel {
  async listSubscriptions(page: PageRequest, filter: { accountRef?: string; status?: string }): Promise<PageResult<SubscriptionListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([
        ['account_ref', filter.accountRef],
        ['status', filter.status],
      ]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_subscriptions ${clause}`, params);
      const { rows } = await execute<{
        subscription_id: string;
        account_ref: string;
        plan_id: string;
        status: string;
        current_period_start: Date;
        current_period_end: Date;
        created_at: Date;
        canceled_at: Date | null;
      }>(
        conn,
        `SELECT * FROM billing_subscriptions ${clause} ORDER BY created_at DESC, subscription_id DESC LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      return {
        items: rows.map((r) => ({
          subscriptionId: r.subscription_id,
          accountRef: r.account_ref,
          planId: r.plan_id,
          status: r.status,
          currentPeriodStart: r.current_period_start,
          currentPeriodEnd: r.current_period_end,
          createdAt: r.created_at,
          canceledAt: r.canceled_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  async listInvoices(page: PageRequest, filter: { accountRef?: string; status?: string }): Promise<PageResult<InvoiceListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([
        ['account_ref', filter.accountRef],
        ['status', filter.status],
      ]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_invoices ${clause}`, params);
      const { rows } = await execute<{
        invoice_id: string;
        account_ref: string;
        subscription_id: string | null;
        status: string;
        currency_code: CurrencyCode;
        total_amount_minor: number | string;
        created_at: Date;
        due_at: Date | null;
      }>(conn, `SELECT * FROM billing_invoices ${clause} ORDER BY created_at DESC, invoice_id DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]);
      return {
        items: rows.map((r) => ({
          invoiceId: r.invoice_id,
          accountRef: r.account_ref,
          subscriptionId: r.subscription_id,
          status: r.status,
          total: money(sqlAmountMinorToBigInt(r.total_amount_minor), r.currency_code),
          createdAt: r.created_at,
          dueAt: r.due_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  async listPaymentAttempts(page: PageRequest, filter: { accountRef?: string; status?: string }): Promise<PageResult<PaymentAttemptListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([
        ['account_ref', filter.accountRef],
        ['status', filter.status],
      ]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_payment_attempts ${clause}`, params);
      const { rows } = await execute<{
        payment_attempt_id: string;
        account_ref: string;
        invoice_id: string | null;
        increase_request_ref: string | null;
        amount_minor: number | string;
        currency_code: CurrencyCode;
        status: string;
        provider: string | null;
        provider_reference: string | null;
        created_at: Date;
      }>(
        conn,
        `SELECT * FROM billing_payment_attempts ${clause} ORDER BY created_at DESC, payment_attempt_id DESC LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      return {
        items: rows.map((r) => ({
          paymentAttemptId: r.payment_attempt_id,
          accountRef: r.account_ref,
          invoiceId: r.invoice_id,
          increaseRequestRef: r.increase_request_ref,
          amount: money(sqlAmountMinorToBigInt(r.amount_minor), r.currency_code),
          status: r.status,
          provider: r.provider,
          providerReference: r.provider_reference,
          createdAt: r.created_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  async listPaymentTransactions(page: PageRequest, filter: { accountRef?: string }): Promise<PageResult<PaymentTransactionListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([['account_ref', filter.accountRef]]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_payment_transactions ${clause}`, params);
      const { rows } = await execute<{
        payment_transaction_id: string;
        payment_attempt_id: string;
        account_ref: string;
        amount_minor: number | string;
        currency_code: CurrencyCode;
        provider: string;
        provider_transaction_ref: string;
        confirmed_at: Date;
      }>(
        conn,
        `SELECT * FROM billing_payment_transactions ${clause} ORDER BY confirmed_at DESC, payment_transaction_id DESC LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      return {
        items: rows.map((r) => ({
          paymentTransactionId: r.payment_transaction_id,
          paymentAttemptId: r.payment_attempt_id,
          accountRef: r.account_ref,
          amount: money(sqlAmountMinorToBigInt(r.amount_minor), r.currency_code),
          provider: r.provider,
          providerTransactionRef: r.provider_transaction_ref,
          confirmedAt: r.confirmed_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  async listRefunds(page: PageRequest, filter: { paymentTransactionId?: string }): Promise<PageResult<RefundListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([['payment_transaction_id', filter.paymentTransactionId]]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_refunds ${clause}`, params);
      const { rows } = await execute<{
        refund_id: string;
        payment_transaction_id: string;
        amount_minor: number | string;
        currency_code: CurrencyCode;
        reason_code: string;
        status: string;
        entitlement_treatment: string;
        initiated_by_admin_id: string;
        created_at: Date;
      }>(conn, `SELECT * FROM billing_refunds ${clause} ORDER BY created_at DESC, refund_id DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]);
      return {
        items: rows.map((r) => ({
          refundId: r.refund_id,
          paymentTransactionId: r.payment_transaction_id,
          amount: money(sqlAmountMinorToBigInt(r.amount_minor), r.currency_code),
          reasonCode: r.reason_code,
          status: r.status,
          entitlementTreatment: r.entitlement_treatment,
          initiatedByAdminId: r.initiated_by_admin_id,
          createdAt: r.created_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  async listDisputes(page: PageRequest, filter: { status?: string }): Promise<PageResult<DisputeListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([['status', filter.status]]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_disputes ${clause}`, params);
      const { rows } = await execute<{
        dispute_id: string;
        payment_transaction_id: string;
        status: string;
        evidence_due_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(conn, `SELECT * FROM billing_disputes ${clause} ORDER BY created_at DESC, dispute_id DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]);
      return {
        items: rows.map((r) => ({
          disputeId: r.dispute_id,
          paymentTransactionId: r.payment_transaction_id,
          status: r.status,
          evidenceDueAt: r.evidence_due_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  /**
   * "Browse all billing plans" -- `billing/plan.ts`'s `PlanRepository` is
   * keyed-lookup only (`findById`, `listVersions(planCode)`): there is no
   * way to discover a plan code without already knowing one. Same gap this
   * module's other 7 lists were built to close (see file header), so this
   * follows the identical shape rather than adding a parallel "list all"
   * primitive on `PlanRepository` itself -- `billing_plans` is read here
   * exactly as read-only/composed as every other table this module lists.
   */
  async listPlans(page: PageRequest, filter: { planCode?: string; status?: string; billingCadence?: string }): Promise<PageResult<PlanListRow>> {
    return runInTransaction(async (conn) => {
      const { clause, params } = buildFilterClause([
        ['plan_code', filter.planCode],
        ['status', filter.status],
        ['billing_cadence', filter.billingCadence],
      ]);
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM billing_plans ${clause}`, params);
      const { rows } = await execute<{
        plan_id: string;
        plan_code: string;
        plan_version: number;
        status: string;
        billing_cadence: string;
        default_parent_member_limit: number;
        default_managed_device_limit: number;
        price_book_id: string | null;
        created_at: Date;
      }>(conn, `SELECT * FROM billing_plans ${clause} ORDER BY created_at DESC, plan_id DESC LIMIT ? OFFSET ?`, [...params, page.limit, page.offset]);
      return {
        items: rows.map((r) => ({
          planId: r.plan_id,
          planCode: r.plan_code,
          planVersion: r.plan_version,
          status: r.status,
          billingCadence: r.billing_cadence,
          defaultParentMemberLimit: r.default_parent_member_limit,
          defaultManagedDeviceLimit: r.default_managed_device_limit,
          priceBookId: r.price_book_id,
          createdAt: r.created_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }

  /**
   * Mission Section 14's "list pending custom-quote requests" -- reads the
   * `entitlement_change_requests` table's `awaiting_admin_quote` flag
   * (`PCA-ADD-PA-050`'s custom path) directly. This is the entitlement
   * increase-request-embedded quote model, NOT `billing_quotes`
   * (Billing Core's own, structurally separate `Quote` table) -- the API
   * contract inventory flagged these as two parallel quote concepts; this
   * one is the one actually wired into `ChangeRequestService.issueCustomQuote`,
   * which `PlatformAdminEntitlementService.issueCustomQuote` already
   * delegates to, so it is the correct source for an operator's "quotes
   * awaiting my action" queue.
   *
   * `filter` mirrors AuditReadModel.query's optional-conditions-array
   * pattern exactly (same file's the closest existing precedent for a
   * family/date-range filter on top of an otherwise-fixed WHERE clause).
   */
  async listPendingCustomQuoteRequests(
    page: PageRequest,
    filter: PendingCustomQuoteFilter = {},
  ): Promise<PageResult<PendingCustomQuoteRow>> {
    const conditions = [`state = 'PENDING'`, `awaiting_admin_quote = 1`];
    const params: unknown[] = [];
    if (filter.familyId) {
      conditions.push('family_id = ?');
      params.push(filter.familyId);
    }
    if (filter.sinceCreatedAt) {
      conditions.push('created_at >= ?');
      params.push(filter.sinceCreatedAt);
    }
    if (filter.untilCreatedAt) {
      conditions.push('created_at <= ?');
      params.push(filter.untilCreatedAt);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    return runInTransaction(async (conn) => {
      const { rows: countRows } = await execute<{ total: number }>(
        conn,
        `SELECT COUNT(*) AS total FROM entitlement_change_requests ${whereClause}`,
        params,
      );
      const { rows } = await execute<{
        request_id: string;
        family_id: string;
        limit_type: string;
        target_limit: number;
        current_limit_at_request: number;
        created_at: Date;
        updated_at: Date;
      }>(
        conn,
        `SELECT request_id, family_id, limit_type, target_limit, current_limit_at_request, created_at, updated_at
         FROM entitlement_change_requests
         ${whereClause}
         ORDER BY created_at ASC, request_id ASC
         LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      return {
        items: rows.map((r) => ({
          requestId: r.request_id,
          familyId: r.family_id,
          limitType: r.limit_type,
          targetLimit: r.target_limit,
          currentLimitAtRequest: r.current_limit_at_request,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        total: Number(countRows[0]?.total ?? 0),
        limit: page.limit,
        offset: page.offset,
      };
    });
  }
}
