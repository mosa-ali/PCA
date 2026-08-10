import { runInTransaction } from '../db/pool.js';
import type { AuthzRepository } from './AuthzRepository.js';
import type { OpaqueFamilyId, ScopeStatus, ServiceAccountId } from './types.js';

export class PostgresAuthzRepository implements AuthzRepository {
  async findFamilyScopeStatus(accountId: ServiceAccountId, familyId: OpaqueFamilyId): Promise<ScopeStatus | null> {
    const { rows } = await runInTransaction((client) =>
      client.query<{ status: ScopeStatus }>(
        `SELECT status FROM service_account_family_scopes WHERE account_id = $1 AND family_id = $2`,
        [accountId, familyId],
      ),
    );
    return rows[0]?.status ?? null;
  }

  async hasActiveLicense(accountId: ServiceAccountId, now: Date): Promise<boolean> {
    const { rows } = await runInTransaction((client) =>
      client.query(
        `SELECT 1 FROM licenses WHERE account_id = $1 AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > $2) LIMIT 1`,
        [accountId, now],
      ),
    );
    return rows.length > 0;
  }
}
