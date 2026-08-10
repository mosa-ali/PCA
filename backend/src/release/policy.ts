export const MAX_KEY_ID_LENGTH = 128;
export const MAX_SIGNED_METADATA_BYTES = 32 * 1024; // 32 KiB -- signed metadata, not the artifact itself
export const MIN_SIGNED_METADATA_BYTES = 1;
export const MAX_ARTIFACT_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB ceiling, sanity bound on a numeric field
export const MIN_ARTIFACT_SIZE_BYTES = 1;

const ARTIFACT_DIGEST_SHAPE = /^[0-9a-f]{64}$/; // canonical lowercase SHA-256 hex only

const PACKAGE_TYPES = new Set(['ANDROID_APP', 'IOS_APP', 'MODEL_PACKAGE', 'RULE_PACKAGE']);
const PLATFORMS = new Set(['ANDROID', 'IOS', 'SHARED']);

// Application packages are always platform-specific; model/rule packages may be platform-scoped or shared.
const VALID_COMBINATIONS = new Map([
  ['ANDROID_APP', new Set(['ANDROID'])],
  ['IOS_APP', new Set(['IOS'])],
  ['MODEL_PACKAGE', new Set(['ANDROID', 'IOS', 'SHARED'])],
  ['RULE_PACKAGE', new Set(['ANDROID', 'IOS', 'SHARED'])],
]);

export function isValidPackageType(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && PACKAGE_TYPES.has(candidate);
}

export function isValidPlatform(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && PLATFORMS.has(candidate);
}

export function isValidPackagePlatformCombination(packageType: string, platform: string): boolean {
  return VALID_COMBINATIONS.get(packageType)?.has(platform) ?? false;
}

export function isValidArtifactDigest(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && ARTIFACT_DIGEST_SHAPE.test(candidate);
}

export function isValidArtifactSize(candidate: unknown): candidate is number {
  return (
    typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate >= MIN_ARTIFACT_SIZE_BYTES &&
    candidate <= MAX_ARTIFACT_SIZE_BYTES
  );
}

export function isPlausibleKeyId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_KEY_ID_LENGTH;
}

export function isPlausibleSignedMetadata(candidate: unknown): candidate is Buffer {
  return (
    Buffer.isBuffer(candidate) &&
    candidate.length >= MIN_SIGNED_METADATA_BYTES &&
    candidate.length <= MAX_SIGNED_METADATA_BYTES
  );
}
