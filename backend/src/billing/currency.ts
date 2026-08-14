/**
 * PCA Billing Core -- centralized currency metadata (`PCA-ADD-BILL-018`).
 * The single source of truth every money-handling call site in
 * backend/src/billing/** imports from -- never `currency === 'USD' ? 2 : ...`
 * scattered per call site.
 *
 * Mirrored, not duplicated in meaning, by migrations/0007_billing_core.sql's
 * `billing_currencies` seed rows -- that table is the DB-level enforcement
 * (every other billing table's currency_code column foreign-keys into it);
 * this module is the application-layer source of truth, exactly mirroring
 * how migration 0005's audit event CHECK constraint is a hand-transcribed
 * copy of backend/src/platformadmin/audit/types.ts's event vocabulary. A
 * reviewer changing one MUST change the other.
 *
 * `PCA-ADD-BILL-019`: initial supported currencies are USD (global/default),
 * SAR (Gulf market), and YER (Yemen only). EUR is explicitly OUT of initial
 * scope (`PCA-DEC-024` superseded an earlier four-currency draft) --
 * `isSupportedCurrency('EUR')` returns false and `getCurrencyMetadata('EUR')`
 * throws, by construction, because EUR simply has no entry below.
 */

export const SUPPORTED_CURRENCIES = ['USD', 'SAR', 'YER'] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export interface CurrencyMetadata {
  readonly currencyCode: CurrencyCode;
  /** ISO 4217 minor-unit exponent -- the number of digits after the decimal point the currency's minor unit represents. */
  readonly minorUnitExponent: number;
  readonly enabled: boolean;
}

const CURRENCY_METADATA: Readonly<Record<CurrencyCode, CurrencyMetadata>> = {
  USD: { currencyCode: 'USD', minorUnitExponent: 2, enabled: true },
  SAR: { currencyCode: 'SAR', minorUnitExponent: 2, enabled: true },
  YER: { currencyCode: 'YER', minorUnitExponent: 2, enabled: true },
};

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_METADATA, code);
}

export class UnsupportedCurrencyError extends Error {
  constructor(code: string) {
    super(`Unsupported currency code: ${code}. Supported currencies: ${SUPPORTED_CURRENCIES.join(', ')}.`);
    this.name = 'UnsupportedCurrencyError';
  }
}

/** Throws UnsupportedCurrencyError for any code not in SUPPORTED_CURRENCIES (including 'EUR') -- never returns a fallback/default exponent. */
export function getCurrencyMetadata(code: string): CurrencyMetadata {
  if (!isSupportedCurrency(code)) throw new UnsupportedCurrencyError(code);
  return CURRENCY_METADATA[code];
}

export function listCurrencyMetadata(): CurrencyMetadata[] {
  return SUPPORTED_CURRENCIES.map((code) => CURRENCY_METADATA[code]);
}
