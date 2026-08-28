export interface FreeStarterDefaults {
  tier: string;
  parentMemberLimit: number;
  managedDeviceLimit: number;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export interface CurrencyMetadataRow {
  currencyCode: string;
  minorUnitExponent: number;
  enabled: boolean;
}

export const COMMERCIAL_MARKETS = ['YEMEN', 'GULF', 'GLOBAL_OTHER'] as const;
export type CommercialMarket = (typeof COMMERCIAL_MARKETS)[number];

export interface MarketMappingRow {
  countryCode: string;
  commercialMarket: CommercialMarket;
}

// ---- Generic platform-admin settings categories -------------------------
// Wire shapes of GET /platform-admin/settings/category/:category and
// PUT /platform-admin/settings/key/:settingKey
// (backend/src/http/routes/platformadmin/settingsRoutes.ts, PCA-ADD-PA-043/044).

export const PLATFORM_ADMIN_SETTING_CATEGORIES = ['BRANDING', 'PAYMENT_PROVIDER', 'NOTIFICATION', 'MAINTENANCE', 'FEATURE_FLAG'] as const;
export type PlatformAdminSettingCategory = (typeof PLATFORM_ADMIN_SETTING_CATEGORIES)[number];

/**
 * PAYMENT_PROVIDER is the ONE sensitive category (PlatformAdminSettingsService's
 * SENSITIVE_CATEGORIES). Its reads are structurally masked -- the response
 * carries no `value` field at all -- and its writes are gated by
 * ADMINISTER_SENSITIVE_PLATFORM_SETTINGS instead of
 * ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS.
 */
export const SENSITIVE_SETTING_CATEGORIES: readonly PlatformAdminSettingCategory[] = ['PAYMENT_PROVIDER'];

export function isSensitiveSettingCategory(category: PlatformAdminSettingCategory): boolean {
  return SENSITIVE_SETTING_CATEGORIES.includes(category);
}

/** Non-sensitive row -- the backend returns the stored JSON value verbatim. */
export interface PlainSettingRow {
  settingKey: string;
  category: PlatformAdminSettingCategory;
  value: unknown;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

/** Sensitive row -- deliberately has NO `value` field; the backend never sends one. */
export interface MaskedSettingRow {
  settingKey: string;
  category: PlatformAdminSettingCategory;
  maskedDisplay: string;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export type PlatformAdminSettingRow = PlainSettingRow | MaskedSettingRow;

export function isMaskedSettingRow(row: PlatformAdminSettingRow): row is MaskedSettingRow {
  return 'maskedDisplay' in row;
}

/** Mirrors settingsRoutes.ts's SETTING_KEY_PATTERN exactly -- a client-side hint only; the server re-validates. */
export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,126}[a-z0-9]$/;

/** Mirrors PlatformAdminSettingsService's MASKED_DISPLAY_MAX_LENGTH. */
export const MASKED_DISPLAY_MAX_LENGTH = 128;
