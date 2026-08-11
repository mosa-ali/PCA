import type {
  ClassificationInputSurface,
  DeviceRuntimeCapability,
  ModelLifecycleState,
  ModelPackageMetadata,
  PackageVerificationFailureReason,
} from './types.js';

export const MAX_MODEL_ID_LENGTH = 128;
export const MAX_LOCALE_LENGTH = 32;
export const MAX_LOCALES = 32;
export const MAX_REF_LENGTH = 512; // bounds an opaque evidence-document pointer, never the evidence itself
export const MAX_PROHIBITED_USES = 32;
export const MAX_PROHIBITED_USE_LENGTH = 256;
export const MAX_TARGET_LABELS = 32;
export const MAX_LATENCY_MS = 60_000;
export const MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB ceiling -- sanity bound, not a device promise

const PERMITTED_SURFACES: ReadonlySet<ClassificationInputSurface> = new Set([
  'SAFE_BROWSER_CATEGORY_RISK_SCORING',
  'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL',
  'EYE_DISTANCE_CALIBRATION',
]);

export function isPermittedInputSurface(candidate: unknown): candidate is ClassificationInputSurface {
  return typeof candidate === 'string' && PERMITTED_SURFACES.has(candidate as ClassificationInputSurface);
}

/**
 * doc 23 Section 1: prohibited terms this module scans a package's OWN
 * declared purpose/prohibited-uses text for, as a structural belt-and-
 * suspenders check on top of the inScopeInputSurfaces allow-list --
 * catches a package that names a prohibited use case in free text even if
 * its surfaces field is otherwise well-formed. Case-insensitive substring
 * match; deliberately conservative (a false positive here just means
 * REJECTED, which is the safe direction).
 */
const PROHIBITED_USE_PATTERN =
  /face.?identity|biometric.?template|emotion.?inference|personality.?inference|child.?profiling|background.?capture|covert|surveillance/i;

export function declaresProhibitedUse(metadata: Pick<ModelPackageMetadata, 'purpose' | 'prohibitedUses'>): boolean {
  if (PROHIBITED_USE_PATTERN.test(metadata.purpose)) return true;
  return metadata.prohibitedUses.some((use) => PROHIBITED_USE_PATTERN.test(use));
}

// Lane brief Section 34: "path traversal/package identifier injection." A modelId is used as a lookup key
// (and, in a real implementation, likely a filesystem/cache key for the downloaded artifact) -- it must
// never contain a path separator, a parent-directory segment, or a NUL byte, regardless of length.
const MODEL_ID_SHAPE = /^[A-Za-z0-9._-]+$/;

export function isPlausibleModelId(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > MAX_MODEL_ID_LENGTH) return false;
  if (!MODEL_ID_SHAPE.test(candidate)) return false;
  if (candidate.includes('..')) return false;
  return true;
}

export function isPlausibleRef(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_REF_LENGTH;
}

export function isPlausibleRolloutPercentage(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100;
}

/**
 * Structural plausibility of the metadata shape only -- this is NOT the
 * cryptographic/self-test/runtime verification gate (see
 * PackageVerificationGate.ts); it is the cheap, pre-crypto rejection layer
 * malformed input never gets past, mirroring web/'s SignedRulePackageConsumer
 * convention of validating structure before spending a signature check.
 */
export function isStructurallyPlausibleMetadata(metadata: ModelPackageMetadata): boolean {
  if (!isPlausibleModelId(metadata.modelId)) return false;
  if (metadata.supportedLocales.length > MAX_LOCALES) return false;
  if (metadata.supportedLocales.some((l) => l.length === 0 || l.length > MAX_LOCALE_LENGTH)) return false;
  if (metadata.inScopeInputSurfaces.length === 0) return false;
  if (!metadata.inScopeInputSurfaces.every(isPermittedInputSurface)) return false;
  if (metadata.prohibitedUses.length > MAX_PROHIBITED_USES) return false;
  if (metadata.prohibitedUses.some((u) => u.length > MAX_PROHIBITED_USE_LENGTH)) return false;
  if (metadata.targetLabels.length > MAX_TARGET_LABELS) return false;
  if (metadata.expectedLatencyMs <= 0 || metadata.expectedLatencyMs > MAX_LATENCY_MS) return false;
  if (metadata.expectedMemoryBytes <= 0 || metadata.expectedMemoryBytes > MAX_MEMORY_BYTES) return false;
  if (!isPlausibleRolloutPercentage(metadata.rolloutPercentage)) return false;
  if (!isPlausibleRef(metadata.sourceLicenseProvenanceRef)) return false;
  if (!isPlausibleRef(metadata.datasetRightsAndChildDataExclusionRef)) return false;
  if (!isPlausibleRef(metadata.falsePositiveNegativeEvidenceRef)) return false;
  if (!isPlausibleRef(metadata.privacyImpactReviewRef)) return false;
  if (!isPlausibleRef(metadata.biasSafetyReviewRef)) return false;
  if (!isPlausibleRef(metadata.redTeamFindingsRef)) return false;
  return true;
}

export function isPlatformAndRuntimeCompatible(
  metadata: Pick<ModelPackageMetadata, 'targetPlatform' | 'formatRuntimeCompatibility'>,
  device: DeviceRuntimeCapability,
): { platformOk: boolean; runtimeOk: boolean } {
  const platformOk = metadata.targetPlatform === 'SHARED' || metadata.targetPlatform === device.platform;
  const runtimeOk = metadata.formatRuntimeCompatibility.some((f) => device.supportedFormats.includes(f));
  return { platformOk, runtimeOk };
}

const LEGAL_TRANSITIONS: Record<ModelLifecycleState, ReadonlySet<ModelLifecycleState>> = {
  DISCOVERED: new Set(['DOWNLOADED']),
  DOWNLOADED: new Set(['VERIFYING']),
  VERIFYING: new Set(['VERIFIED', 'REJECTED']),
  VERIFIED: new Set(['STAGED', 'REJECTED', 'EXPIRED']),
  STAGED: new Set(['ACTIVE', 'REJECTED', 'EXPIRED']),
  ACTIVE: new Set(['ROLLED_BACK', 'DISABLED', 'EXPIRED']),
  ROLLED_BACK: new Set(),
  REJECTED: new Set(),
  EXPIRED: new Set(),
  DISABLED: new Set(),
};

export function isLegalModelLifecycleTransition(from: ModelLifecycleState, to: ModelLifecycleState): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

/** doc 23/lane brief Section 29: once DISABLED (kill switch) or ROLLED_BACK/REJECTED/EXPIRED, a record is terminal -- "the previous unsafe model is not silently restored." Re-enabling requires a NEW verified record, never resurrecting this one. */
export function isTerminalLifecycleState(state: ModelLifecycleState): boolean {
  return LEGAL_TRANSITIONS[state].size === 0;
}

export const FAIL_CLOSED_REASONS: ReadonlySet<PackageVerificationFailureReason> = new Set([
  'BAD_SIGNATURE',
  'WRONG_DIGEST',
  'EXPIRED_PACKAGE',
  'UNSUPPORTED_RUNTIME',
  'UNSUPPORTED_FORMAT',
  'WRONG_PLATFORM',
  'FAILED_SELF_TEST',
  'INVALID_PROVENANCE_METADATA',
  'PROHIBITED_USE_CASE_DECLARATION',
  'ROLLBACK_INCOMPATIBLE_STATE',
]);
