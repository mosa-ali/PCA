/**
 * PCA-MYKIDS-BILL-2 -- the real, PriceBook-backed QuotePort adapter.
 *
 * NoPriceBookQuotePort (QuotePort.ts, PCA-PA-2) was an honest placeholder:
 * "no PriceBook exists in this repository today." PCA-BILL-1 (Agent44) has
 * since built billing/priceBook.ts's `PriceBookRepository`. This adapter
 * closes that gap by composing (never duplicating) that repository: it
 * calls `PriceBookRepository.findActiveAt` directly -- the REPOSITORY
 * layer, not `PriceBookService` -- because `PriceBookService`'s every
 * method is gated by `requireBillingOperation(roles, 'VIEW_PRICE_BOOK')`,
 * which demands a `PlatformAdminRole` (APP_OWNER/PLATFORM_ADMIN/
 * FINANCE_ADMIN/AUDITOR_READ_ONLY -- billing/rbac.ts). A family-facing
 * caller holds none of those roles, and this mission explicitly forbids
 * granting a family a fake FINANCE_ADMIN role just to reach that read.
 * `findActiveAt` itself performs no RBAC check (it is a narrow, read-only,
 * already-family-safe lookup keyed only by market/currency/quantity/asOf --
 * it does not expose price history, draft rows, or admin metadata like
 * createdByAdminId), so calling it directly here is the least-privilege
 * path this mission asks for, not an RBAC bypass of anything that actually
 * gates family-sensitive data.
 *
 * This module implements ENTITLEMENTS' OWN `QuotePort` interface
 * (entitlements/quote/QuotePort.ts, PCA-PA-2's narrow pricing-resolution
 * boundary) -- it does not touch, extend, or reimplement PCA-BILL-1's own
 * `QuoteService.resolveStandardQuote` (billing/quote.ts), which is a
 * separate, ADMINISTER_BILLING_RECORDS-shaped surface for a different
 * purpose (custom Quote issuance audit trail). See
 * billing/checkout/quoteBridge.ts's header for why entitlements' and
 * billing-core's quote shapes are deliberately two independent concepts
 * bridged only at checkout time, never merged.
 *
 * NO HARDCODED PRICING: every amountMinor/currencyCode/priceBookVersion
 * this adapter returns comes verbatim from a real `billing_price_books` row
 * an App Owner/Finance Admin published (priceBook.ts's own header: "NO
 * PRICE LITERAL IS EVER HARDCODED IN THIS FILE"). No row for the requested
 * (market, currency, targetDeviceLimit) key => REQUIRES_CUSTOM_QUOTE, never
 * a fallback/derived price (matches billing/quote.ts's `QuoteService`'s own
 * "Billing Core never invents fallback pricing" discipline).
 */
import { runInTransaction } from '../../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';
import type { PriceBookRepository } from '../../billing/priceBook.js';
import { isCommercialMarket } from '../../billing/market.js';
import type { CommercialMarket } from '../../billing/market.js';
import { isSupportedCurrency } from '../../billing/currency.js';
import type { CurrencyCode } from '../../billing/currency.js';
import type { QuotePort, QuoteResolution, ResolveStandardQuoteInput } from './QuotePort.js';

/**
 * A standard, PriceBook-backed quote is re-resolved from the live,
 * currently-ACTIVE PriceBook row every time (it is not itself a durable
 * billing_quotes row -- see this file's header on why quoteId is a
 * priceBookId, not a billing_quotes.quote_id). This window bounds how long
 * the entitlement change-request's OWN immutable QuoteSnapshot (attached at
 * resolution time, entitlements/types.ts's QuoteSnapshot) is presented to
 * the family as payable before ChangeRequestService's own quote-expiry
 * handling requires a fresh resolution -- mirrors QUOTE_VALIDITY semantics
 * already established for custom quotes (ChangeRequestService's
 * CUSTOM_QUOTE_TTL_MS), scaled down because a standard price is expected to
 * be far more stable/frequently re-checked than an admin-issued custom one.
 */
export const STANDARD_QUOTE_VALIDITY_MS = 24 * 60 * 60 * 1000;

export type TransactionRunner = <T>(fn: (conn: PoolConnection) => Promise<T>) => Promise<T>;

export class PriceBookQuotePort implements QuotePort {
  constructor(
    private readonly priceBookRepository: PriceBookRepository,
    private readonly now: () => Date = () => new Date(),
    // Injectable seam (defaults to the real db/pool.js runInTransaction in
    // production): lets a unit test exercise this adapter's own
    // market/currency/target validation and STANDARD/REQUIRES_CUSTOM_QUOTE
    // branching against a fake PriceBookRepository, with no real MySQL
    // connection -- mirrors this codebase's existing `now: () => Date`
    // injection convention for the same reason.
    private readonly runQuery: TransactionRunner = runInTransaction,
  ) {}

  async resolveStandardQuote(input: ResolveStandardQuoteInput): Promise<QuoteResolution> {
    // Defensive: an unrecognized market/currency can never resolve a
    // standard quote (there is no row keyed by an invalid value) -- routed
    // through REQUIRES_CUSTOM_QUOTE exactly like "no row found," never a
    // thrown validation error from inside a QuotePort implementation (the
    // caller, ChangeRequestService.createRequest, does not catch here).
    if (!isCommercialMarket(input.commercialMarket)) return { kind: 'REQUIRES_CUSTOM_QUOTE' };
    if (!isSupportedCurrency(input.currencyCode)) return { kind: 'REQUIRES_CUSTOM_QUOTE' };
    if (!Number.isInteger(input.targetDeviceLimit) || input.targetDeviceLimit < 1) return { kind: 'REQUIRES_CUSTOM_QUOTE' };

    const asOf = this.now();
    const market: CommercialMarket = input.commercialMarket;
    const currency: CurrencyCode = input.currencyCode;
    const row = await this.runQuery((conn) => this.priceBookRepository.findActiveAt(conn, market, currency, input.targetDeviceLimit, asOf));
    if (!row) return { kind: 'REQUIRES_CUSTOM_QUOTE' };

    return {
      kind: 'STANDARD',
      // Opaque, non-FK reference to the exact PriceBook row/version this
      // quote was resolved against -- NOT a billing_quotes.quote_id (no
      // billing-core Quote row is minted for a standard resolution; see
      // this file's header and quoteBridge.ts's identical decision for
      // entitlements-issued quotes generally).
      quoteId: `price-book:${row.priceBookId}`,
      targetDeviceLimit: input.targetDeviceLimit,
      amountMinor: row.price.amountMinor,
      currencyCode: row.price.currencyCode,
      priceBookVersion: row.priceBookVersion,
      expiresAt: new Date(asOf.getTime() + STANDARD_QUOTE_VALIDITY_MS),
    };
  }
}
