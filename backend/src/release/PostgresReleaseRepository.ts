import { isUniqueViolation, runInTransaction, SoftFailure } from '../db/pool.js';
import { compareVersions } from './version.js';
import type { PublishResult, ReleaseRepository, RetireResult, RollbackResult } from './ReleaseRepository.js';
import type { CurrentPointerRecord, PackageType, Platform, ReleaseRecord } from './types.js';

interface ReleaseRow {
  release_id: string;
  package_type: ReleaseRecord['packageType'];
  platform: ReleaseRecord['platform'];
  version: string;
  artifact_digest: string;
  artifact_size_bytes: string; // BIGINT arrives as string from node-postgres
  signing_key_id: string;
  signed_metadata: Buffer;
  minimum_supported_version: string | null;
  state: ReleaseRecord['state'];
  published_at: Date;
  retired_at: Date | null;
}

interface PointerRow {
  package_type: PackageType;
  platform: Platform;
  version: string;
  is_explicit_rollback: boolean;
  updated_at: Date;
}

function mapRelease(row: ReleaseRow): ReleaseRecord {
  return {
    releaseId: row.release_id,
    packageType: row.package_type,
    platform: row.platform,
    version: row.version,
    artifactDigest: row.artifact_digest,
    artifactSizeBytes: Number(row.artifact_size_bytes),
    signingKeyId: row.signing_key_id,
    signedMetadata: row.signed_metadata,
    minimumSupportedVersion: row.minimum_supported_version,
    state: row.state,
    publishedAt: row.published_at,
    retiredAt: row.retired_at,
  };
}

function mapPointer(row: PointerRow): CurrentPointerRecord {
  return {
    packageType: row.package_type,
    platform: row.platform,
    version: row.version,
    isExplicitRollback: row.is_explicit_rollback,
    updatedAt: row.updated_at,
  };
}

type ReleaseSoftCode = 'CONFLICT';

