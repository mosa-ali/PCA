import type { Platform } from '../release/types.js';

export type ModelId = string;

/**
 * doc 23 Section 1's permitted local use cases only -- this union is
 * exhaustive by design, so a ModelPackageMetadata.inScopeInputSurfaces
 * entry naming anything else cannot even type-check, let alone be
 * declared. Face identity recognition, biometric templates, emotion/
 * personality inference, child profiling and background capture are never
 * representable here.
 */
export type ClassificationInputSurface =
  | 'SAFE_BROWSER_CATEGORY_RISK_SCORING'
  | 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL'
  | 'EYE_DISTANCE_CALIBRATION';

export type ReleaseChannel = 'INTERNAL' | 'BETA' | 'PRODUCTION';

/**
 * doc 23 Section 3's exact field groups, referencing (not duplicating) the
 * underlying signed release artifact: `releaseId` is the release/
 * ReleaseRecord identity for this model (packageType='MODEL_PACKAGE') --
 * hash/signature/signing-key-id/expiry-relevant artifact facts live THERE,
 * one signed release record, never re-declared here. Everything in this
 * type is model-governance metadata release/ deliberately never carries
 * (doc comment: "must never gain a field for family/child data" -- and
 * more generally never gains AI-governance fields either).
 */
export interface ModelPackageMetadata {
  modelId: ModelId;
  releaseId: string;
  version: string;
  formatRuntimeCompatibility: string[]; // e.g. ['LITERT_ANDROID', 'COREML_IOS']
  targetPlatform: Platform;
  supportedLocales: string[];
  purpose: string;
  inScopeInputSurfaces: ClassificationInputSurface[];
  prohibitedUses: string[];
  /** Opaque references/pointers to evidence documents -- never inline raw evaluation data, dataset content, or family activity. */
  sourceLicenseProvenanceRef: string;
  datasetRightsAndChildDataExclusionRef: string;
  targetLabels: string[];
  calibrationThresholdVersion: string;
  expectedLatencyMs: number;
  expectedMemoryBytes: number;
  falsePositiveNegativeEvidenceRef: string;
  privacyImpactReviewRef: string;
  biasSafetyReviewRef: string;
  redTeamFindingsRef: string;
  residualRiskAccepted: boolean;
  releaseChannel: ReleaseChannel;
  rolloutPercentage: number; // 0-100
  expiresAt: Date;
  /** Names an EARLIER, already-VERIFIED-or-better modelId this package may roll back to -- never a bare boolean. */
  rollbackTargetModelId: ModelId | null;
  killSwitchSupported: boolean;
}

/**
 * Lane brief Section 25 / architecture-equivalent lifecycle. Verification
 * gates (see PackageVerificationGate) must ALL pass before VERIFYING ->
 * VERIFIED is reachable; ACTIVE is reachable only from STAGED, never
 * directly from VERIFIED, so a package is always staged before it can
 * affect any inference decision.
 */
export type ModelLifecycleState =
  | 'DISCOVERED'
  | 'DOWNLOADED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'STAGED'
  | 'ACTIVE'
  | 'ROLLED_BACK'
  | 'REJECTED'
  | 'EXPIRED'
  | 'DISABLED';

export interface ModelLifecycleRecord {
  modelId: ModelId;
  metadata: ModelPackageMetadata;
  state: ModelLifecycleState;
  enteredStateAt: Date;
  lastVerificationFailureReason: PackageVerificationFailureReason | null;
}

/**
 * doc 23 Section 3/PCA-AI-002 and lane brief Section 26's exact fail-closed
 * reason set. Any one of these blocks VERIFYING -> VERIFIED outright; the
 * previously active package (if any) is untouched by a failed
 * verification of a DIFFERENT candidate (see ModelLifecycleService).
 */
export type PackageVerificationFailureReason =
  | 'BAD_SIGNATURE'
  | 'WRONG_DIGEST'
  | 'EXPIRED_PACKAGE'
  | 'UNSUPPORTED_RUNTIME'
  | 'UNSUPPORTED_FORMAT'
  | 'WRONG_PLATFORM'
  | 'FAILED_SELF_TEST'
  | 'INVALID_PROVENANCE_METADATA'
  | 'PROHIBITED_USE_CASE_DECLARATION'
  | 'ROLLBACK_INCOMPATIBLE_STATE';

export type PackageVerificationResult =
  | { outcome: 'PASSED' }
  | { outcome: 'FAILED'; reason: PackageVerificationFailureReason };

/** What the CONSUMING DEVICE can actually run -- verified against ModelPackageMetadata.formatRuntimeCompatibility/targetPlatform, never assumed. */
export interface DeviceRuntimeCapability {
  platform: Platform;
  supportedFormats: string[];
}
