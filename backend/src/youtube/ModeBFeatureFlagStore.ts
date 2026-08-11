import { defaultModeBFeatureFlagState } from './policy.js';
import type { ModeBFeatureFlagState } from './types.js';

/**
 * Global (not per-family) persistence port for the Mode B feature flag --
 * doc 15 frames Mode B activation as an owner/release decision, never a
 * per-family or per-child toggle, so there is deliberately no family-scoped
 * key here.
 */
export interface ModeBFeatureFlagRepository {
  get(): Promise<ModeBFeatureFlagState>;
  put(state: ModeBFeatureFlagState): Promise<void>;
}

/** doc 15: "MODE_B feature flag = OFF by default." A fresh repository with no prior write returns the OFF/unreviewed default -- never an implicit ON. */
export class InMemoryModeBFeatureFlagRepository implements ModeBFeatureFlagRepository {
  private state: ModeBFeatureFlagState = defaultModeBFeatureFlagState();

  async get(): Promise<ModeBFeatureFlagState> {
    return this.state;
  }

  async put(state: ModeBFeatureFlagState): Promise<void> {
    this.state = state;
  }
}

export class ModeBFeatureFlagService {
  private readonly repository: ModeBFeatureFlagRepository;
  private readonly now: () => Date;

  constructor(repository: ModeBFeatureFlagRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async getState(): Promise<ModeBFeatureFlagState> {
    return this.repository.get();
  }

  /** Records the doc 15 release-gate terms re-verification. Does not itself enable the flag -- both this AND enable() must happen (see policy.ts's isModeBActive). */
  async recordTermsReview(): Promise<ModeBFeatureFlagState> {
    const current = await this.repository.get();
    const next: ModeBFeatureFlagState = { ...current, termsReviewedAt: this.now() };
    await this.repository.put(next);
    return next;
  }

  async enable(): Promise<ModeBFeatureFlagState> {
    const current = await this.repository.get();
    const next: ModeBFeatureFlagState = { ...current, enabled: true };
    await this.repository.put(next);
    return next;
  }

  async disable(): Promise<ModeBFeatureFlagState> {
    const current = await this.repository.get();
    const next: ModeBFeatureFlagState = { ...current, enabled: false };
    await this.repository.put(next);
    return next;
  }
}
