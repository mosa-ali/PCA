export type PackageType = 'ANDROID_APP' | 'IOS_APP' | 'MODEL_PACKAGE' | 'RULE_PACKAGE';
export type Platform = 'ANDROID' | 'IOS' | 'SHARED';
export type RolloutState = 'PUBLISHED' | 'RETIRED';

/**
 * Product/release metadata only. This record must never gain a field for
 * family/child data (familyId, childId, location, usage, policy, Admin PIN,
 * enrollment token, recovery secret, family keys) -- see architecture docs
 * 09/11/17. The release service distributes signed metadata; it is not the
 * trust authority. Clients independently verify signature, trusted signing
 * key, artifact digest, and compatibility before accepting any package.
 */
export interface ReleaseRecord {
  /** Deterministic identity: `${packageType}:${platform}:${version}`. */
  releaseId: string;
  packageType: PackageType;
  platform: Platform;
  version: string;
  artifactDigest: string; // canonical lowercase 64-char SHA-256 hex
  artifactSizeBytes: number;
  signingKeyId: string;
  /** Opaque, externally produced signed metadata blob -- never generated or verified here. */
  signedMetadata: Buffer;
  minimumSupportedVersion: string | null;
  state: RolloutState;
  publishedAt: Date;
  retiredAt: Date | null;
}

/** Tracks which release is "current" for a package/platform, independent of publish order. */
export interface CurrentPointerRecord {
  packageType: PackageType;
  platform: Platform;
  version: string;
  isExplicitRollback: boolean;
  updatedAt: Date;
}
