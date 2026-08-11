import { execute, runInTransaction } from '../db/pool.js';
import type { AuthzRepository } from './AuthzRepository.js';
import type { OpaqueFamilyId, ScopeStatus, ServiceAccountId } from './types.js';

export class MySqlAuthzRepository implements AuthzRepository {
  async findFamilyScopeStatus(accountId: ServiceAccountId, familyId: OpaqueFamilyId): Promise<ScopeStatus | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<{ status: ScopeStatus }>(
        conn,
        `SELECT status FROM service_account_family_scopes WHERE account_id = ? AND family_id = ?`,
        [accountId, familyId],
      ),
    );
    return rows[0]?.status ?? null;
  }

  async hasActiveLicense(accountId: ServiceAccountId, now: Date): Promise<boolean> {
    const { rows } = await runInTransaction((conn) =>
      execute(
        conn,
        `SELECT 1 FROM licenses WHERE account_id = ? AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
        [accountId, now],
      ),
    );
    return rows.length > 0;
  }
}
