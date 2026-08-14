/**
 * PCA Billing Core -- Subscription (`PCA-ADD-BILL-003`). At most one active
 * (TRIALING/ACTIVE/PAST_DUE) subscription per account is a DB-enforced
 * invariant via migrations/0007_billing_core.sql's
 * `billing_subscriptions_active_account_key` UNIQUE KEY over a generated
 * column -- not merely an application-level check (constraint 17).
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export interface SubscriptionRow {
  readonly subscriptionId: string;
  readonly accountRef: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly paymentMethodId: string | null;
  readonly createdAt: Date;
  readonly canceledAt: Date | null;
}

export interface CreateSubscriptionInput {
  readonly accountRef: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly paymentMethodId: string | null;
}

interface SubscriptionSqlRow {
  subscription_id: string;
  account_ref: string;
  plan_id: string;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
  payment_method_id: string | null;
  created_at: Date;
  canceled_at: Date | null;
}

function toDomain(row: SubscriptionSqlRow): SubscriptionRow {
  return {
    subscriptionId: row.subscription_id,
    accountRef: row.account_ref,
    planId: row.plan_id,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    paymentMethodId: row.payment_method_id,
    createdAt: row.created_at,
    canceledAt: row.canceled_at,
  };
}

export class SubscriptionRepository {
  async create(conn: PoolConnection, input: CreateSubscriptionInput, now: Date): Promise<SubscriptionRow> {
    const subscriptionId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_subscriptions
         (subscription_id, account_ref, plan_id, status, current_period_start, current_period_end, payment_method_id, created_at, canceled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [subscriptionId, input.accountRef, input.planId, input.status, input.currentPeriodStart, input.currentPeriodEnd, input.paymentMethodId, now],
    );
    const created = await this.findById(conn, subscriptionId);
    if (!created) throw new Error('Subscription insert did not persist.');
    return created;
  }

  async findById(conn: PoolConnection, subscriptionId: string): Promise<SubscriptionRow | null> {
    const { rows } = await execute<SubscriptionSqlRow>(conn, `SELECT * FROM billing_subscriptions WHERE subscription_id = ?`, [subscriptionId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findActiveForAccount(conn: PoolConnection, accountRef: string): Promise<SubscriptionRow | null> {
    const { rows } = await execute<SubscriptionSqlRow>(
      conn,
      `SELECT * FROM billing_subscriptions WHERE account_ref = ? AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
      [accountRef],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async updateStatus(conn: PoolConnection, subscriptionId: string, status: SubscriptionStatus, now: Date): Promise<void> {
    const canceledAt = status === 'CANCELED' ? now : null;
    await execute(conn, `UPDATE billing_subscriptions SET status = ?, canceled_at = COALESCE(?, canceled_at) WHERE subscription_id = ?`, [
      status,
      canceledAt,
      subscriptionId,
    ]);
  }
}

export class DuplicateActiveSubscriptionError extends Error {
  constructor(accountRef: string) {
    super(`Account ${accountRef} already has an active subscription -- at most one is permitted at a time.`);
    this.name = 'DuplicateActiveSubscriptionError';
  }
}

export class SubscriptionService {
  constructor(private readonly repository: SubscriptionRepository) {}

  async createSubscription(input: CreateSubscriptionInput, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<SubscriptionRow> {
    requireBillingOperation(roles, 'ADMINISTER_BILLING_RECORDS');
    try {
      return await runInTransaction((conn) => this.repository.create(conn, input, now));
    } catch (error) {
      if (isDuplicateEntry(error)) throw new DuplicateActiveSubscriptionError(input.accountRef);
      throw error;
    }
  }

  async getActiveForAccount(accountRef: string, roles: readonly PlatformAdminRole[]): Promise<SubscriptionRow | null> {
    requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.findActiveForAccount(conn, accountRef));
  }

  async cancelSubscription(subscriptionId: string, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<void> {
    requireBillingOperation(roles, 'ADMINISTER_BILLING_RECORDS');
    await runInTransaction((conn) => this.repository.updateStatus(conn, subscriptionId, 'CANCELED', now));
  }
}
