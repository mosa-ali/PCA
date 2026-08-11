import type { ClassificationInputSurface } from '../model/types.js';

export type { ClassificationInputSurface };

export type ConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH';
export type ClassificationDisposition = 'BLOCK' | 'REVIEW' | 'ALLOW';

/**
 * doc 23 Section 4: explanations must be safe for a parent/child, never a
 * psychological/personality conclusion. This is an exhaustive, closed set
 * -- there is no free-text explanation field anywhere in this module, so a
 * caller cannot smuggle a profiling-shaped sentence through it.
 */
export type SafeExplanationKind =
  | 'CATEGORY_RULE_MATCHED'
  | 'SUPPLEMENTARY_RISK_SIGNAL'
  | 'MODEL_UNAVAILABLE'
  | 'CONFIDENCE_BELOW_THRESHOLD';

export interface SafeExplanation {
  kind: SafeExplanationKind;
}

/**
 * doc 23 Section 1/2: content stays in the originating process; this
 * module never defines a serializable shape for `content` (it is `unknown`
 * on purpose) so there is no accidental persistence/logging path through
 * this type -- see ai/policy.ts's noRawContentField for the enforcement
 * this asymmetry is meant to support.
 */
export interface ClassificationInput {
  surface: ClassificationInputSurface;
  locale: string;
  content: unknown;
}

/** doc 23 Section 3: "Results should contain only what downstream deterministic policy requires." No raw input, confidence score, or free-text field beyond this. */
export interface ClassificationResult {
  modelId: string;
  modelVersion: string;
  surface: ClassificationInputSurface;
  labels: string[];
  confidence: ConfidenceBand;
  disposition: ClassificationDisposition;
  explanation: SafeExplanation;
}

export type ModelUnavailableReason =
  | 'MODEL_NOT_ACTIVE'
  | 'KILL_SWITCH_ENGAGED'
  | 'UNSUPPORTED_SURFACE'
  | 'UNSUPPORTED_LOCALE'
  | 'RUNTIME_UNAVAILABLE'
  | 'SELF_TEST_FAILED';

export interface ModelUnavailableResult {
  reason: ModelUnavailableReason;
  explanation: SafeExplanation;
}

/** doc 23 Section 2: "must not make a network call to function." `requiresNetwork` is a literal `false` type, not a boolean -- a capability object claiming otherwise cannot even be constructed as a LocalClassifier. */
export interface ModelCapability {
  modelId: string;
  supportedSurfaces: ClassificationInputSurface[];
  supportedLocales: string[];
  requiresNetwork: false;
}

/**
 * doc 23 Section 2/lane brief Section 22. This is a PROTOCOL-NEUTRAL
 * interface only -- no runtime, no LiteRT/Core ML binding, no actual
 * inference code lives in this backend module. A real on-device
 * implementation is a platform-specific concern outside this lane's
 * backend scope.
 */
export interface LocalClassifier {
  readonly capability: ModelCapability;
  classify(input: ClassificationInput): Promise<ClassificationResult | ModelUnavailableResult>;
}

export function isModelUnavailableResult(
  result: ClassificationResult | ModelUnavailableResult,
): result is ModelUnavailableResult {
  return 'reason' in result;
}
