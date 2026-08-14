import type { PoolConnection } from 'mysql2/promise';
import type { PlatformAdminAuditEvent, PlatformAdminAuditQueryFilter } from './types.js';
import type { PlatformAdminId, PlatformAdminRole } from '../auth/types.js';

/**
 * Persistence port for the append-only Platform Administration audit log.
 * `insertWithinTransaction` is the primitive every other domain's
 * transactional mutation uses (PlatformAdminAccountService,
 * PlatformAdminAuthService) so the audit write is never a separate,
 * skippable best-effort call after the fact -- it always runs on the SAME
 * connection/transaction as the mutation it records. `insert` (used by
 * PlatformAdminAuditService.record for audit-only writes with no other
 * mutation, e.g. none in this PCA-PA-1 lane today but kept for API
 * completeness) opens its own transaction.
 */
export interface PlatformAdminAuditRepository {
  insert(event: PlatformAdminAuditEvent): Promise<void>;
  insertWithinTransaction(conn: PoolConnection, event: PlatformAdminAuditEvent): Promise<void>;
  queryForRole(
    roles: PlatformAdminRole[],
    callerAdminId: PlatformAdminId,
    filter: PlatformAdminAuditQueryFilter,
  ): Promise<PlatformAdminAuditEvent[]>;
}
