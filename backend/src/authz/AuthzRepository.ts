import type { OpaqueFamilyId, ScopeStatus, ServiceAccountId } from './types.js';

/**
 * Persistence port for service-plane authorization lookups. Deliberately
 * minimal: a family-scope check and a license check, nothing resembling a
 * role/permission system.
 */
export interface AuthzRepository {
  /** Null if no scope row exists for this (account, family) pair -- callers must not distinguish this from REVOKED. */
  findFamilyScopeStatus(accountId: ServiceAccountId, familyId: OpaqueFamilyId): Promise<ScopeStatus | null>;
  /** True only if the account holds at least one ACTIVE, unexpired license. */
  hasActiveLicense(accountId: ServiceAccountId, now: Date): Promise<boolean>;
}
