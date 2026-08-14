/**
 * PCA Billing Core -- Plan (`PCA-ADD-BILL-001`). Versioned: changing a
 * plan's terms creates a new (planCode, planVersion) row, never a mutation
 * of an existing one.
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type BillingCadence = 'MONTHLY' | 'ANNUAL' | 'ONE_TIME' | 'FREE';

export interface PlanRow {
  readonly planId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly status: PlanStatus;
  readonly billingCadence: BillingCadence;
  readonly defaultParentMemberLimit: number;
  readonly defaultManagedDeviceLimit: number;
  readonly priceBookId: string | null;
  readonly createdAt: Date;
}

export interface CreatePlanVersionInput {
  readonly planCode: string;
  readonly status: PlanStatus;
  readonly billingCadence: BillingCadence;
  readonly defaultParentMemberLimit: number;
  readonly defaultManagedDeviceLimit: number;
  readonly priceBookId: string | null;
}

interface PlanSqlRow {
  plan_id: string;
  plan_code: string;
  plan_version: number;
  status: string;
  billing_cadence: string;
  default_parent_member_limit: number;
  default_managed_device_limit: number;
  price_book_id: string | null;
  created_at: Date;
}

function toDomain(row: PlanSqlRow): PlanRow {
  return {
    planId: row.plan_id,
    planCode: row.plan_code,
    planVersion: row.plan_version,
    status: row.status as PlanStatus,
    billingCadence: row.billing_cadence as BillingCadence,
    defaultParentMemberLimit: row.default_parent_member_limit,
    defaultManagedDeviceLimit: row.default_managed_device_limit,
    priceBookId: row.price_book_id,
    createdAt: row.created_at,
  };
}

export class PlanRepository {
  async createNewVersionWithinTransaction(conn: PoolConnection, input: CreatePlanVersionInput, now: Date): Promise<PlanRow> {
    const { rows: versionRows } = await execute<{ nextVersion: number }>(
      conn,
      `SELECT COALESCE(MAX(plan_version), 0) + 1 AS nextVersion FROM billing_plans WHERE plan_code = ?`,
      [input.planCode],
    );
    const nextVersion = versionRows[0].nextVersion;
    const planId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_plans
         (plan_id, plan_code, plan_version, status, billing_cadence, default_parent_member_limit, default_managed_device_limit, price_book_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [planId, input.planCode, nextVersion, input.status, input.billingCadence, input.defaultParentMemberLimit, input.defaultManagedDeviceLimit, input.priceBookId, now],
    );
    const created = await this.findById(conn, planId);
    if (!created) throw new Error('Plan insert did not persist.');
    return created;
  }

  async findById(conn: PoolConnection, planId: string): Promise<PlanRow | null> {
    const { rows } = await execute<PlanSqlRow>(conn, `SELECT * FROM billing_plans WHERE plan_id = ?`, [planId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listVersions(conn: PoolConnection, planCode: string): Promise<PlanRow[]> {
    const { rows } = await execute<PlanSqlRow>(conn, `SELECT * FROM billing_plans WHERE plan_code = ? ORDER BY plan_version ASC`, [planCode]);
    return rows.map(toDomain);
  }
}

export class PlanService {
  constructor(private readonly repository: PlanRepository) {}

  async createNewVersion(input: CreatePlanVersionInput, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<PlanRow> {
    requireBillingOperation(roles, 'ADMINISTER_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.createNewVersionWithinTransaction(conn, input, now));
  }

  async listVersions(planCode: string, roles: readonly PlatformAdminRole[]): Promise<PlanRow[]> {
    requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.listVersions(conn, planCode));
  }
}
