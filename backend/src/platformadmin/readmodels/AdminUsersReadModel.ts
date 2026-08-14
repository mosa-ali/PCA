/**
 * PCA-PA-3B -- Platform Administration operator-account list/detail read
 * model (mission Section 16). Reads `platform_admin_accounts` joined with
 * `platform_admin_role_assignments` (active grants only) and
 * `platform_admin_mfa_state` (status only, never the ciphertext). No
 * listing method exists on `PlatformAdminAuthRepository`
 * (`findAccountById`/`findActiveRoles` are single-admin lookups only) --
 * this module adds the missing cross-admin list as a read-only additive
 * query against the SAME tables PCA-PA-1 already owns, never mutating
 * them (every mutation still goes through `PlatformAdminAccountService`).
 *
 * NEVER selects `password_credential`, `totp_secret_ciphertext`,
 * `totp_secret_nonce`, or any session `token_hash` -- see this file's own
 * column lists below and the schema-privacy scan in this lane's test
 * suite.
 */

import { execute, runInTransaction } from '../../db/pool.js';
import type { PageRequest, PageResult } from '../api/pagination.js';
import type { PlatformAdminRole } from '../auth/types.js';

export interface AdminUserListRow {
  readonly adminId: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'DISABLED';
  readonly roles: PlatformAdminRole[];
  readonly mfaStatus: string | null;
  readonly createdAt: Date;
  readonly disabledAt: Date | null;
}

interface AccountRow {
  admin_id: string;
  display_name: string;
  status: string;
  created_at: Date;
  disabled_at: Date | null;
}
interface RoleRow {
  admin_id: string;
  role: string;
}
interface MfaRow {
  admin_id: string;
  status: string;
}

export class AdminUsersReadModel {
  async list(page: PageRequest, filter: { status?: 'ACTIVE' | 'DISABLED' }): Promise<PageResult<AdminUserListRow>> {
    return runInTransaction(async (conn) => {
      const clause = filter.status ? 'WHERE status = ?' : '';
      const params = filter.status ? [filter.status] : [];
      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM platform_admin_accounts ${clause}`, params);
      const { rows: accountRows } = await execute<AccountRow>(
        conn,
        `SELECT admin_id, display_name, status, created_at, disabled_at FROM platform_admin_accounts ${clause} ORDER BY created_at DESC, admin_id DESC LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      if (accountRows.length === 0) return { items: [], total: Number(countRows[0]?.total ?? 0), limit: page.limit, offset: page.offset };

      const adminIds = accountRows.map((r) => r.admin_id);
      const placeholders = adminIds.map(() => '?').join(',');
      const { rows: roleRows } = await execute<RoleRow>(
        conn,
        `SELECT admin_id, role FROM platform_admin_role_assignments WHERE admin_id IN (${placeholders}) AND revoked_at IS NULL`,
        adminIds,
      );
      const { rows: mfaRows } = await execute<MfaRow>(
        conn,
        `SELECT admin_id, status FROM platform_admin_mfa_state WHERE admin_id IN (${placeholders})`,
        adminIds,
      );
      const rolesByAdmin = new Map<string, PlatformAdminRole[]>();
      for (const r of roleRows) {
        const list = rolesByAdmin.get(r.admin_id) ?? [];
        list.push(r.role as PlatformAdminRole);
        rolesByAdmin.set(r.admin_id, list);
      }
      const mfaByAdmin = new Map(mfaRows.map((r) => [r.admin_id, r.status]));

      const items: AdminUserListRow[] = accountRows.map((r) => ({
        adminId: r.admin_id,
        displayName: r.display_name,
        status: r.status as 'ACTIVE' | 'DISABLED',
        roles: rolesByAdmin.get(r.admin_id) ?? [],
        mfaStatus: mfaByAdmin.get(r.admin_id) ?? null,
        createdAt: r.created_at,
        disabledAt: r.disabled_at,
      }));
      return { items, total: Number(countRows[0]?.total ?? 0), limit: page.limit, offset: page.offset };
    });
  }

  async getById(adminId: string): Promise<AdminUserListRow | null> {
    return runInTransaction(async (conn) => {
      const { rows: accountRows } = await execute<AccountRow>(
        conn,
        `SELECT admin_id, display_name, status, created_at, disabled_at FROM platform_admin_accounts WHERE admin_id = ?`,
        [adminId],
      );
      const account = accountRows[0];
      if (!account) return null;
      const { rows: roleRows } = await execute<RoleRow>(
        conn,
        `SELECT admin_id, role FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL`,
        [adminId],
      );
      const { rows: mfaRows } = await execute<MfaRow>(conn, `SELECT admin_id, status FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]);
      return {
        adminId: account.admin_id,
        displayName: account.display_name,
        status: account.status as 'ACTIVE' | 'DISABLED',
        roles: roleRows.map((r) => r.role as PlatformAdminRole),
        mfaStatus: mfaRows[0]?.status ?? null,
        createdAt: account.created_at,
        disabledAt: account.disabled_at,
      };
    });
  }
}
