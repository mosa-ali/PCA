import { compareVersions } from '../../dist/release/version.js';

// Deterministic in-memory ReleaseRepository for tests only.
// Never used as a production substitute for the PostgreSQL implementation.
export function createInMemoryReleaseRepository() {
  const releasesById = new Map();
  const pointers = new Map(); // `${packageType}:${platform}` -> CurrentPointerRecord

  function clone(record) {
    return { ...record, signedMetadata: Buffer.from(record.signedMetadata) };
  }

  function pointerKey(packageType, platform) {
    return `${packageType}:${platform}`;
  }

  function matchesExisting(existing, candidate) {
    return (
      existing.artifactDigest === candidate.artifactDigest &&
      existing.artifactSizeBytes === candidate.artifactSizeBytes &&
      existing.signingKeyId === candidate.signingKeyId &&
      existing.signedMetadata.equals(candidate.signedMetadata) &&
      existing.minimumSupportedVersion === candidate.minimumSupportedVersion
    );
  }

  return {
    // No `await` before any mutation below, so each call runs to completion
    // synchronously once invoked.
    async publishRelease(record) {
      const existing = releasesById.get(record.releaseId);
      if (existing) {
        return matchesExisting(existing, record)
          ? { outcome: 'IDEMPOTENT_MATCH', record: clone(existing) }
          : { outcome: 'CONFLICT' };
      }
      const stored = clone(record);
      releasesById.set(record.releaseId, stored);

      // Ordinary publish only ever advances the current pointer forward.
      const key = pointerKey(record.packageType, record.platform);
      const pointer = pointers.get(key);
      if (!pointer || compareVersions(record.version, pointer.version) > 0) {
        pointers.set(key, {
          packageType: record.packageType,
          platform: record.platform,
          version: record.version,
          isExplicitRollback: false,
          updatedAt: record.publishedAt,
        });
      }
      return { outcome: 'PUBLISHED', record: clone(stored) };
    },

    async findRelease(releaseId) {
      const record = releasesById.get(releaseId);
      return record ? clone(record) : null;
    },

    async retireRelease(releaseId, retiredAt) {
      const record = releasesById.get(releaseId);
      if (!record) return { outcome: 'NOT_FOUND' };
      if (record.state !== 'RETIRED') {
        record.state = 'RETIRED';
        record.retiredAt = retiredAt;
      }
      return { outcome: 'RETIRED', record: clone(record) };
    },

    async getCurrentRelease(packageType, platform) {
      const key = pointerKey(packageType, platform);
      const pointer = pointers.get(key);
      if (pointer) {
        const pointed = releasesById.get(`${packageType}:${platform}:${pointer.version}`);
        if (pointed && pointed.state === 'PUBLISHED') return clone(pointed);
      }
      // Stale/missing pointer (e.g. the pointed release was retired): fall
      // back to the highest-version PUBLISHED release for this package/platform.
      let best = null;
      for (const record of releasesById.values()) {
        if (record.packageType !== packageType || record.platform !== platform || record.state !== 'PUBLISHED') continue;
        if (!best || compareVersions(record.version, best.version) > 0) best = record;
      }
      return best ? clone(best) : null;
    },

    async rollbackToRelease(packageType, platform, targetVersion, rolledBackAt) {
      const targetId = `${packageType}:${platform}:${targetVersion}`;
      const target = releasesById.get(targetId);
      if (!target) return { outcome: 'TARGET_NOT_FOUND' };
      if (target.state !== 'PUBLISHED') return { outcome: 'TARGET_NOT_PUBLISHED' };
      const pointer = {
        packageType,
        platform,
        version: targetVersion,
        isExplicitRollback: true,
        updatedAt: rolledBackAt,
      };
      pointers.set(pointerKey(packageType, platform), pointer);
      return { outcome: 'ROLLED_BACK', pointer: { ...pointer } };
    },
  };
}
