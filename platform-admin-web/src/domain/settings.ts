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
