import { execute, runInTransaction } from '../../db/pool.js';
import type { PageRequest, PageResult } from '../api/pagination.js';

export interface ComplimentaryCapacityDirectoryRow {
  readonly familyId: string;
  readonly createdAt: Date;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly planRef: string | null;
  readonly parentMemberLimit: number | null;
  readonly parentMemberUsed: number | null;
  readonly deviceLimit: number | null;
  readonly deviceActive: number | null;
  readonly activeGrantCount: number;
  readonly complimentaryParentMemberCapacity: number;
  readonly complimentaryDeviceCapacity: number;
  readonly complimentaryAccess: boolean;
}

interface Row {
  family_id: string;
  created_at: Date;
  status: 'ACTIVE' | 'SUSPENDED';
  plan_ref: string | null;
  parent_member_limit: number | null;
  parent_member_used_count: number | null;
  managed_device_limit: number | null;
  managed_device_active_count: number | null;
  active_grant_count: number;
  complimentary_parent_member_capacity: number;
  complimentary_device_capacity: number;
  complimentary_access: number;
}

export class ComplimentaryCapacityReadModel {
  async list(page: PageRequest, filter: { createdFrom?: string; createdTo?: string; parentEmailHash?: Buffer } = {}): Promise<PageResult<ComplimentaryCapacityDirectoryRow>> {
    return runInTransaction(async (conn) => {
      const conditions = ['f.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter.createdFrom) { conditions.push('f.created_at >= ?'); params.push(`${filter.createdFrom} 00:00:00.000`); }
      if (filter.createdTo) { conditions.push('f.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${filter.createdTo} 00:00:00.000`); }
      if (filter.parentEmailHash) {
        conditions.push(`EXISTS (SELECT 1 FROM parent_accounts pa
          WHERE pa.email_hash = ? AND pa.status = 'VERIFIED' AND pa.disabled_at IS NULL
            AND (pa.family_id = f.family_id OR f.provisioned_for_account_id = pa.account_id
              OR EXISTS (SELECT 1 FROM family_parent_memberships m WHERE m.account_id = pa.account_id
                AND m.family_id = f.family_id AND m.status = 'ACTIVE' AND m.role = 'ADMINISTRATOR')))`);
        params.push(filter.parentEmailHash);
      }
      const where = conditions.join(' AND ');
      const { rows: counts } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM families f WHERE ${where}`, params);
      const { rows } = await execute<Row>(
        conn,
        `SELECT f.family_id, f.created_at, f.status,
                e.plan_ref, e.parent_member_limit, e.parent_member_used_count,
                e.managed_device_limit, e.managed_device_active_count,
                COALESCE(g.active_grant_count, 0) AS active_grant_count,
                COALESCE(g.parent_member_capacity, 0) AS complimentary_parent_member_capacity,
                COALESCE(g.device_capacity, 0) AS complimentary_device_capacity,
                COALESCE(g.complimentary_access, 0) AS complimentary_access
           FROM families f
           LEFT JOIN account_entitlements e ON e.family_id = f.family_id
           LEFT JOIN (
             SELECT family_id,
                    COUNT(*) AS active_grant_count,
                    SUM(CASE WHEN entitlement_type = 'PARENT_MEMBER_CAPACITY' THEN amount_or_allowance ELSE 0 END) AS parent_member_capacity,
                    SUM(CASE WHEN entitlement_type = 'MANAGED_DEVICE_CAPACITY' THEN amount_or_allowance ELSE 0 END) AS device_capacity,
                    MAX(entitlement_type = 'COMMERCIAL_ACCESS') AS complimentary_access
               FROM complimentary_entitlement_grants
              WHERE status = 'ACTIVE' AND effective_from <= CURRENT_TIMESTAMP(3)
                AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
              GROUP BY family_id
           ) g ON g.family_id = f.family_id
          WHERE ${where}
          ORDER BY f.created_at DESC, f.family_id DESC
          LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      const items = rows.map((row): ComplimentaryCapacityDirectoryRow => ({
        familyId: row.family_id,
        createdAt: row.created_at,
        status: row.status,
        planRef: row.plan_ref,
        parentMemberLimit: row.parent_member_limit,
        parentMemberUsed: row.parent_member_used_count,
        deviceLimit: row.managed_device_limit,
        deviceActive: row.managed_device_active_count,
        activeGrantCount: Number(row.active_grant_count),
        complimentaryParentMemberCapacity: Number(row.complimentary_parent_member_capacity),
        complimentaryDeviceCapacity: Number(row.complimentary_device_capacity),
        complimentaryAccess: row.complimentary_access === 1,
      }));
      return { items, total: Number(counts[0]?.total ?? 0), limit: page.limit, offset: page.offset };
    });
  }
}
