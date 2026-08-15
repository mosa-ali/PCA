import type { PoolConnection } from 'mysql2/promise';
import type { FreeAccessSnapshot, ParentAccountId, ParentAccountStatus } from '../types.js';
import type { FreeAccessAdjustmentAction } from './adjustment.js';

export interface FreeAccessAccountRow {
  accountId: ParentAccountId;
  status: ParentAccountStatus;
  disabledAt: Date | null;
  freeAccess: FreeAccessSnapshot | null;
}

export interface FreeAccessAdjustmentResult {
  before: FreeAccessSnapshot;
  after: FreeAccessSnapshot;
}

/**
 * A second, narrowly-scoped read/write port against the SAME
 * `parent_accounts` table `MySqlParentAccountRepository` (a different,
 * un-owned-by-this-lane file) already owns -- mirrors that repository's
 * own established precedent of direct, doc-justified queries against a
 * shared table for a distinct purpose (see its `revokeAllServiceSessionsFor`/
 * `grantFamilyScopeIfAbsent`, which do the same thing against
 * `service_sessions`/`service_account_family_scopes`). This port only ever
 * reads/writes the `free_access_*`/`default_*_limit` columns -- never
 * `password_hash`, `email_hash`, `status` (read-only here), or any other
 * column -- and never duplicates `ParentAccountRepository`'s own identity/
 * session/verification responsibilities.
 */
export interface FreeAccessAccountRepository {
  findByAccountId(accountId: ParentAccountId): Promise<FreeAccessAccountRow | null>;

  /**
   * Convenience wrapper around `adjustFreeAccessWithinTransaction` that
   * opens its own transaction -- for callers that do not need to pair the
   * write with anything else in the same transaction.
   */
  adjustFreeAccess(accountId: ParentAccountId, action: FreeAccessAdjustmentAction, now: Date): Promise<FreeAccessAdjustmentResult | null>;

  /**
   * Same operation, but on a caller-supplied connection -- so
   * `FreeAccessAdminService` can write the paired
   * `platform_admin_audit_events` row in the SAME transaction as the
   * mutation itself (never a separate best-effort audit call), exactly the
   * discipline `insertPlatformAdminAuditEventRow`'s own doc comment
   * describes. Returns null if the account does not exist, is not
   * VERIFIED, or (defensively) has no FreeAccessSnapshot yet -- the caller
   * maps that to a typed NOT_FOUND, never a silent no-op mutation.
   */
  adjustFreeAccessWithinTransaction(
    conn: PoolConnection,
    accountId: ParentAccountId,
    action: FreeAccessAdjustmentAction,
    now: Date,
  ): Promise<FreeAccessAdjustmentResult | null>;
}
