import type { ModelId, ModelLifecycleRecord } from './types.js';

/**
 * Device-local persistence port. `getActiveModelId`/`setActiveModelId` are
 * keyed by `purpose` (a ClassificationInputSurface-scoped string) so
 * different surfaces (Safe Browser scoring vs phishing signal) can each
 * have their own independently active model -- never a single global
 * pointer that conflates unrelated use cases.
 */
export interface ModelLifecycleRepository {
  get(modelId: ModelId): Promise<ModelLifecycleRecord | null>;
  put(record: ModelLifecycleRecord): Promise<void>;
  getActiveModelId(purpose: string): Promise<ModelId | null>;
  setActiveModelId(purpose: string, modelId: ModelId | null): Promise<void>;
}

export class InMemoryModelLifecycleRepository implements ModelLifecycleRepository {
  private readonly records = new Map<ModelId, ModelLifecycleRecord>();
  private readonly activeByPurpose = new Map<string, ModelId>();

  async get(modelId: ModelId): Promise<ModelLifecycleRecord | null> {
    return this.records.get(modelId) ?? null;
  }

  async put(record: ModelLifecycleRecord): Promise<void> {
    this.records.set(record.modelId, record);
  }

  async getActiveModelId(purpose: string): Promise<ModelId | null> {
    return this.activeByPurpose.get(purpose) ?? null;
  }

  async setActiveModelId(purpose: string, modelId: ModelId | null): Promise<void> {
    if (modelId === null) this.activeByPurpose.delete(purpose);
    else this.activeByPurpose.set(purpose, modelId);
  }
}
