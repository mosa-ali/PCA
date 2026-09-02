/**
 * PCA-PA-3B -- Platform Administration "customer/family commercial
 * account" read model (mission Section 8). Distinct from
 * `PlatformAdminAccountRecord` (Section 2.2 of the API contract inventory
 * -- that is the internal operator-account table, `platform_admin_accounts`).
 * This module reads the `families` table (the closest thing to a
 * customer/account entity that exists in this schema -- see the addendum's
 * own equivalence of "family" and "account" in the entitlement/billing
 * domain) joined, best-effort, with its `account_entitlements` row and its
 * most recent `billing_subscriptions` row.
 *
 * Read-only. No new table, no schema change. Every column selected is
 * already-existing safe commercial metadata: `families.family_reference_hash`
 * is a one-way hash (never a real identifier), `family_id` is an opaque
 * UUID, and the entitlement/subscription columns joined in carry no family
 * activity, policy, or E2EE content (structurally -- neither table has a
 * column capable of holding any).
 *
 * PCA-ADD-PA-017 UPDATE (Writer65): `families.status` now exists (migration
 * 0016, additive) -- see `FamilyAccountStatusService` for the suspend/
 * reactivate write path (RBAC + step-up + audit gated). `statusCapability`
 * below is AVAILABLE for every row.
 */

import { execute, runInTransaction } from '../../db/pool.js';
import type { PageRequest, PageResult } from '../api/pagination.js';

export interface AccountEntitlementSummary {
  readonly planRef: string;
  readonly parentMemberLimit: number;
  readonly managedDeviceLimit: number;
  readonly parentMemberUsedCount: number;
  readonly managedDeviceActiveCount: number;
  readonly managedDeviceReservedCount: number;
  readonly overLimitParentMember: boolean;
  readonly overLimitManagedDevice: boolean;
}

export interface AccountSubscriptionSummary {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly status: string;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
}

export interface AccountSummary {
  readonly familyId: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly entitlement: AccountEntitlementSummary | null;
  readonly latestSubscription: AccountSubscriptionSummary | null;
  readonly statusCapability: 'AVAILABLE';
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly suspendedAt: Date | null;
  readonly suspensionReason: string | null;
}

interface FamilyRow {
  family_id: string;
  created_at: Date;
  deleted_at: Date | null;
  status: 'ACTIVE' | 'SUSPENDED';
  suspended_at: Date | null;
  suspension_reason: string | null;
}

interface EntitlementRow {
  family_id: string;
  plan_ref: string;
  parent_member_limit: number;
  managed_device_limit: number;
  parent_member_used_count: number;
  managed_device_active_count: number;
  managed_device_reserved_count: number;
  over_limit_parent_member: number;
  over_limit_managed_device: number;
}

interface SubscriptionRow {
  account_ref: string;
  subscription_id: string;
  plan_id: string;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
}

function toEntitlementSummary(row: EntitlementRow | undefined): AccountEntitlementSummary | null {
  if (!row) return null;
  return {
    planRef: row.plan_ref,
    parentMemberLimit: row.parent_member_limit,
    managedDeviceLimit: row.managed_device_limit,
    parentMemberUsedCount: row.parent_member_used_count,
    managedDeviceActiveCount: row.managed_device_active_count,
    managedDeviceReservedCount: row.managed_device_reserved_count,
    overLimitParentMember: row.over_limit_parent_member === 1,
    overLimitManagedDevice: row.over_limit_managed_device === 1,
  };
}

function toSubscriptionSummary(row: SubscriptionRow | undefined): AccountSubscriptionSummary | null {
  if (!row) return null;
  return {
    subscriptionId: row.subscription_id,
    planId: row.plan_id,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
  };
}

/** B103/B105: the only two columns this list can search/sort by server-side -- both live directly on `families` (see this class's own doc comment on why entitlement/subscription columns, which only exist for the CURRENT page's rows via a post-pagination join, cannot be sorted this way without restructuring the query). */
export type AccountSortField = 'createdAt' | 'familyId';
export type SortDirection = 'asc' | 'desc';

export interface AccountListFilter {
  /** Exact match on the opaque family UUID -- mirrors this codebase's existing accountRef/familyId filter convention (BillingReadModel, EntitlementRequestsReadModel: always `= ?`, never a fuzzy LIKE, since these are opaque identifiers an operator pastes in whole, not names). */
  readonly familyId?: string;
  readonly sortBy?: AccountSortField;
  readonly sortDir?: SortDirection;
}

