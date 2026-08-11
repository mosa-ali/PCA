import { execute, isDuplicateEntry, runInTransaction, SoftFailure } from '../db/pool.js';
import { compareVersions, parseVersion } from './version.js';
import type { PublishResult, ReleaseRepository, RetireResult, RollbackResult } from './ReleaseRepository.js';
import type { CurrentPointerRecord, PackageType, Platform, ReleaseRecord } from './types.js';

interface ReleaseRow {
  release_id: string;
  package_type: ReleaseRecord['packageType'];
  platform: ReleaseRecord['platform'];
  version: string;
  artifact_digest: string;
  artifact_size_bytes: string | number; // BIGINT UNSIGNED arrives as string from mysql2 (supportBigNumbers)
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
  is_explicit_rollback: number | boolean;
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
    isExplicitRollback: Boolean(row.is_explicit_rollback),
    updatedAt: row.updated_at,
  };
}

type ReleaseSoftCode = 'CONFLICT';

/**
 * Row-constructor guard shared by every branch of the current-pointer
 * upsert: MySQL supports lexicographic comparison of row constructors
 * (`(a, b, c) > (d, e, f)`), so the "only advance forward" rule is enforced
 * entirely in SQL, in the same INSERT ... ON DUPLICATE KEY UPDATE
 * statement, rather than a SELECT ... FOR UPDATE (which cannot lock a row
 * that doesn't exist yet -- the exact gap PG-CORR-2 fixed on the
 * PostgreSQL side). The `AS new` row alias (MySQL 8.0.19+) is the
 * non-deprecated replacement for the legacy VALUES() function.
 */
const POINTER_ADVANCE_GUARD =
  '(new.version_major, new.version_minor, new.version_patch) > ' +
  '(release_current_pointers.version_major, release_current_pointers.version_minor, release_current_pointers.version_patch)';

