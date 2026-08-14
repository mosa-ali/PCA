// PCA-MYKIDS-BILL-1: parent-facing billing/entitlement domain types (doc
// PCA_ADDENDUM_002 Section 18/18.1). These are the wire-safe shapes a real
// HTTP implementation of BillingClient would receive -- money always
// crosses as a decimal STRING (never a float), mirroring
// backend/src/billing/money.ts's MoneyJson boundary (PCA-ADD-BILL-017) and
// backend/src/entitlements/types.ts's EntitlementReadModel/
// EntitlementChangeRequestRecord/QuoteSnapshot shapes. Dates cross as ISO
// 8601 UTC strings, never a Date instance (JSON-safe, matches the rest of
// this codebase's domain/types.ts convention).

/** PCA-ADD-BILL-019: USD (global/default), SAR (Gulf), YER (Yemen). EUR is explicitly out of initial scope (PCA-DEC-024). */
export const SUPPORTED_CURRENCIES = ['USD', 'SAR', 'YER'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** PCA-ADD-BILL-017: exact minor-unit integer as a decimal string, paired with an explicit currency code. Never a JS number/float. */
export interface MoneyJson {
  readonly amountMinor: string;
  readonly currencyCode: CurrencyCode;
}

/** PCA-ADD-BILL-018: all three initial currencies use 2 minor-unit decimal places. Single source of truth -- never re-derived per call site. */
const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = { USD: 2, SAR: 2, YER: 2 };

/**
 * Locale-aware exact-money display. All arithmetic here is exact BigInt
 * integer division/remainder on the minor-unit amount -- the only place a
 * JS `number` appears is the unavoidable last step of handing a decimal
 * string to Intl.NumberFormat for locale-correct symbol/grouping rendering,
 * never for computing the amount itself (PCA-ADD-BILL-017 bans float
 * arithmetic/storage/transport; it does not, and cannot, forbid the
 * platform's own currency-formatting API from accepting a number).
 */
export function formatMoney(money: MoneyJson, locale: string): string {
  const exponent = MINOR_UNIT_EXPONENT[money.currencyCode];
  const minor = BigInt(money.amountMinor);
  const negative = minor < 0n;
  const absMinor = negative ? -minor : minor;
  const divisor = 10n ** BigInt(exponent);
  const whole = absMinor / divisor;
  const fraction = absMinor % divisor;
  const decimalStr = `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(exponent, '0')}`;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currencyCode,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  return formatter.format(Number(decimalStr));
}

export function isZeroMoney(money: MoneyJson): boolean {
  return BigInt(money.amountMinor) === 0n;
}

export type LimitType = 'PARENT_MEMBER_LIMIT' | 'MANAGED_DEVICE_LIMIT';

/** PCA-ADD-PA-030: the full increase-request lifecycle, binding for both billable and non-billable requests. */
export type EntitlementChangeRequestState =
  | 'PENDING'
  | 'QUOTED'
  | 'PAYMENT_PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'CANCELLED';

export type QuoteKind = 'STANDARD' | 'CUSTOM';

/** PCA-ADD-BILL-043: immutable price snapshot attached at the QUOTED transition. Never re-derived from a live PriceBook after the fact. */
export interface QuoteSnapshot {
  readonly quoteKind: QuoteKind;
  readonly quoteRef: string;
  readonly price: MoneyJson;
  readonly priceBookVersion: number | null;
  readonly quotedAtUtc: string;
  readonly expiresAtUtc: string | null;
}

export interface EntitlementChangeRequest {
  readonly requestId: string;
  readonly limitType: LimitType;
  readonly currentLimitAtRequest: number;
  readonly targetLimit: number;
  readonly state: EntitlementChangeRequestState;
  /** PCA-ADD-PA-050's custom path: true while PENDING and awaiting a FINANCE_ADMIN/APP_OWNER-issued Quote (the family-visible "PENDING_ADMIN_QUOTE" condition). */
  readonly awaitingAdminQuote: boolean;
  readonly quote: QuoteSnapshot | null;
  readonly noChargeOverride: boolean;
  readonly denialReason: string | null;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
}

/** PCA-ADD-PA-029: metadata-only entitlement read model -- never carries family activity/policy content. */
export interface EntitlementSnapshot {
  readonly tier: string;
  readonly parentMemberLimit: number;
  readonly parentMemberUsed: number;
  readonly managedDeviceLimit: number;
  readonly managedDeviceActive: number;
  readonly managedDeviceReserved: number;
  readonly availableDeviceSlots: number;
  readonly overLimitParentMember: boolean;
  readonly overLimitManagedDevice: boolean;
  readonly openRequests: readonly EntitlementChangeRequest[];
}

export const FREE_STARTER_TIER = 'FREE_STARTER';

export type SubscriptionStatus = 'FREE_STARTER' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export interface SubscriptionSnapshot {
  readonly status: SubscriptionStatus;
  readonly planLabel: string;
  readonly currentPeriodEndUtc: string | null;
  readonly autoRenew: boolean;
}

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
export type InvoiceLineType = 'PLAN_CHARGE' | 'PRORATION' | 'DEVICE_LIMIT_INCREASE' | 'CREDIT' | 'OTHER';

export interface InvoiceLine {
  readonly description: string;
  readonly lineType: InvoiceLineType;
  readonly amount: MoneyJson;
  readonly quantity: number;
}

export interface Invoice {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly total: MoneyJson;
  readonly createdAtUtc: string;
  readonly periodStartUtc: string | null;
  readonly periodEndUtc: string | null;
  readonly lines: readonly InvoiceLine[];
}

/** PCA-ADD-BILL-008/024: provider-safe metadata only -- never a PAN, CVV, or raw credential. */
export interface PaymentMethodSummary {
  readonly paymentMethodId: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly expiryMonth: number | null;
  readonly expiryYear: number | null;
  readonly displayLabel: string;
}

const SUGGESTED_DEVICE_TARGETS = [2, 3, 5] as const;

export function suggestedDeviceTargets(currentLimit: number): number[] {
  return SUGGESTED_DEVICE_TARGETS.filter((n) => n > currentLimit);
}

export function isQuoteExpired(quote: QuoteSnapshot, nowUtc: string): boolean {
  return quote.expiresAtUtc !== null && quote.expiresAtUtc <= nowUtc;
}
