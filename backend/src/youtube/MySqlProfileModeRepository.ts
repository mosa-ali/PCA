import { execute, runInTransaction } from '../db/pool.js';
import type { ProfileModeRepository } from './ModeTransitionService.js';
import type { OpaqueFamilyId, OpaqueProfileId, YouTubeMode } from './types.js';

interface ModeRow {
  mode: YouTubeMode;
}

/**
 * PCA-DW-W3-D -- durable, MySQL-backed ProfileModeRepository (migration
 * 0039_profile_protection_mode.sql), the drop-in replacement for
 * InMemoryProfileModeRepository. This repository IS production-reachable
 * (main.ts wires it into YouTubeDashboardCardProvider, a real
 * parent-dashboard surface) -- losing this state on every backend restart
 * silently reverted every profile to Mode A (the less-restricted default)
 * with no parent notification, a real functional safety-feature
 * regression a parent would not expect.
 *
 * Same cross-family-safe-default shape as
 * eyeprotection/MySqlEyeProtectionSettingsRepository.ts (FABLE-A008): `get`
 * filters `AND family_id = ?` on the CALLER's own familyId, so a
 * caller-supplied profileId belonging to a different family (or one that
 * doesn't exist at all) matches zero rows either way and falls through to
 * the identical safe default ('A') -- no cross-family read, no existence
 * oracle. `put` upserts keyed by profileId; family_id is written on first
 * insert only (a profileId never legitimately migrates between families
 * through this table) -- authorization against the CALLER's own family
 * happens upstream, before this repository is ever reached, exactly as
 * the eye-protection precedent's own doc comment documents for its
 * equivalent write path.
 */
export class MySqlProfileModeRepository implements ProfileModeRepository {
  async get(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<YouTubeMode> {
    const { rows } = await runInTransaction((conn) =>
      execute<ModeRow>(conn, `SELECT mode FROM profile_protection_mode WHERE profile_id = ? AND family_id = ?`, [profileId, familyId]),
    );
    return rows[0]?.mode ?? 'A';
  }

  async put(familyId: OpaqueFamilyId, profileId: OpaqueProfileId, mode: YouTubeMode): Promise<void> {
    const now = new Date();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO profile_protection_mode (profile_id, family_id, mode, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mode = ?, updated_at = ?`,
        [profileId, familyId, mode, now, mode, now],
      ),
    );
  }
}
