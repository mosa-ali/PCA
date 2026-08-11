import type { CurrentPointerRecord, PackageType, Platform, ReleaseRecord } from './types.js';

export type PublishResult =
  | { outcome: 'PUBLISHED'; record: ReleaseRecord }
  | { outcome: 'IDEMPOTENT_MATCH'; record: ReleaseRecord }
  | { outcome: 'CONFLICT' };

export type RetireResult = { outcome: 'RETIRED'; record: ReleaseRecord } | { outcome: 'NOT_FOUND' };

export type RollbackResult =
  | { outcome: 'ROLLED_BACK'; pointer: CurrentPointerRecord }
  | { outcome: 'TARGET_NOT_FOUND' }
  | { outcome: 'TARGET_NOT_PUBLISHED' };

/**
 * Persistence port for release metadata. A deterministic in-memory
 * implementation exists for tests; MySqlReleaseRepository is the production
 * implementation.
 *
 * Identity is the (packageType, platform, version) tuple (releaseId).
 * publishRelease is idempotent for a byte-identical resubmission and a
 * CONFLICT for any other field changing under the same identity -- release
 * identity is never silently overwritten.
 *
 * "Current" selection for a (packageType, platform) is never simply "the
 * last row written": an ordinary publish only ever advances the current
 * pointer forward (by version) and never overwrites it with an older
 * version. Moving the pointer backward is possible ONLY through
 * rollbackToRelease, a distinct, explicit operation.
 */
export interface ReleaseRepository {
  publishRelease(record: ReleaseRecord): Promise<PublishResult>;
  findRelease(releaseId: string): Promise<ReleaseRecord | null>;
  retireRelease(releaseId: string, retiredAt: Date): Promise<RetireResult>;
  getCurrentRelease(packageType: PackageType, platform: Platform): Promise<ReleaseRecord | null>;
  rollbackToRelease(
    packageType: PackageType,
    platform: Platform,
    targetVersion: string,
    rolledBackAt: Date,
  ): Promise<RollbackResult>;
}
