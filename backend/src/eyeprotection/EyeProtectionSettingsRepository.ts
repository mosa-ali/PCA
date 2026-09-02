/**
 * PCA eye-protection reminders: durable, per-child, parent-controlled
 * enable/disable preference for an on-device, reminder-only break prompt
 * (no dimming, no blocking overlay, no forced break -- see the feature's
 * own product/privacy framing). This repository holds ONLY that boolean
 * preference, never a sensor reading, proximity classification, or any
 * other camera/distance signal -- those stay entirely on-device and are
 * never transmitted, matching migrations/0032_eye_protection_settings.sql's
 * own header comment.
 *
 * Same shape/convention as parentaccount/ParentPreferenceRepository.ts
 * (get() returns a safe all-false-and-never-updated default rather than
 * throwing when no row exists yet; update() upserts and returns the
 * resulting row), scoped by (familyId, childProfileId) instead of a single
 * accountId.
 */
export interface EyeProtectionSettings {
  childProfileId: string;
  familyId: string;
  remindersEnabled: boolean;
  updatedAtUtc: string;
}

export interface EyeProtectionSettingsPatch {
  remindersEnabled: boolean;
}

export interface EyeProtectionSettingsRepository {
  get(familyId: string, childProfileId: string): Promise<EyeProtectionSettings>;
  update(familyId: string, childProfileId: string, patch: EyeProtectionSettingsPatch): Promise<EyeProtectionSettings>;
}

/**
 * Reference/test implementation only -- keyed purely by childProfileId
 * (matching the real MySQL table's PRIMARY KEY), never a second,
 * independently-scoped map. Useful for EyeProtectionSettingsService unit
 * tests that don't need a live database.
 */
export class InMemoryEyeProtectionSettingsRepository implements EyeProtectionSettingsRepository {
  private readonly rows = new Map<string, EyeProtectionSettings>();

  async get(familyId: string, childProfileId: string): Promise<EyeProtectionSettings> {
    const existing = this.rows.get(childProfileId);
    if (existing && existing.familyId === familyId) return existing;
    return {
      childProfileId,
      familyId,
      remindersEnabled: false,
      updatedAtUtc: new Date(0).toISOString(),
    };
  }

  async update(familyId: string, childProfileId: string, patch: EyeProtectionSettingsPatch): Promise<EyeProtectionSettings> {
    const updated: EyeProtectionSettings = {
      childProfileId,
      familyId,
      remindersEnabled: patch.remindersEnabled,
      updatedAtUtc: new Date().toISOString(),
    };
    this.rows.set(childProfileId, updated);
    return updated;
  }
}
