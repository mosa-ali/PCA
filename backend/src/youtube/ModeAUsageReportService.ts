import type { ModeAUsageEvidence, OpaqueFamilyId, OpaqueProfileId, UsageCapabilityStatus, UsageSource } from './types.js';

export type ModeAErrorCode = 'INVALID_DURATION' | 'DURATION_WITHOUT_GRANT';

export class ModeAError extends Error {
  readonly code: ModeAErrorCode;
  constructor(code: ModeAErrorCode) {
    super(MODE_A_ERROR_MESSAGES[code]);
    this.name = 'ModeAError';
    this.code = code;
  }
}

const MODE_A_ERROR_MESSAGES: Record<ModeAErrorCode, string> = {
  INVALID_DURATION: 'durationMs must be a non-negative finite number when supplied.',
  DURATION_WITHOUT_GRANT: 'A duration figure requires GRANTED capability status.',
};

/**
 * doc 15 Mode A builder. Deliberately accepts only an aggregate duration
 * figure (or none) -- there is no parameter anywhere on this method for a
 * video id, title, or per-item list, so this service cannot be made to
 * fabricate an exact watched-video history even by a careless caller; the
 * type system enforces doc 15's "must not fabricate an exact watched-video
 * list" at the call site, not just by convention.
 */
export class ModeAUsageReportService {
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  buildEvidence(
    familyId: OpaqueFamilyId,
    profileId: OpaqueProfileId,
    source: UsageSource,
    capabilityStatus: UsageCapabilityStatus,
    durationMs: number | null,
  ): ModeAUsageEvidence {
    if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0)) {
      throw new ModeAError('INVALID_DURATION');
    }
    if (durationMs !== null && capabilityStatus !== 'GRANTED') {
      throw new ModeAError('DURATION_WITHOUT_GRANT');
    }

    return {
      familyId,
      profileId,
      source,
      capabilityStatus,
      durationMs,
      coverageGap: capabilityStatus !== 'GRANTED' || durationMs === null,
      observedAt: this.now(),
      label: 'app usage only',
    };
  }
}
