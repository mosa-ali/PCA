import { execute, runInTransaction } from '../db/pool.js';
import type { FamilyRbacPolicyConfig } from './types.js';
import { defaultFamilyRbacPolicyConfig } from './types.js';

export interface FamilyRbacPolicyConfigRepository {
  getForFamily(familyId: string): Promise<FamilyRbacPolicyConfig | null>;
  setForFamily(familyId: string, config: FamilyRbacPolicyConfig, now: Date): Promise<void>;
}

interface FamilyRbacPolicyConfigRow {
  administrator_can_manage_viewers: number;
  administrator_can_revoke_device_or_disable_protection: number;
}

export class MySqlFamilyRbacPolicyConfigRepository implements FamilyRbacPolicyConfigRepository {
  async getForFamily(familyId: string): Promise<FamilyRbacPolicyConfig | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyRbacPolicyConfigRow>(
        conn,
        `SELECT administrator_can_manage_viewers, administrator_can_revoke_device_or_disable_protection
         FROM family_rbac_policy_config WHERE family_id = ?`,
        [familyId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      administratorCanManageViewers: row.administrator_can_manage_viewers === 1,
      administratorCanRevokeDeviceOrDisableProtection: row.administrator_can_revoke_device_or_disable_protection === 1,
    };
  }

  async setForFamily(familyId: string, config: FamilyRbacPolicyConfig, now: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO family_rbac_policy_config
           (family_id, administrator_can_manage_viewers, administrator_can_revoke_device_or_disable_protection, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           administrator_can_manage_viewers = VALUES(administrator_can_manage_viewers),
           administrator_can_revoke_device_or_disable_protection = VALUES(administrator_can_revoke_device_or_disable_protection),
           updated_at = VALUES(updated_at)`,
        [
          familyId,
          config.administratorCanManageViewers ? 1 : 0,
          config.administratorCanRevokeDeviceOrDisableProtection ? 1 : 0,
          now,
        ],
      ),
    );
  }
}

/**
 * Bridges the durable, async FamilyRbacPolicyConfigRepository to
 * ParentActionAuthorizationService's synchronous `configProvider(familyId)`
 * contract. authorize() is a synchronous, ADVISORY pre-check only (see its
 * own doc comment: true authority is the receiving device's own
 * signed-envelope verification, never this service or any server ACL) --
 * reading a possibly-stale cached snapshot here is an acceptable,
 * deliberate tradeoff for that reason, exactly like
 * TrustSetRoleResolver.resolveActor's own synchronous contract already
 * assumes a pre-loaded, in-memory-backed source rather than a live
 * per-call DB round trip. A caller that needs a guaranteed-fresh read
 * (e.g. immediately after an Owner changes this setting) should call
 * loadFamily()/setForFamily() directly rather than relying on
 * snapshotFor() alone.
 */
export class FamilyRbacPolicyConfigStore {
  private readonly repository: FamilyRbacPolicyConfigRepository;
  private readonly cache = new Map<string, FamilyRbacPolicyConfig>();

  constructor(repository: FamilyRbacPolicyConfigRepository) {
    this.repository = repository;
  }

  /** Synchronous read for ParentActionAuthorizationService's configProvider. Returns the safe global default for any family not yet loaded into the cache. */
  snapshotFor = (familyId: string): FamilyRbacPolicyConfig => {
    return this.cache.get(familyId) ?? defaultFamilyRbacPolicyConfig();
  };

  /** Populates/refreshes the in-memory snapshot for one family from durable storage. */
  async loadFamily(familyId: string): Promise<FamilyRbacPolicyConfig> {
    const stored = await this.repository.getForFamily(familyId);
    const resolved = stored ?? defaultFamilyRbacPolicyConfig();
    this.cache.set(familyId, resolved);
    return resolved;
  }

  /** Durable write-through: persists first, then updates the cache so a subsequent snapshotFor() reflects it immediately without a separate reload. */
  async setForFamily(familyId: string, config: FamilyRbacPolicyConfig, now: Date): Promise<void> {
    await this.repository.setForFamily(familyId, config, now);
    this.cache.set(familyId, config);
  }
}