export class MySqlReleaseRepository implements ReleaseRepository {
  /**
   * Publish + forward-only current-pointer advancement as ONE transaction.
   *
   * Unlike PostgreSQL, an InnoDB transaction is NOT aborted by an ordinary
   * statement error (e.g. a duplicate-key violation) -- only that one
   * statement fails, and subsequent statements in the same transaction run
   * normally. This is a genuine, independently-verified concurrency
   * difference from the PostgreSQL implementation: no SAVEPOINT/ROLLBACK TO
   * SAVEPOINT dance is required here (PostgreSQL needed one specifically
   * because it aborts the WHOLE transaction after any statement error,
   * 25P02, until an explicit ROLLBACK/SAVEPOINT recovery). The rest of the
   * reconciliation logic is unchanged: release_id is always
   * service-derived from (packageType, platform, version) -- see
   * ReleaseService -- so `release_packages`'s two independent unique
   * constraints (the release_id PRIMARY KEY and the (package_type,
   * platform, version) UNIQUE key) always protect the same logical
   * identity for any request that went through the normal service API.
   * Which constraint InnoDB reports first for a genuine concurrent
   * collision is not deterministic and must not matter -- both cases mean
   * "a row for this identity already exists," so both fall through to the
   * SAME reconcile-against-existing-row logic below, looked up by the
   * NATURAL key (package_type, platform, version), not release_id.
   */
  async publishRelease(record: ReleaseRecord): Promise<PublishResult> {
    try {
      return await runInTransaction(async (conn) => {
        let inserted: ReleaseRow | undefined;
        try {
          await execute(
            conn,
            `INSERT INTO release_packages
               (release_id, package_type, platform, version, artifact_digest, artifact_size_bytes, signing_key_id, signed_metadata, minimum_supported_version, state, published_at, retired_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          const reread = await execute<ReleaseRow>(conn, `SELECT * FROM release_packages WHERE release_id = ?`, [
            record.releaseId,
          ]);
          inserted = reread.rows[0];
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
        }

        if (!inserted) {
          // Reachable either because (package_type, platform, version)
          // already has a row (the ordinary idempotent-resubmission /
          // conflicting-payload case), or because release_id collided
          // against an unrelated release (no row under THIS triple to
          // reconcile against -- see the SoftFailure below).
          const existing = await execute<ReleaseRow>(
            conn,
            `SELECT * FROM release_packages WHERE package_type = ? AND platform = ? AND version = ?`,
            [record.packageType, record.platform, record.version],
          );
          const row = existing.rows[0];
          if (!row) throw new SoftFailure<ReleaseSoftCode>('CONFLICT');
          const matches =
            row.artifact_digest === record.artifactDigest &&
            Number(row.artifact_size_bytes) === record.artifactSizeBytes &&
            row.signing_key_id === record.signingKeyId &&
            row.signed_metadata.equals(record.signedMetadata) &&
            row.minimum_supported_version === record.minimumSupportedVersion;
          if (matches) return { outcome: 'IDEMPOTENT_MATCH', record: mapRelease(row) } as const;
          throw new SoftFailure<ReleaseSoftCode>('CONFLICT');
        }

        const parsedVersion = parseVersion(record.version);
        if (!parsedVersion) throw new Error('release version failed re-validation at the persistence boundary');

        await execute(
          conn,
          `INSERT INTO release_current_pointers
             (package_type, platform, version, version_major, version_minor, version_patch, is_explicit_rollback, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, false, ?) AS new
           ON DUPLICATE KEY UPDATE
             version = IF(${POINTER_ADVANCE_GUARD}, new.version, release_current_pointers.version),
             version_major = IF(${POINTER_ADVANCE_GUARD}, new.version_major, release_current_pointers.version_major),
             version_minor = IF(${POINTER_ADVANCE_GUARD}, new.version_minor, release_current_pointers.version_minor),
             version_patch = IF(${POINTER_ADVANCE_GUARD}, new.version_patch, release_current_pointers.version_patch),
             is_explicit_rollback = IF(${POINTER_ADVANCE_GUARD}, false, release_current_pointers.is_explicit_rollback),
             updated_at = IF(${POINTER_ADVANCE_GUARD}, new.updated_at, release_current_pointers.updated_at)`,
          [
            record.packageType,
            record.platform,
            record.version,
            parsedVersion.major,
            parsedVersion.minor,
            parsedVersion.patch,
            record.publishedAt,
          ],
        );
        return { outcome: 'PUBLISHED', record: mapRelease(inserted) } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: 'CONFLICT' };
      throw error;
    }
  }

  async findRelease(releaseId: string): Promise<ReleaseRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ReleaseRow>(conn, `SELECT * FROM release_packages WHERE release_id = ?`, [releaseId]),
    );
    return rows[0] ? mapRelease(rows[0]) : null;
  }

  async retireRelease(releaseId: string, retiredAt: Date): Promise<RetireResult> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE release_packages SET state = 'RETIRED', retired_at = ?
         WHERE release_id = ? AND state != 'RETIRED'`,
        [retiredAt, releaseId],
      );
      const existing = await execute<ReleaseRow>(conn, `SELECT * FROM release_packages WHERE release_id = ?`, [releaseId]);
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
    return runInTransaction(async (conn) => {
      const pointer = await execute<PointerRow>(
        conn,
        `SELECT * FROM release_current_pointers WHERE package_type = ? AND platform = ?`,
        [packageType, platform],
      );
      if (pointer.rows[0]) {
        const pointed = await execute<ReleaseRow>(
          conn,
          `SELECT * FROM release_packages WHERE package_type = ? AND platform = ? AND version = ? AND state = 'PUBLISHED'`,
          [packageType, platform, pointer.rows[0].version],
        );
        if (pointed.rows[0]) return mapRelease(pointed.rows[0]);
      }

      const candidates = await execute<ReleaseRow>(
        conn,
        `SELECT * FROM release_packages WHERE package_type = ? AND platform = ? AND state = 'PUBLISHED'`,
        [packageType, platform],
      );
      if (candidates.rows.length === 0) return null;
      let best = candidates.rows[0]!;
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
    return runInTransaction(async (conn) => {
      const target = await execute<ReleaseRow>(
        conn,
        `SELECT * FROM release_packages WHERE package_type = ? AND platform = ? AND version = ? FOR UPDATE`,
        [packageType, platform, targetVersion],
      );
      const row = target.rows[0];
      if (!row) return { outcome: 'TARGET_NOT_FOUND' };
      if (row.state !== 'PUBLISHED') return { outcome: 'TARGET_NOT_PUBLISHED' };

      const parsedVersion = parseVersion(targetVersion);
      if (!parsedVersion) throw new Error('rollback target version failed re-validation at the persistence boundary');

      // Explicit rollback always applies, unconditionally -- unlike ordinary
      // publish, there is deliberately no version-tuple guard here.
      await execute(
        conn,
        `INSERT INTO release_current_pointers
           (package_type, platform, version, version_major, version_minor, version_patch, is_explicit_rollback, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, true, ?) AS new
         ON DUPLICATE KEY UPDATE
           version = new.version, version_major = new.version_major, version_minor = new.version_minor,
           version_patch = new.version_patch, is_explicit_rollback = true, updated_at = new.updated_at`,
        [packageType, platform, targetVersion, parsedVersion.major, parsedVersion.minor, parsedVersion.patch, rolledBackAt],
      );
      return {
        outcome: 'ROLLED_BACK',
        pointer: { packageType, platform, version: targetVersion, isExplicitRollback: true, updatedAt: rolledBackAt },
      };
    });
  }
}
