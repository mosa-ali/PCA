import { isUniqueViolation, runInTransaction, SoftFailure } from '../db/pool.js';
import { compareVersions, parseVersion } from './version.js';
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
   * The pointer advance is a single atomic UPSERT with an integer-tuple
   * comparison in its WHERE clause (see below) rather than a SELECT ...
   * FOR UPDATE, which cannot lock a row that doesn't exist yet.
   */
  async publishRelease(record: ReleaseRecord): Promise<PublishResult> {
    try {
      return await runInTransaction(async (client) => {
        // release_id is always service-derived from (packageType, platform,
        // version) -- see ReleaseService -- so `release_packages`'s two
        // independent unique constraints (the release_id PRIMARY KEY and
        // UNIQUE(package_type, platform, version)) always protect the
        // exact same logical identity for any request that went through
        // the normal service API. Under genuine concurrency, Postgres may
        // detect a collision via EITHER constraint first -- which one
        // "wins the race" on a given connection is not deterministic and
        // must not matter: both cases mean "a row for this identity
        // already exists," so both fall through to the SAME
        // reconcile-against-existing-row logic below. Previously only the
        // `ON CONFLICT (release_id) DO NOTHING` path (a collision caught
        // BEFORE the statement raises an error) reached that logic; a
        // collision the OTHER constraint caught first raised a raw
        // 23505 that a narrower catch turned directly into CONFLICT,
        // skipping the idempotent-match comparison entirely and producing
        // a spurious CONFLICT for a byte-identical concurrent publish.
        // A SAVEPOINT is required here, not just a try/catch: once any
        // statement inside a transaction errors, Postgres aborts the
        // WHOLE transaction and rejects every subsequent statement with
        // 25P02 ("current transaction is aborted") until a ROLLBACK. The
        // reconcile-against-existing-row SELECT below runs in this same
        // outer transaction, so without rolling back to a savepoint
        // first, catching the unique_violation and continuing would
        // itself throw 25P02 on the very next query.
        let inserted;
        await client.query('SAVEPOINT publish_attempt');
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
          await client.query('RELEASE SAVEPOINT publish_attempt');
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          await client.query('ROLLBACK TO SAVEPOINT publish_attempt');
          inserted = { rows: [] as ReleaseRow[] };
        }

        if (!inserted.rows[0]) {
          // Looked up by the NATURAL key (package_type, platform, version),
          // not release_id: that is the identity the collision is actually
          // guaranteed to be about, regardless of which of the two unique
          // constraints fired. release_id is always service-derived from
          // this same triple, so this also finds the right row for the
          // normal (release_id-matches-the-triple) case -- but unlike a
          // release_id lookup, it still finds the colliding row even for a
          // direct repository caller that (incorrectly) supplied a
          // mismatched release_id, which must still resolve to a typed
          // CONFLICT/IDEMPOTENT_MATCH, never a raw, unhandled Error.
          const existing = await client.query<ReleaseRow>(
            `SELECT * FROM release_packages WHERE package_type = $1 AND platform = $2 AND version = $3`,
            [record.packageType, record.platform, record.version],
          );
          const row = existing.rows[0];
          // Reachable only when the INSERT's unique_violation fired on the
          // release_id constraint against an EXISTING row for a DIFFERENT
          // (package_type, platform, version) triple -- i.e. a direct
          // repository caller supplied a release_id that collides with an
          // unrelated release. There is no row under THIS triple to
          // reconcile against; the requested identity's release_id is
          // simply already taken by something else. That is itself a
          // conflict, not an internal invariant violation -- it must
          // still surface as a typed CONFLICT, never a raw, unhandled Error.
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

        // Single atomic UPSERT: the WHERE clause on the DO UPDATE compares
        // the new version against the existing pointer's version as an
        // integer tuple, entirely in SQL. This replaces a SELECT ... FOR
        // UPDATE, which cannot lock a row that does not exist yet -- the
        // gap that let concurrent *first* publishes for the same
        // package/platform race non-deterministically. INSERT ON CONFLICT
        // is itself atomic per target row, so concurrent upserts serialize
        // regardless of whether the pointer already existed.
        await client.query(
          `INSERT INTO release_current_pointers
             (package_type, platform, version, version_major, version_minor, version_patch, is_explicit_rollback, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, false, $7)
           ON CONFLICT (package_type, platform) DO UPDATE
           SET version = EXCLUDED.version,
               version_major = EXCLUDED.version_major,
               version_minor = EXCLUDED.version_minor,
               version_patch = EXCLUDED.version_patch,
               is_explicit_rollback = false,
               updated_at = EXCLUDED.updated_at
           WHERE (release_current_pointers.version_major, release_current_pointers.version_minor, release_current_pointers.version_patch)
                 < (EXCLUDED.version_major, EXCLUDED.version_minor, EXCLUDED.version_patch)`,
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

      const parsedVersion = parseVersion(targetVersion);
      if (!parsedVersion) throw new Error('rollback target version failed re-validation at the persistence boundary');

      // Explicit rollback always applies, unconditionally -- unlike ordinary
      // publish, there is deliberately no version-tuple WHERE guard here.
      await client.query(
        `INSERT INTO release_current_pointers
           (package_type, platform, version, version_major, version_minor, version_patch, is_explicit_rollback, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         ON CONFLICT (package_type, platform)
         DO UPDATE SET version = EXCLUDED.version, version_major = EXCLUDED.version_major,
           version_minor = EXCLUDED.version_minor, version_patch = EXCLUDED.version_patch,
           is_explicit_rollback = true, updated_at = EXCLUDED.updated_at`,
        [packageType, platform, targetVersion, parsedVersion.major, parsedVersion.minor, parsedVersion.patch, rolledBackAt],
      );
      return {
        outcome: 'ROLLED_BACK',
        pointer: { packageType, platform, version: targetVersion, isExplicitRollback: true, updatedAt: rolledBackAt },
      };
    });
  }
}
