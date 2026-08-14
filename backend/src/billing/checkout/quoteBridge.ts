/**
 * PCA-BILL-2A -- the entitlements-lane <-> billing-core quote-shape bridge.
 *
 * CROSS-LANE SEAM (read this before changing anything here): PCA-PA-2's
 * `QuoteSnapshot` (backend/src/entitlements/types.ts) and PCA-BILL-1's
 * `PriceSnapshot` (backend/src/billing/quote.ts) describe the SAME concept
 * (an immutable, already-resolved price for a quantity) but are two
 * independently-owned shapes:
 *
 *   - entitlements' QuoteSnapshot: { quoteKind, quoteRef, amountMinor,
 *     currencyCode, priceBookVersion, quotedAt, expiresAt } -- no
 *     targetDeviceLimit of its own (that lives on the parent
 *     EntitlementChangeRequestRecord.targetLimit), and NO billing-core
 *     Quote/PriceBook row ever backs it: ChangeRequestService.createRequest
 *     resolves STANDARD quotes through its OWN `QuotePort`
 *     (entitlements/quote/QuotePort.ts), which is an independent
 *     placeholder with no real PriceBook wiring today (see that file's own
 *     header), and issueCustomQuote mints its own `quoteRef` string
 *     (`custom-quote:<uuid>`) that is NOT a billing_quotes.quote_id.
 *
 *   - billing-core's PriceSnapshot: { targetDeviceLimit, price,
 *     priceBookId, priceBookVersion, quoteId, quotedAt, expiresAt } --
 *     quoteId/priceBookId are REAL foreign keys into billing_quotes /
 *     billing_price_books when set (payment.ts's createAttemptFromSnapshot
 *     consumes a billing_quotes row transactionally whenever quoteId is
 *     non-null).
 *
 * DECISION (documented per the mission's instruction to make this bridging
 * choice explicit): this bridge ALWAYS maps quoteId -> null and
 * priceBookId -> null, regardless of quoteKind (STANDARD or CUSTOM). It
 * does NOT create a lightweight billing-core Quote row to "back" an
 * entitlements-issued quote. Reasoning:
 *   1. Fabricating a billing_quotes row purely to satisfy a foreign key
 *      would misrepresent provenance -- that row would claim to be
 *      "issued by admin X via billing/quote.ts" when it was actually
 *      resolved/issued by the entitlements lane's own, independent quote
 *      authority.
 *   2. payment.ts's createAttemptFromSnapshot's quote-consumption behavior
 *      is conditional on quoteId being set precisely so that a snapshot
 *      with no billing-core Quote behind it (this case) skips that step
 *      cleanly -- there is nothing to consume.
 *   3. priceBookVersion is still carried through (from
 *      QuoteSnapshot.priceBookVersion) even though priceBookId is null,
 *      because PaymentConfirmationService/BillingEntitlementSignal treat
 *      priceBookVersion as an independent, range-validated integer
 *      (assertValidPriceBookVersion), not something that requires a live
 *      priceBookId join.
 *
 * A future lane that gives entitlements' QuotePort a REAL PriceBook-backed
 * implementation could revisit this (a STANDARD quote could then carry a
 * genuine priceBookId), but that is out of this lane's scope.
 */
import { money } from '../money.js';
import { isSupportedCurrency } from '../currency.js';
import type { PriceSnapshot } from '../quote.js';
import type { EntitlementChangeRequestRecord } from '../../entitlements/types.js';

export class UnbridgeableQuoteError extends Error {
  constructor(reason: string) {
    super(`Cannot bridge entitlement change-request quote to a billing PriceSnapshot: ${reason}`);
    this.name = 'UnbridgeableQuoteError';
  }
}

/**
 * Converts an entitlement change-request's attached QuoteSnapshot into a
 * billing-core PriceSnapshot suitable for PaymentService.createAttemptFromSnapshot.
 * Throws UnbridgeableQuoteError if the request has no quote attached (not
 * in QUOTED state) or if the quote's currency is not one billing-core
 * itself supports (billing/currency.ts's SUPPORTED_CURRENCIES) -- Billing
 * Core never silently substitutes or truncates an unsupported currency.
 */
export function bridgeEntitlementQuoteToPriceSnapshot(request: EntitlementChangeRequestRecord): PriceSnapshot {
  const quote = request.quote;
  if (!quote) throw new UnbridgeableQuoteError('request has no attached quote');
  if (!isSupportedCurrency(quote.currencyCode)) {
    throw new UnbridgeableQuoteError(`unsupported currency code: ${quote.currencyCode}`);
  }
  return {
    targetDeviceLimit: request.targetLimit,
    price: money(quote.amountMinor, quote.currencyCode),
    priceBookId: null,
    priceBookVersion: quote.priceBookVersion,
    quoteId: null,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
  };
}
