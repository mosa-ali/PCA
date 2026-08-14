import type { PlatformAdminAuditEvent, PlatformAdminAuditQueryFilter } from './types.js';
import type { PlatformAdminAuditRepository } from './AuditRepository.js';
import type { PlatformAdminId, PlatformAdminRole } from '../auth/types.js';

/**
 * Read/write facade over the Platform Administration audit log
 * (PCA-ADD-PA-045/046). `record` is available for a standalone audit-only
 * write (no other mutation in the same transaction); every mutating
 * PlatformAdminAccountService/PlatformAdminAuthService method instead
 * writes its audit row directly via
 * insertPlatformAdminAuditEventRow(conn, event) on its own transaction's
 * connection, so this service is not on that critical atomicity path --
 * see AuditRepository.ts's doc comment.
 */
export class PlatformAdminAuditService {
  private readonly repository: PlatformAdminAuditRepository;

  constructor(repository: PlatformAdminAuditRepository) {
    this.repository = repository;
  }

  async record(event: PlatformAdminAuditEvent): Promise<void> {
    await this.repository.insert(event);
  }

  /**
   * PCA-ADD-PA-046/Section 3.7: APP_OWNER and AUDITOR_READ_ONLY get
   * unrestricted read; every other role sees only events where it was the
   * actor. See MySqlPlatformAdminAuditRepository.queryForRole's doc
   * comment for the documented scope of this "own actions only" subset
   * choice.
   */
  async queryForRole(
    roles: PlatformAdminRole[],
    callerAdminId: PlatformAdminId,
    filter: PlatformAdminAuditQueryFilter = {},
  ): Promise<PlatformAdminAuditEvent[]> {
    return this.repository.queryForRole(roles, callerAdminId, filter);
  }
}
