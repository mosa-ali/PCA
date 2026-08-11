import type { ModelLifecycleService } from '../model/ModelLifecycleService.js';
import type {
  ClassificationDisposition,
  ClassificationInput,
  ClassificationResult,
  ConfidenceBand,
  LocalClassifier,
  ModelCapability,
  ModelUnavailableResult,
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

  async classify(input: ClassificationInput): Promise<ClassificationResult | ModelUnavailableResult> {
    if (!this.capability.supportedSurfaces.includes(input.surface)) {
      return { reason: 'UNSUPPORTED_SURFACE', explanation: { kind: 'MODEL_UNAVAILABLE' } };
    }
    if (!this.capability.supportedLocales.includes(input.locale)) {
      return { reason: 'UNSUPPORTED_LOCALE', explanation: { kind: 'MODEL_UNAVAILABLE' } };
    }

    const activeModelId = await this.lifecycle.getActiveModelId(this.purpose);
    if (activeModelId === null) {
      return { reason: 'MODEL_NOT_ACTIVE', explanation: { kind: 'MODEL_UNAVAILABLE' } };
    }

    let raw: RawInferenceOutput;
    try {
      raw = await this.rawInfer(input, activeModelId);
    } catch {
      return { reason: 'RUNTIME_UNAVAILABLE', explanation: { kind: 'MODEL_UNAVAILABLE' } };
    }

    return {
      modelId: activeModelId,
      modelVersion: raw.modelVersion,
      surface: input.surface,
      labels: raw.labels,
      confidence: raw.confidence,
      disposition: raw.disposition,
      explanation: { kind: 'SUPPLEMENTARY_RISK_SIGNAL' },
    };
  }
}