export class PostgresReleaseRepository implements ReleaseRepository {
  /**
   * Publish + forward-only current-pointer advancement as ONE transaction.
   * The pointer row is locked (FOR UPDATE) before being compared, so two
   * concurrent publishes for the same package/platform cannot both observe
   * a stale pointer and race to set it.
   */
  async publishRelease(record: ReleaseRecord): Promise<PublishResult> {
    try {
      return await runInTransaction(async (client) => {
        let inserted;
        try {
          inserted = await client.query<ReleaseRow>(
            `INSERT INTO release_packages
               (release_id, package_type, platform, version, artifact_digest, artifact_size_bytes, signing_key_id, signed_metadata, minimum_supported_version, state, published_at, retired_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (release_id) DO NOTHING
             RETURNING *`,
            [
              record.releaseId,
              record.packageType,
              record.platform,
              record.version,
              record.artifactDigest,
              record.artifactSizeBytes,
              record.signingKeyId,
              record.signedMetadata,
              record.minimumSupportedVersion,
              record.state,
              record.publishedAt,
              record.retiredAt,
            ],
          );
        } catch (error) {
          // release_id is always service-derived from (packageType, platform,
          // version), so this constraint cannot fire through the normal
          // service API -- but a direct repository caller with a mismatched
          // releaseId must still get a typed CONFLICT, never a raw DB error.
          if (isUniqueViolation(error)) throw new SoftFailure<ReleaseSoftCode>('CONFLICT');
          throw error;
        }

        if (!inserted.rows[0]) {
          const existing = await client.query<ReleaseRow>(`SELECT * FROM release_packages WHERE release_id = $1`, [
            record.releaseId,
          ]);
          const row = existing.rows[0];
          if (!row) throw new Error('release insert conflicted but no existing row was found');
          const matches =
            row.artifact_digest === record.artifactDigest &&
            Number(row.artifact_size_bytes) === record.artifactSizeBytes &&
            row.signing_key_id === record.signingKeyId &&
            row.signed_metadata.equals(record.signedMetadata) &&
            row.minimum_supported_version === record.minimumSupportedVersion;
          if (matches) return { outcome: 'IDEMPOTENT_MATCH', record: mapRelease(row) } as const;
          throw new SoftFailure<ReleaseSoftCode>('CONFLICT');
        }

        const pointer = await client.query<PointerRow>(
          `SELECT * FROM release_current_pointers WHERE package_type = $1 AND platform = $2 FOR UPDATE`,
          [record.packageType, record.platform],
        );
        const currentVersion = pointer.rows[0]?.version;
        if (!currentVersion || compareVersions(record.version, currentVersion) > 0) {
          await client.query(
            `INSERT INTO release_current_pointers (package_type, platform, version, is_explicit_rollback, updated_at)
             VALUES ($1, $2, $3, false, $4)
             ON CONFLICT (package_type, platform)
             DO UPDATE SET version = EXCLUDED.version, is_explicit_rollback = false, updated_at = EXCLUDED.updated_at`,
            [record.packageType, record.platform, record.version, record.publishedAt],
          );
        }
        return { outcome: 'PUBLISHED', record: mapRelease(inserted.rows[0]) } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: 'CONFLICT' };
      throw error;
    }
  }

  async findRelease(releaseId: string): Promise<ReleaseRecord | null> {
    const { rows } = await runInTransaction((client) =>
      client.query<ReleaseRow>(`SELECT * FROM release_packages WHERE release_id = $1`, [releaseId]),
    );
    return rows[0] ? mapRelease(rows[0]) : null;
  }

  async retireRelease(releaseId: string, retiredAt: Date): Promise<RetireResult> {
    return runInTransaction(async (client) => {
      const updated = await client.query<ReleaseRow>(
        `UPDATE release_packages SET state = 'RETIRED', retired_at = $2
         WHERE release_id = $1 AND state != 'RETIRED'
         RETURNING *`,
        [releaseId, retiredAt],
      );
      if (updated.rows[0]) return { outcome: 'RETIRED', record: mapRelease(updated.rows[0]) };
      const existing = await client.query<ReleaseRow>(`SELECT * FROM release_packages WHERE release_id = $1`, [
        releaseId,
      ]);
      if (!existing.rows[0]) return { outcome: 'NOT_FOUND' };
      return { outcome: 'RETIRED', record: mapRelease(existing.rows[0]) };
    });
  }

  /**
   * Never "ORDER BY version" as text -- fetches candidate PUBLISHED rows
   * and reduces with the same numeric compareVersions the domain layer
   * uses everywhere else, so DB-side "current" selection can never disagree
   * with the in-memory implementation's ordering.
   */
  async getCurrentRelease(packageType: PackageType, platform: Platform): Promise<ReleaseRecord | null> {
    return runInTransaction(async (client) => {
      const pointer = await client.query<PointerRow>(
        `SELECT * FROM release_current_pointers WHERE package_type = $1 AND platform = $2`,
        [packageType, platform],
      );
      if (pointer.rows[0]) {
        const pointed = await client.query<ReleaseRow>(
          `SELECT * FROM release_packages WHERE package_type = $1 AND platform = $2 AND version = $3 AND state = 'PUBLISHED'`,
          [packageType, platform, pointer.rows[0].version],
        );
        if (pointed.rows[0]) return mapRelease(pointed.rows[0]);
      }

      const candidates = await client.query<ReleaseRow>(
        `SELECT * FROM release_packages WHERE package_type = $1 AND platform = $2 AND state = 'PUBLISHED'`,
        [packageType, platform],
      );
      if (candidates.rows.length === 0) return null;
      let best = candidates.rows[0];
      for (const row of candidates.rows.slice(1)) {
        if (compareVersions(row.version, best.version) > 0) best = row;
      }
      return mapRelease(best);
    });
  }

  async rollbackToRelease(
    packageType: PackageType,
    platform: Platform,
    targetVersion: string,
    rolledBackAt: Date,
  ): Promise<RollbackResult> {
    return runInTransaction(async (client) => {
      const target = await client.query<ReleaseRow>(
        `SELECT * FROM release_packages WHERE package_type = $1 AND platform = $2 AND version = $3 FOR UPDATE`,
        [packageType, platform, targetVersion],
      );
      const row = target.rows[0];
      if (!row) return { outcome: 'TARGET_NOT_FOUND' };
      if (row.state !== 'PUBLISHED') return { outcome: 'TARGET_NOT_PUBLISHED' };

      await client.query(
        `INSERT INTO release_current_pointers (package_type, platform, version, is_explicit_rollback, updated_at)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (package_type, platform)
         DO UPDATE SET version = EXCLUDED.version, is_explicit_rollback = true, updated_at = EXCLUDED.updated_at`,
        [packageType, platform, targetVersion, rolledBackAt],
      );
      return {
        outcome: 'ROLLED_BACK',
        pointer: { packageType, platform, version: targetVersion, isExplicitRollback: true, updatedAt: rolledBackAt },
      };
    });
  }
}
