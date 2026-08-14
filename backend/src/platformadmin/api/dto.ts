/**
 * PCA-PA-3B -- shared wire-format helpers for the Platform Administration
 * operational/commercial HTTP surface, following the exact convention
 * `backend/src/http/dto.ts` already establishes for invitation/pairing
 * DTOs: every field hand-listed (never spread a domain record directly
 * over HTTP), `Date` -> `.toISOString()`, money -> `MoneyJson` via
 * `billing/money.ts`'s `moneyToJson` (amountMinor always a decimal
 * string on the wire, never a JS number, never a raw bigint).
 */

import { moneyToJson } from '../../billing/money.js';
import type { Money, MoneyJson } from '../../billing/money.js';

export function dateToJson(value: Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toISOString();
}

export function moneyOrNullToJson(value: Money | null | undefined): MoneyJson | null {
  if (value === null || value === undefined) return null;
  return moneyToJson(value);
}

/** `entitlements/types.ts`'s QuoteSnapshot/entitlement-request quote fields carry `amountMinor: bigint` directly (not a `Money` object) -- convert the same way `moneyToJson` does, never `JSON.stringify` a bigint. */
export function bigintAmountToJson(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString(10);
}
