import { isModelUnavailableResult } from './types.js';
import type { ClassificationResult, ModelUnavailableResult } from './types.js';
import type { ClassifierResult as WebClassifierResult, ClassifierModality } from '../web/types.js';

/**
 * doc 23 Section 1/lane brief Section 23: bridges PCA-14's generic
 * ClassificationResult onto PCA-5's already-accepted web/ClassifierResult
 * shape, for the one permitted surface that feeds it
 * (SAFE_BROWSER_CATEGORY_RISK_SCORING). Rules precedence is NOT
 * re-implemented here -- web/WebFilterEngine already only ever consults a
 * classifierResult after no WebRule matched (see web/WebFilterEngine.ts),
 * so this adapter's only job is producing a well-formed input for that
 * existing precedence, never a competing one.
 *
 * Returns `null` for a ModelUnavailableResult or an out-of-surface result
 * -- the caller (e.g. SafeBrowserNavigationPolicy) must then omit
 * `classifierResult` entirely from its WebFilterEngine.decide() call
 * rather than being handed a fabricated placeholder that could be mistaken
 * for a real signal.
 */
export function toWebClassifierResult(
  result: ClassificationResult | ModelUnavailableResult,
  modality: ClassifierModality,
): WebClassifierResult | null {
  if (isModelUnavailableResult(result)) return null;
  if (result.surface !== 'SAFE_BROWSER_CATEGORY_RISK_SCORING') return null;

  return {
    modelVersion: result.modelVersion,
    modality,
    confidenceBand: result.confidence,
    disposition: result.disposition,
  };
}
