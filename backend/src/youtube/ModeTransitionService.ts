import { isLegalModeTransition, isModeBActive } from './policy.js';
import type { ModeBFeatureFlagRepository } from './ModeBFeatureFlagStore.js';
import type { OpaqueFamilyId, OpaqueProfileId, YouTubeMode } from './types.js';

/** Per-profile current-mode persistence port. A profile with no prior write is Mode A -- doc 15 never describes an "unset" third state. */
export interface ProfileModeRepository {
  get(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<YouTubeMode>;
  put(familyId: OpaqueFamilyId, profileId: OpaqueProfileId, mode: YouTubeMode): Promise<void>;
}

export class InMemoryProfileModeRepository implements ProfileModeRepository {
  private readonly modes = new Map<string, YouTubeMode>();

  private key(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): string {
    return `${familyId} ${profileId}`;
  }

  async get(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<YouTubeMode> {
    return this.modes.get(this.key(familyId, profileId)) ?? 'A';
  }

  async put(familyId: OpaqueFamilyId, profileId: OpaqueProfileId, mode: YouTubeMode): Promise<void> {
    this.modes.set(this.key(familyId, profileId), mode);
  }
}

export type ModeTransitionErrorCode = 'ILLEGAL_TRANSITION';

export class ModeTransitionError extends Error {
  readonly code: ModeTransitionErrorCode;
  constructor(code: ModeTransitionErrorCode) {
    super('This mode transition is not permitted.');
    this.name = 'ModeTransitionError';
    this.code = code;
  }
}

/**
 * doc 15: a profile is in exactly one of Mode A or Mode B. Switching into
 * B is only legal while the global feature flag is fully active (owner-
 * enabled AND terms-reviewed); switching back to A is always legal and is
 * the safe fallback if the flag is later disabled mid-flight (see
 * revertIfModeBInactive).
 */
export class ModeTransitionService {
  private readonly profileModes: ProfileModeRepository;
  private readonly featureFlags: ModeBFeatureFlagRepository;

  constructor(profileModes: ProfileModeRepository, featureFlags: ModeBFeatureFlagRepository) {
    this.profileModes = profileModes;
    this.featureFlags = featureFlags;
  }

  async getMode(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<YouTubeMode> {
    return this.profileModes.get(familyId, profileId);
  }

  async transitionTo(familyId: OpaqueFamilyId, profileId: OpaqueProfileId, to: YouTubeMode): Promise<YouTubeMode> {
    const from = await this.profileModes.get(familyId, profileId);
    const flag = await this.featureFlags.get();
    if (!isLegalModeTransition(from, to, flag)) throw new ModeTransitionError('ILLEGAL_TRANSITION');
    await this.profileModes.put(familyId, profileId, to);
    return to;
  }

  /** Owner disabling the flag must not leave a profile stranded in an inert Mode B -- reverts any profile currently in B back to A. Idempotent for a profile already in A. */
  async revertIfModeBInactive(familyId: OpaqueFamilyId, profileId: OpaqueProfileId): Promise<YouTubeMode> {
    const current = await this.profileModes.get(familyId, profileId);
    if (current !== 'B') return current;
    const flag = await this.featureFlags.get();
    if (isModeBActive(flag)) return current;
    await this.profileModes.put(familyId, profileId, 'A');
    return 'A';
  }
}