export class AccountsReadModel {
  async list(page: PageRequest, includeDeleted: boolean, filter: AccountListFilter = {}): Promise<PageResult<AccountSummary>> {
    return runInTransaction(async (conn) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (!includeDeleted) conditions.push('f.deleted_at IS NULL');
      if (filter.familyId) {
        conditions.push('f.family_id = ?');
        params.push(filter.familyId);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await execute<{ total: number }>(
        conn,
        `SELECT COUNT(*) AS total FROM families f ${whereClause}`,
        params,
      );
      const total = Number(countRows[0]?.total ?? 0);

      // Fixed allow-list, never a raw interpolated client string -- the only
      // two columns a client's sortBy/sortDir can ever select are these two
      // literal ORDER BY clauses.
      const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
      const orderClause = filter.sortBy === 'familyId' ? `f.family_id ${sortDir}` : `f.created_at ${sortDir}, f.family_id ${sortDir}`;

      const { rows: familyRows } = await execute<FamilyRow>(
        conn,
        `SELECT f.family_id, f.created_at, f.deleted_at, f.status, f.suspended_at, f.suspension_reason
         FROM families f
         ${whereClause}
         ORDER BY ${orderClause}
         LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      if (familyRows.length === 0) return { items: [], total, limit: page.limit, offset: page.offset };

      const familyIds = familyRows.map((r) => r.family_id);
      const placeholders = familyIds.map(() => '?').join(',');

      const { rows: entitlementRows } = await execute<EntitlementRow>(
        conn,
        `SELECT * FROM account_entitlements WHERE family_id IN (${placeholders})`,
        familyIds,
      );
      const entitlementByFamily = new Map(entitlementRows.map((r) => [r.family_id, r]));

      // "Most recent subscription per account_ref" -- account_ref is billing's
      // generic opaque account reference, populated == family_id by every
      // existing billing call site (checkout/subscription creation composes
      // against the family's opaque id). LEFT JOIN best-effort: a family with
      // no billing_subscriptions row at all (e.g. still FREE_STARTER, never
      // had a paid plan) simply has no latestSubscription.
      const { rows: subscriptionRows } = await execute<SubscriptionRow>(
        conn,
        `SELECT s.* FROM billing_subscriptions s
         INNER JOIN (
           SELECT account_ref, MAX(created_at) AS max_created_at
           FROM billing_subscriptions
           WHERE account_ref IN (${placeholders})
           GROUP BY account_ref
         ) latest ON latest.account_ref = s.account_ref AND latest.max_created_at = s.created_at`,
        familyIds,
      );
      const subscriptionByFamily = new Map(subscriptionRows.map((r) => [r.account_ref, r]));

      const items: AccountSummary[] = familyRows.map((row) => ({
        familyId: row.family_id,
        createdAt: row.created_at,
        deletedAt: row.deleted_at,
        entitlement: toEntitlementSummary(entitlementByFamily.get(row.family_id)),
        latestSubscription: toSubscriptionSummary(subscriptionByFamily.get(row.family_id)),
        statusCapability: 'AVAILABLE',
        status: row.status,
        suspendedAt: row.suspended_at,
        suspensionReason: row.suspension_reason,
      }));

      return { items, total, limit: page.limit, offset: page.offset };
    });
  }

  async getById(familyId: string): Promise<AccountSummary | null> {
    return runInTransaction(async (conn) => {
      const { rows: familyRows } = await execute<FamilyRow>(
        conn,
        `SELECT family_id, created_at, deleted_at, status, suspended_at, suspension_reason FROM families WHERE family_id = ?`,
        [familyId],
      );
      const familyRow = familyRows[0];
      if (!familyRow) return null;

      const { rows: entitlementRows } = await execute<EntitlementRow>(
        conn,
        `SELECT * FROM account_entitlements WHERE family_id = ?`,
        [familyId],
      );
      const { rows: subscriptionRows } = await execute<SubscriptionRow>(
        conn,
        `SELECT * FROM billing_subscriptions WHERE account_ref = ? ORDER BY created_at DESC LIMIT 1`,
        [familyId],
      );

      return {
        familyId: familyRow.family_id,
        createdAt: familyRow.created_at,
        deletedAt: familyRow.deleted_at,
        entitlement: toEntitlementSummary(entitlementRows[0]),
        latestSubscription: toSubscriptionSummary(subscriptionRows[0]),
        statusCapability: 'AVAILABLE',
        status: familyRow.status,
        suspendedAt: familyRow.suspended_at,
        suspensionReason: familyRow.suspension_reason,
      };
    });
  }
}
