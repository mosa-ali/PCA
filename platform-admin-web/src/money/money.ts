// Exact-money utility for the Platform Administration UI. Mirrors the
// discipline backend/src/billing/money.ts and PCA_ADDENDUM_002 Section 10
// (PCA-ADD-BILL-017/018/019) require: every amount is an integer minor-unit
// count (never a float) paired with an explicit ISO 4217 currency code.
// This module never calls parseFloat on money, never multiplies/divides a
// display value by a power of ten to "convert" it, and only supports the
// three currencies the addendum actually enables initially -- EUR and any
// other currency is deliberately absent (PCA-ADD-BILL-019).

export type SupportedCurrencyCode = 'USD' | 'SAR' | 'YER';

export const SUPPORTED_CURRENCIES: readonly SupportedCurrencyCode[] = ['USD', 'SAR', 'YER'];

interface CurrencyMeta {
  /** Number of minor-unit digits, e.g. 2 for USD cents. */
  exponent: number;
  /** BCP 47 locale used only for grouping/decimal separators -- never changes the underlying integer value. */
  displayLocale: string;
}

// Centrally maintained exponent table (PCA-ADD-BILL-018) -- never hardcode
// an exponent at a call site.
const CURRENCY_META: Record<SupportedCurrencyCode, CurrencyMeta> = {
  USD: { exponent: 2, displayLocale: 'en-US' },
  SAR: { exponent: 2, displayLocale: 'ar-SA' },
  YER: { exponent: 2, displayLocale: 'ar-YE' },
};

export function isSupportedCurrency(value: unknown): value is SupportedCurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export interface MoneyAmount {
  amountMinor: number;
  currencyCode: SupportedCurrencyCode;
}

/**
 * Formats an integer minor-unit amount for display. Never touches the
 * value as a float: division by 10^exponent happens once, on an integer,
 * purely to hand Intl.NumberFormat the major-unit number it expects for
 * grouping/decimal rendering -- the authoritative value stored/sent
 * remains amountMinor everywhere else in the app.
 */
export function formatMoney({ amountMinor, currencyCode }: MoneyAmount, locale?: string): string {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(`amountMinor must be an integer minor-unit count, received: ${amountMinor}`);
  }
  const meta = CURRENCY_META[currencyCode];
  const majorUnits = amountMinor / 10 ** meta.exponent;
  return new Intl.NumberFormat(locale ?? meta.displayLocale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: meta.exponent,
    maximumFractionDigits: meta.exponent,
  }).format(majorUnits);
}

/**
 * The ONLY sanctioned way to turn an operator-typed decimal string (e.g. a
 * price-book row editor's "12.50") into an exact amountMinor integer for
 * submission to the Billing Core API. Rejects anything that is not a
 * plain, non-negative decimal with at most `exponent` fractional digits --
 * never uses parseFloat()/Number() * 10^n, which is exactly the unsafe
 * pattern mission Section 17 prohibits (binary float rounding can turn
 * "19.99" * 100 into 1998.9999999999998).
 */
export function parseExactMinorUnits(input: string, currencyCode: SupportedCurrencyCode): number {
  const meta = CURRENCY_META[currencyCode];
  const trimmed = input.trim();
  const pattern = new RegExp(`^(0|[1-9]\\d*)(\\.(\\d{1,${meta.exponent}}))?$`);
  const match = pattern.exec(trimmed);
  if (!match) {
    throw new TypeError(`"${input}" is not a valid non-negative ${currencyCode} amount (max ${meta.exponent} decimal places)`);
  }
  const [, wholePart, , fractionPartRaw] = match;
  const fractionPart = (fractionPartRaw ?? '').padEnd(meta.exponent, '0');
  const wholeMinor = BigInt(wholePart) * 10n ** BigInt(meta.exponent);
  const fractionMinor = fractionPart.length > 0 ? BigInt(fractionPart) : 0n;
  const total = wholeMinor + fractionMinor;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`"${input}" exceeds the maximum representable amount`);
  }
  return Number(total);
}
