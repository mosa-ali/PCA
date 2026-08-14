/**
 * PCA Billing Core -- the exact Money model (`PCA-ADD-BILL-017`).
 *
 * HARD INVARIANT: no IEEE-754 floating-point representation of money is
 * permitted anywhere in the Billing domain -- not in storage, not in
 * transport, not in intermediate computation. Every monetary amount is a
 * `bigint` count of the currency's minor unit (`amountMinor`) paired with an
 * explicit, validated `currencyCode` (`PCA-ADD-BILL-015`: no entity may have
 * an amount field without a co-located, explicit currency field).
 *
 * JSON SAFETY: `JSON.stringify` throws on a raw `bigint` (it is not
 * representable in JSON), and `Number(someBigint)` silently loses precision
 * above `Number.MAX_SAFE_INTEGER` (2^53 - 1) -- both are correctness bugs
 * for a financial-authority value. `moneyToJson`/`moneyFromJson` below are
 * the ONLY sanctioned money <-> JSON boundary: amountMinor always crosses as
 * a decimal STRING, never a `number`.
 */

import { getCurrencyMetadata } from './currency.js';
import type { CurrencyCode } from './currency.js';

export interface Money {
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: ${a} vs ${b}. Billing Core never performs implicit currency conversion.`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

/** Constructs a validated Money value. amountMinor must be a non-negative exact integer (bigint); currencyCode must be a supported ISO 4217 code (currency.ts). */
export function money(amountMinor: bigint, currencyCode: CurrencyCode): Money {
  if (typeof amountMinor !== 'bigint') throw new InvalidMoneyError('amountMinor must be a bigint, never a number/float.');
  if (amountMinor < 0n) throw new InvalidMoneyError('amountMinor must not be negative.');
  getCurrencyMetadata(currencyCode); // throws UnsupportedCurrencyError for an unsupported/unknown code, including 'EUR'
  return { amountMinor, currencyCode };
}

export const ZERO_USD: Money = money(0n, 'USD');

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currencyCode !== b.currencyCode) throw new CurrencyMismatchError(a.currencyCode, b.currencyCode);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currencyCode);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  if (b.amountMinor > a.amountMinor) throw new InvalidMoneyError('subtractMoney would produce a negative amount.');
  return money(a.amountMinor - b.amountMinor, a.currencyCode);
}

/** quantity is an exact non-negative integer (never a fractional multiplier -- fractional/prorated pricing is authored explicitly by the App Owner as its own PriceBook/InvoiceLine amount, never derived by float multiplication here). */
export function multiplyMoneyByQuantity(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) throw new InvalidMoneyError('quantity must be a non-negative integer.');
  return money(a.amountMinor * BigInt(quantity), a.currencyCode);
}

export function sumMoney(items: readonly Money[], currencyCode: CurrencyCode): Money {
  return items.reduce((total, item) => addMoney(total, item), money(0n, currencyCode));
}

export function isZeroMoney(a: Money): boolean {
  return a.amountMinor === 0n;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/** Wire-safe representation: amountMinor as a base-10 string, never a JS number. */
export interface MoneyJson {
  readonly amountMinor: string;
  readonly currencyCode: CurrencyCode;
}

export function moneyToJson(a: Money): MoneyJson {
  return { amountMinor: a.amountMinor.toString(10), currencyCode: a.currencyCode };
}

const DECIMAL_INTEGER_STRING = /^-?\d+$/;

/** Parses a MoneyJson value produced by moneyToJson (or an equivalent external payload). Rejects non-integer-string amounts outright rather than coercing through Number. */
export function moneyFromJson(value: MoneyJson): Money {
  if (typeof value.amountMinor !== 'string' || !DECIMAL_INTEGER_STRING.test(value.amountMinor)) {
    throw new InvalidMoneyError(`amountMinor must be a decimal integer string, got: ${JSON.stringify(value.amountMinor)}`);
  }
  return money(BigInt(value.amountMinor), value.currencyCode);
}

/**
 * Converts a value read back from a MySQL BIGINT column via mysql2
 * (backend/src/db/pool.ts's `supportBigNumbers: true, bigNumberStrings:
 * false` config returns a JS `number` for values within
 * Number.MAX_SAFE_INTEGER and a `string` otherwise) into an exact `bigint`,
 * uniformly, regardless of which shape the driver handed back for a given
 * value's magnitude.
 */
export function sqlAmountMinorToBigInt(value: number | string): bigint {
  return typeof value === 'string' ? BigInt(value) : BigInt(value);
}

/** The exact string form to bind as a BIGINT column parameter -- never pass a raw bigint or a lossy Number(amountMinor) to the mysql2 driver. */
export function bigIntToSqlParam(value: bigint): string {
  return value.toString(10);
}
