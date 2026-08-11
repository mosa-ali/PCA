import type { ClassificationDisposition } from './types.js';

/**
 * doc 23 Section 1, PCA-AI-001's exact order. Index 0 is highest
 * precedence. `REMOTE_SERVICE` is last and, per CLOUD_INFERENCE_APPROVED
 * below, structurally excluded from ever deciding anything in this build.
 */
export type PolicySource = 'LEGAL_PLATFORM_PARENT_POLICY' | 'SIGNED_RULES' | 'DETERMINISTIC_HEURISTIC' | 'LOCAL_MODEL' | 'REMOTE_SERVICE';

export const AI_PRECEDENCE_ORDER: readonly PolicySource[] = [
  'LEGAL_PLATFORM_PARENT_POLICY',
  'SIGNED_RULES',
  'DETERMINISTIC_HEURISTIC',
  'LOCAL_MODEL',
  'REMOTE_SERVICE',
];

/**
 * doc 23 Section 2: "Cloud inference is REQUIRES_FURTHER_OWNER_DECISION
 * and is not part of initial release... It cannot be enabled simply
 * because a model performs poorly locally." This is a source-code
 * constant, not a runtime configuration value read from any request,
 * environment variable, or feature flag store -- enabling it requires
 * editing this file, which is the point: no caller of this module can flip
 * it, so there is no hidden remote fallback reachable from outside a
 * deliberate code change.
 */
export const CLOUD_INFERENCE_APPROVED = false;

export interface PrecedenceCandidate {
  source: PolicySource;
  /** `null` means this source had no opinion (e.g. no rule matched) -- distinct from an explicit ALLOW. */
  outcome: ClassificationDisposition | null;
}

export interface PrecedenceResolution {
  outcome: ClassificationDisposition;
  decidingSource: PolicySource;
  /**
   * doc 23 Section 1: "A model MUST NOT silently override an explicit
   * parent allowlist for ordinary content; it may raise a review signal
   * where product policy permits." True only when a LOWER-precedence
   * candidate recommended BLOCK/REVIEW while the deciding (higher-
   * precedence) candidate's outcome was ALLOW -- this field NEVER changes
   * `outcome` itself, it only surfaces the lower-precedence source's
   * disagreement for optional UI use.
   */
  supplementaryReviewSignal: boolean;
}

/**
 * doc 23 Section 1's decision hierarchy, applied generically (independent
 * of web/'s own WebFilterEngine, which already implements this precedence
 * specifically for domain rules vs. classifier results -- this function is
 * for AI use cases outside that specific engine, or for tests that verify
 * the general precedence contract directly). Throws if NO candidate
 * resolves anything: every real call site must supply at least one
 * candidate with a non-null outcome (mirroring "the engine must not claim
 * a decision it did not actually make").
 */
export function resolveWithPrecedence(
  candidates: readonly PrecedenceCandidate[],
  cloudInferenceApproved: boolean = CLOUD_INFERENCE_APPROVED,
): PrecedenceResolution {
  const eligible = candidates.filter((c) => c.source !== 'REMOTE_SERVICE' || cloudInferenceApproved);

  let decidingIndex = -1;
  let decidingCandidate: PrecedenceCandidate | null = null;
  for (let i = 0; i < AI_PRECEDENCE_ORDER.length; i++) {
    const match = eligible.find((c) => c.source === AI_PRECEDENCE_ORDER[i] && c.outcome !== null);
    if (match) {
      decidingIndex = i;
      decidingCandidate = match;
      break;
    }
  }
  if (decidingCandidate === null || decidingCandidate.outcome === null) {
    throw new RangeError('resolveWithPrecedence: no candidate provided a non-null outcome.');
  }
  const decidingOutcome = decidingCandidate.outcome;

  const supplementaryReviewSignal =
    decidingOutcome === 'ALLOW' &&
    eligible.some((c) => {
      const idx = AI_PRECEDENCE_ORDER.indexOf(c.source);
      return idx > decidingIndex && (c.outcome === 'BLOCK' || c.outcome === 'REVIEW');
    });

  return { outcome: decidingOutcome, decidingSource: decidingCandidate.source, supplementaryReviewSignal };
}

// PCA-16A correction (BACKEND_I18N_NOT_WIRED): this module previously defined its own
// EXPLANATION_LABELS/explanationLabel() English-only text map here -- a second, unsynchronized
// copy of strings that also lived in backend/src/i18n's catalogue, and which no production
// caller ever actually invoked (only its own unit test did). Removed outright rather than kept
// as a redundant wrapper: doc 23 Section 4's safe, non-psychological explanation text now has
// exactly one source of truth -- backend/src/i18n/messages/{en,ar}.ts's `ai.<SafeExplanationKind>`
// entries, resolved via translate() at the real production call site
// (ai/LifecycleGatedClassifier.ts's classify(), which populates ClassificationResult/
// ModelUnavailableResult.explanationText).
