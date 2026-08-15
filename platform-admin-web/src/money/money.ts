// Exact-money utility for the Platform Administration UI. Mirrors the
// discipline backend/src/billing/money.ts and PCA_ADDENDUM_002 Section 10
// (PCA-ADD-BILL-017/018/019) require: every amount is an integer minor-unit
// count (never a float) paired with an explicit ISO 4217 currency code.
//
// WIRE CONTRACT (ROUND4_INTERFACE_CONTRACTS.md "Global money rule"): the
// backend bigint is the sole authority; `amountMinor` is ALWAYS serialized
// as a decimal-integer STRING on the wire (via `moneyToJson`/
// `bigintAmountToJson`), never a JS number. This module never calls
// parseFloat on money, never does `Number(json.amountMinor)` as financial
// authority, never multiplies/divides a display value by a power of ten to
// "convert" it, and only supports the three currencies the addendum
// actually enables initially -- EUR and any other currency is deliberately
// absent (PCA-ADD-BILL-019).
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

/**
 * The wire/storage representation of a money value: `amountMinor` is a
 * decimal-integer STRING (as produced by backend `moneyToJson`/
 * `bigintAmountToJson`), never a JS `number`. This is the ONLY shape money
 * may take in component props, API request/response bodies, or React
 * state anywhere in this app.
 */
export interface MoneyAmount {
  amountMinor: string;
  currencyCode: SupportedCurrencyCode;
}

const DECIMAL_INTEGER_STRING = /^-?\d+$/;

/** True only for a well-formed base-10 integer string (optionally negative). Does not validate range. */
export function isDecimalIntegerString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_INTEGER_STRING.test(value);
}

/**
 * Parses a wire `amountMinor` decimal string into an exact BigInt. Throws
 * rather than silently coercing a malformed value -- never falls back to
 * `Number()`.
 */
export function parseMinorUnitsString(amountMinor: string): bigint {
  if (!isDecimalIntegerString(amountMinor)) {
    throw new TypeError(`amountMinor must be a decimal integer string, received: ${JSON.stringify(amountMinor)}`);
  }
  return BigInt(amountMinor);
}

/**
 * Formats a wire-shaped money value (`amountMinor` as a decimal string) for
 * display. Converts the exact BigInt minor-unit count to a whole-number and
 * fractional-digit string via pure integer (BigInt) arithmetic -- division
 * by 10^exponent happens once, on a BigInt, to split whole/fractional
 * digits; the fractional remainder is zero-padded as a string. The result
 * is handed to Intl.NumberFormat only as a JS number for GROUPING/DECIMAL
 * SEPARATOR rendering of currencies within Number.isSafeInteger range --
 * for amounts that could exceed safe-integer range, formatting falls back
 * to plain BigInt-derived string composition (never routes through
 * Number() as financial authority either way).
 */
export function formatMoney({ amountMinor, currencyCode }: MoneyAmount, locale?: string): string {
  const meta = CURRENCY_META[currencyCode];
  const minor = parseMinorUnitsString(amountMinor);
  const negative = minor < 0n;
  const absMinor = negative ? -minor : minor;
  const base = 10n ** BigInt(meta.exponent);
  const whole = absMinor / base;
  const fraction = absMinor % base;

  // Prefer Intl.NumberFormat (locale-correct grouping/currency symbol
  // placement) whenever the exact value round-trips through a JS number
  // without precision loss; otherwise compose the string by hand from the
  // exact BigInt whole/fraction parts so no precision is ever lost for
  // amounts beyond Number.MAX_SAFE_INTEGER.
  if (absMinor <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const majorUnits = (negative ? -1 : 1) * (Number(whole) + Number(fraction) / Number(base));
    return new Intl.NumberFormat(locale ?? meta.displayLocale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: meta.exponent,
      maximumFractionDigits: meta.exponent,
    }).format(majorUnits);
  }

  const fractionStr = fraction.toString(10).padStart(meta.exponent, '0');
  const sign = negative ? '-' : '';
  return meta.exponent > 0 ? `${sign}${currencyCode} ${whole.toString(10)}.${fractionStr}` : `${sign}${currencyCode} ${whole.toString(10)}`;
}

/**
 * The ONLY sanctioned way to turn an operator-typed decimal string (e.g. a
 * price-book row editor's "12.50") into an exact amountMinor DECIMAL STRING
 * for submission to the Billing Core API (PriceBook create body / quote
 * issuance body both require `amountMinor` as a decimal-integer string).
 * Rejects anything that is not a plain, non-negative decimal with at most
 * `exponent` fractional digits -- never uses parseFloat()/Number() * 10^n,
 * which is exactly the unsafe pattern mission Section 17 prohibits (binary
 * float rounding can turn "19.99" * 100 into 1998.9999999999998).
 */
export function parseExactMinorUnits(input: string, currencyCode: SupportedCurrencyCode): string {
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
  return total.toString(10);
}
