import type { ModelLifecycleService } from '../model/ModelLifecycleService.js';
import { translate } from '../i18n/translate.js';
import type {
  ClassificationDisposition,
  ClassificationInput,
  ClassificationResult,
  ConfidenceBand,
  LocalClassifier,
  ModelCapability,
  ModelUnavailableResult,
  SupportedLocale,
} from './types.js';

export interface RawInferenceOutput {
  modelVersion: string;
  labels: string[];
  confidence: ConfidenceBand;
  disposition: ClassificationDisposition;
}

/** The actual on-device inference call -- never implemented in this backend module (doc 23 Section 2: platform LiteRT/Core ML capability, outside PCA runtime architecture backend scope). */
export type RawInferenceFn = (input: ClassificationInput, activeModelId: string) => Promise<RawInferenceOutput>;

/**
 * doc 23/lane brief Section 26/29: the enforcement point between "a model
 * exists" and "a model actually runs." classify() NEVER invokes rawInfer
 * unless model/ModelLifecycleService currently reports an ACTIVE modelId
 * for this classifier's purpose -- so a REJECTED/DISABLED/EXPIRED/never-
 * activated model can never silently produce a classification, regardless
 * of what rawInfer itself would have returned. This is the class that
 * makes "kill switch engaged -> inference stops" and "model unavailable"
 * true beyond just the lifecycle service's own bookkeeping.
 *
 * PCA-16A correction (BACKEND_I18N_NOT_WIRED): every returned
 * `explanation.kind` is now paired with a localized `explanationText`
 * resolved via translate() against `presentationLocale` -- this is the
 * real production call path (not an unused helper) that makes an `ar`
 * caller actually receive Arabic explanation text.
 */
export class LifecycleGatedClassifier implements LocalClassifier {
  readonly capability: ModelCapability;
  private readonly lifecycle: ModelLifecycleService;
  private readonly purpose: string;
  private readonly rawInfer: RawInferenceFn;

  constructor(capability: ModelCapability, lifecycle: ModelLifecycleService, purpose: string, rawInfer: RawInferenceFn) {
    this.capability = capability;
    this.lifecycle = lifecycle;
    this.purpose = purpose;
    this.rawInfer = rawInfer;
  }

  async classify(
    input: ClassificationInput,
    presentationLocale: SupportedLocale = 'en',
  ): Promise<ClassificationResult | ModelUnavailableResult> {
    if (!this.capability.supportedSurfaces.includes(input.surface)) {
      return this.unavailable('UNSUPPORTED_SURFACE', presentationLocale);
    }
    if (!this.capability.supportedLocales.includes(input.locale)) {
      return this.unavailable('UNSUPPORTED_LOCALE', presentationLocale);
    }

    const activeModelId = await this.lifecycle.getActiveModelId(this.purpose);
    if (activeModelId === null) {
      return this.unavailable('MODEL_NOT_ACTIVE', presentationLocale);
    }

    let raw: RawInferenceOutput;
    try {
      raw = await this.rawInfer(input, activeModelId);
    } catch {
      return this.unavailable('RUNTIME_UNAVAILABLE', presentationLocale);
    }

    return {
      modelId: activeModelId,
      modelVersion: raw.modelVersion,
      surface: input.surface,
      labels: raw.labels,
      confidence: raw.confidence,
      disposition: raw.disposition,
      explanation: { kind: 'SUPPLEMENTARY_RISK_SIGNAL' },
      explanationText: translate('ai.SUPPLEMENTARY_RISK_SIGNAL', presentationLocale),
    };
  }

  private unavailable(
    reason: ModelUnavailableResult['reason'],
    presentationLocale: SupportedLocale,
  ): ModelUnavailableResult {
    return {
      reason,
      explanation: { kind: 'MODEL_UNAVAILABLE' },
      explanationText: translate('ai.MODEL_UNAVAILABLE', presentationLocale),
    };
  }
}
