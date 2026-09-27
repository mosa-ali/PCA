import type { OpaqueFamilyId, ScopeStatus, ServiceAccountId } from './types.js';

/**
 * Persistence port for service-plane authorization lookups. A family-scope
 * check is valid only while both the service scope and the matching active
 * Parent membership exist; role-specific decisions remain separate.
 */
export interface AuthzRepository {
  /** Null unless this service account has an ACTIVE scope and matching ACTIVE Parent membership. */
  findFamilyScopeStatus(accountId: ServiceAccountId, familyId: OpaqueFamilyId): Promise<ScopeStatus | null>;
  /** True only if the account holds at least one ACTIVE, unexpired license. */
  hasActiveLicense(accountId: ServiceAccountId, now: Date): Promise<boolean>;
}
