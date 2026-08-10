import {
  isPlausibleKeyId,
  isPlausibleSignedMetadata,
  isValidArtifactDigest,
  isValidArtifactSize,
  isValidPackagePlatformCombination,
  isValidPackageType,
  isValidPlatform,
} from './policy.js';
import { isValidVersion } from './version.js';
import type { PublishResult, ReleaseRepository, RollbackResult } from './ReleaseRepository.js';
import type { CurrentPointerRecord, PackageType, Platform, ReleaseRecord } from './types.js';

export type ReleaseErrorCode =
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'ROLLBACK_TARGET_NOT_FOUND'
  | 'ROLLBACK_TARGET_NOT_PUBLISHED';

/** Fixed, generic messages per code -- never interpolates a caller-supplied blob. */
export class ReleaseError extends Error {
  readonly code: ReleaseErrorCode;
  constructor(code: ReleaseErrorCode) {
    super(RELEASE_ERROR_MESSAGES[code]);
    this.name = 'ReleaseError';
    this.code = code;
  }
}

const RELEASE_ERROR_MESSAGES: Record<ReleaseErrorCode, string> = {
  INVALID_INPUT: 'Release metadata input is malformed.',
  CONFLICT: 'A different release is already published under this package/version identity.',
  NOT_FOUND: 'Release was not found.',
  ROLLBACK_TARGET_NOT_FOUND: 'Rollback target release was not found.',
  ROLLBACK_TARGET_NOT_PUBLISHED: 'Rollback target release is not in a published state.',
};

const MAX_RELEASE_ID_LENGTH = 256;

export interface PublishReleaseInput {
  packageType: PackageType;
  platform: Platform;
  version: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  signingKeyId: string;
  /** Opaque, externally produced signed metadata blob. This service never generates or verifies signatures. */
  signedMetadata: Buffer;
  minimumSupportedVersion?: string | null;
}

export class ReleaseService {
  private readonly repository: ReleaseRepository;
  private readonly now: () => Date;

  constructor(repository: ReleaseRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  /**
   * Records externally signed release metadata. This service does not
   * generate, hold, or verify signing keys -- `signedMetadata` is treated
   * as an opaque blob produced by a separately controlled release process.
   * Serving this metadata is not itself a trust decision: clients must
   * independently verify signature, signing key trust, and digest before
   * accepting any package.
   */
  async publishRelease(input: PublishReleaseInput): Promise<ReleaseRecord> {
    if (!isValidPackageType(input.packageType) || !isValidPlatform(input.platform)) {
      throw new ReleaseError('INVALID_INPUT');
    }
    if (!isValidPackagePlatformCombination(input.packageType, input.platform)) {
      throw new ReleaseError('INVALID_INPUT');
    }
    if (!isValidVersion(input.version)) throw new ReleaseError('INVALID_INPUT');
    if (!isValidArtifactDigest(input.artifactDigest)) throw new ReleaseError('INVALID_INPUT');
    if (!isValidArtifactSize(input.artifactSizeBytes)) throw new ReleaseError('INVALID_INPUT');
    if (!isPlausibleKeyId(input.signingKeyId)) throw new ReleaseError('INVALID_INPUT');
    if (!isPlausibleSignedMetadata(input.signedMetadata)) throw new ReleaseError('INVALID_INPUT');
    const minimumSupportedVersion = input.minimumSupportedVersion ?? null;
    if (minimumSupportedVersion !== null && !isValidVersion(minimumSupportedVersion)) {
      throw new ReleaseError('INVALID_INPUT');
    }

    const record: ReleaseRecord = {
      releaseId: `${input.packageType}:${input.platform}:${input.version}`,
      packageType: input.packageType,
      platform: input.platform,
      version: input.version,
      artifactDigest: input.artifactDigest,
      artifactSizeBytes: input.artifactSizeBytes,
      signingKeyId: input.signingKeyId,
      signedMetadata: input.signedMetadata,
      minimumSupportedVersion,
      state: 'PUBLISHED',
      publishedAt: this.now(),
      retiredAt: null,
    };

    const result: PublishResult = await this.repository.publishRelease(record);
    if (result.outcome === 'CONFLICT') throw new ReleaseError('CONFLICT');
    return result.record;
  }

  async findRelease(releaseId: string): Promise<ReleaseRecord> {
    if (!isPlausibleReleaseId(releaseId)) throw new ReleaseError('INVALID_INPUT');
    const record = await this.repository.findRelease(releaseId);
    if (!record) throw new ReleaseError('NOT_FOUND');
    return record;
  }

  async retireRelease(releaseId: string): Promise<ReleaseRecord> {
    if (!isPlausibleReleaseId(releaseId)) throw new ReleaseError('INVALID_INPUT');
    const result = await this.repository.retireRelease(releaseId, this.now());
    if (result.outcome === 'NOT_FOUND') throw new ReleaseError('NOT_FOUND');
    return result.record;
  }

  async getCurrentRelease(packageType: PackageType, platform: Platform): Promise<ReleaseRecord> {
    if (!isValidPackageType(packageType) || !isValidPlatform(platform)) throw new ReleaseError('INVALID_INPUT');
    const record = await this.repository.getCurrentRelease(packageType, platform);
    if (!record) throw new ReleaseError('NOT_FOUND');
    return record;
  }

  /**
   * The ONLY way a current pointer can move to a lower version than what
   * ordinary publication already advanced it to. Distinct from publish:
   * requires the target to already exist as a PUBLISHED release.
   */
  async rollbackToRelease(packageType: PackageType, platform: Platform, targetVersion: string): Promise<CurrentPointerRecord> {
    if (!isValidPackageType(packageType) || !isValidPlatform(platform)) throw new ReleaseError('INVALID_INPUT');
    if (!isValidVersion(targetVersion)) throw new ReleaseError('INVALID_INPUT');
    const result: RollbackResult = await this.repository.rollbackToRelease(
      packageType,
      platform,
      targetVersion,
      this.now(),
    );
    switch (result.outcome) {
      case 'ROLLED_BACK':
        return result.pointer;
      case 'TARGET_NOT_FOUND':
        throw new ReleaseError('ROLLBACK_TARGET_NOT_FOUND');
      case 'TARGET_NOT_PUBLISHED':
        throw new ReleaseError('ROLLBACK_TARGET_NOT_PUBLISHED');
    }
  }
}

function isPlausibleReleaseId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_RELEASE_ID_LENGTH;
}
