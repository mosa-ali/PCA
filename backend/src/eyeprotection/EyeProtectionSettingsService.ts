import type { EyeProtectionSettings, EyeProtectionSettingsRepository } from './EyeProtectionSettingsRepository.js';

export type EyeProtectionErrorCode = 'NOT_AUTHORIZED';

export class EyeProtectionError extends Error {
  readonly code: EyeProtectionErrorCode;
  constructor(code: EyeProtectionErrorCode) {
    super(EYE_PROTECTION_ERROR_MESSAGES[code]);
    this.name = 'EyeProtectionError';
    this.code = code;
  }
}

const EYE_PROTECTION_ERROR_MESSAGES: Record<EyeProtectionErrorCode, string> = {
  NOT_AUTHORIZED: 'The acting device is not authorized to edit this child\'s eye-protection setting.',
};

/**
 * PCA eye-protection reminders: the repository-facing operations for the
 * per-child reminders-enabled toggle. Parent-session role and family scope
 * are enforced by eyeProtectionRoutes.ts before writes. Unlike the
 * schedule-policy route, the setting itself is a plain, non-E2EE boolean
 * preference (see EyeProtectionSettingsRepository's own doc comment for
 * why that is the correct, reviewed posture for this specific field), so
 * this service writes it directly via the injected repository rather than
 * relaying an opaque encrypted envelope.
 */
export class EyeProtectionSettingsService {
  constructor(private readonly repository: EyeProtectionSettingsRepository) {}

  async get(familyId: string, childProfileId: string): Promise<EyeProtectionSettings> {
    return this.repository.get(familyId, childProfileId);
  }

  async updateReminders(familyId: string, childProfileId: string, remindersEnabled: boolean): Promise<EyeProtectionSettings> {
    return this.repository.update(familyId, childProfileId, { remindersEnabled });
  }
}
