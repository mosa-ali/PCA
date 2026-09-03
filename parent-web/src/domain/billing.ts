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

/**
 * PCA-MYKIDS-BILL-3: the checkout-CREATE response
 * (`billingCheckoutRoutes.ts`'s `POST .../billing/checkout`). `redirectUrl`
 * is where the browser must actually go next -- never treated as proof of
 * anything itself (see `isSameOriginRedirect` below and
 * `pages/billing/DeviceIncreaseRequest.tsx`'s handoff logic). `status` is
 * always `'PENDING'` on creation; the authoritative post-redirect state is
 * only ever read back via `getCheckoutStatus`/`getRequest`, never assumed
 * from this response.
 */
export interface CheckoutSession {
  readonly paymentAttemptId: string;
  readonly provider: string;
  readonly redirectUrl: string;
  readonly status: 'PENDING';
}

/**
 * PCA-MYKIDS-BILL-3: `GET .../billing/checkout/:paymentAttemptId` -- polling
 * only, never authoritative confirmation on its own (a browser return/redirect
 * proves nothing; see PCA-ADD-BILL-035). `status` is the raw provider-attempt
 * status string (not a fixed union on the wire), `amount` is reassembled
 * client-side from the wire's separate `amountMinor`(decimal string)/
 * `currencyCode` fields into a single `MoneyJson` for consistent formatting
 * with the rest of this module -- `amountMinor` is never parsed as a JS
 * number anywhere in this reassembly.
 */
export interface CheckoutStatus {
  readonly paymentAttemptId: string;
  readonly status: string;
  readonly amount: MoneyJson;
  readonly increaseRequestRef: string | null;
}

/**
 * Closed, DB-CHECK-mirrored notification event-type union (contract
 * MYKIDS_COMMERCIAL_API_V1 "Commercial notifications" section).
 * `QUOTE_EXPIRED` is a legal wire value with a message-key mapping but is
 * never actually published by any backend call site today -- it must be
 * handled in any type switch (it's legal) but no UX flow may assume it ever
 * fires (SOURCE_RUNTIME_GAP per the round charter).
 */
export type CommercialNotificationEventType =
  | 'QUOTE_READY'
  | 'PAYMENT_CONFIRMED'
  | 'ENTITLEMENT_INCREASED'
  | 'PAYMENT_FAILED'
  | 'REQUEST_DENIED'
  | 'QUOTE_EXPIRED';

export type CommercialNotificationParamValue = string | number | boolean | null;

export interface CommercialNotification {
  readonly notificationId: string;
  readonly eventType: CommercialNotificationEventType;
  readonly resourceRef: string | null;
  readonly messageKey: string;
  readonly params: Record<string, CommercialNotificationParamValue> | null;
  readonly createdAtUtc: string;
  readonly readAtUtc: string | null;
  readonly acknowledgedAtUtc: string | null;
}

/**
 * Loopback hosts, the only ones for which a plain-`http:` cross-origin
 * handoff is accepted. This is what the local dev/e2e stack actually looks
 * like (vite on http://localhost:4000, backend on http://localhost:4001);
 * outside loopback a downgraded `http:` handoff is refused.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The ONLY schemes this app will ever hand the whole browser to. A real
 * payment-provider handoff is always `https:`. There is deliberately no
 * fall-through: a scheme that is not on this list is not "unknown", it is
 * refused.
 */
function isHandoffScheme(parsed: URL): boolean {
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname);
}

/**
 * Decides whether a checkout `redirectUrl` must be a real, full-page browser
 * navigation (a different origin than this SPA -- the genuine payment-
 * provider handoff case, including the backend-hosted TEST_SANDBOX status
 * route) versus an in-app path this SPA's own router should handle (the
 * DevBillingClient fixture case, which never leaves the SPA). Never used to
 * infer payment success either way -- see this module's `CheckoutSession`
 * doc comment and PCA-ADD-BILL-035.
 *
 * WHICH ANSWER IS THE SAFE ONE MATTERS. `pages/billing/DeviceIncreaseRequest
 * .tsx` turns `false` into `window.location.assign(redirectUrl)` -- it hands
 * the whole browser to that string. `false` is therefore the PRIVILEGED
 * answer and is only ever returned for a target this function has positively
 * classified as a legitimate different-origin handoff: parseable, an
 * allow-listed scheme (`https:`, or `http:` on loopback for local dev), and
 * an origin that really does differ from ours. Everything this function
 * cannot positively classify that way -- a `javascript:`/`data:`/`vbscript:`
 * URL, an unparseable string, a plain-`http:` non-loopback host -- returns
 * `true` and stays inside the SPA's own router. That is what closes the
 * `javascript:alert(1)` hole: `new URL('javascript:alert(1)').origin` is the
 * string `'null'`, which never equals a real origin, so the previous version
 * returned `false` and the call site assigned the `javascript:` URL straight
 * into the address bar. In production a `script-src 'self'` CSP happened to
 * block that, but the CSP plugin is `apply: 'build'`, so a dev build carried
 * no CSP at all and nothing stopped it.
 *
 * KNOWN RESIDUAL (needs a change in the CALL SITE, not here): a
 * protocol-relative `//evil.com/pay` is refused the handoff by this function
 * (it returns `true`), but the call site then does
 * `redirectUrl.startsWith('/') ? navigate(redirectUrl) : navigate(<constant>)`
 * -- and `//evil.com/pay` passes that `startsWith('/')` test, so react-router
 * pushes it, `history.pushState` throws a cross-origin SecurityError, and
 * react-router's own fallback (`react-router/dist/.../history` push catch
 * block) calls `window.location.assign(url)`. Closing that requires the call
 * site to exclude `//` and `/\` from its own `startsWith('/')` check the same
 * way this function does.
 */
export function isSameOriginRedirect(redirectUrl: string, currentOrigin: string): boolean {
  if (typeof redirectUrl !== 'string' || redirectUrl === '') return true;

  // Protocol-relative. '//host/x' resolves to a DIFFERENT origin, and so does
  // '/\host/x' because browsers normalise a backslash to a slash -- verified:
  //   new URL('/\\evil.com/x', 'https://parent.pca.app').href
  //     === 'https://evil.com/x'
  // So neither is the in-app path the old `startsWith('/')` short-circuit
  // took them for. Neither is a legitimate handoff either (a real provider
  // URL always carries an explicit scheme), so both are refused the handoff.
  if (redirectUrl.startsWith('//') || redirectUrl.startsWith('/\\')) return true;

  // A genuine root-relative in-app path: exactly one leading slash.
  if (redirectUrl.startsWith('/')) return true;

  let parsed: URL;
  try {
    parsed = new URL(redirectUrl, currentOrigin);
  } catch {
    return true;
  }
  if (!isHandoffScheme(parsed)) return true;
  return parsed.origin === currentOrigin;
}

/** Reassembles a wire-safe `{amountMinor, currencyCode}` pair into a `MoneyJson`, validating the currency against the closed supported set -- never silently coerces an unsupported code. */
export function toMoneyJson(amountMinor: string, currencyCode: string): MoneyJson {
  if (!isSupportedCurrency(currencyCode)) {
    throw new Error(`Unsupported currency code from server: ${currencyCode}`);
  }
  // Validates the decimal-integer-string shape without ever converting it to
  // a JS number -- BigInt() throws on anything that isn't an exact integer
  // literal (no exponents, no fractional part), which is exactly the
  // decimal-integer-string contract moneyToJson/bigintAmountToJson produce.
  BigInt(amountMinor);
  return { amountMinor, currencyCode };
}
