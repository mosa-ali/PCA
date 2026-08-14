/**
 * PCA-PA-2's narrow, provider/domain-neutral pricing-resolution boundary
 * (Section 12's port-abstraction principle, applied to pricing rather than
 * payment). This lane does NOT implement Billing Core (Plan/PriceBook/Quote
 * -- PCA-BILL-1, Agent44's exclusive scope): it defines only the shape a
 * future PriceBook-backed adapter must satisfy, plus a placeholder
 * implementation that always requires a custom admin quote, matching
 * reality (no PriceBook exists in this repository today).
 */

export interface StandardQuoteResolution {
  kind: 'STANDARD';
  quoteId: string;
  targetDeviceLimit: number;
  amountMinor: bigint;
  currencyCode: string;
  priceBookVersion: string;
  expiresAt: Date;
}

export interface RequiresCustomQuoteResolution {
  kind: 'REQUIRES_CUSTOM_QUOTE';
}

export type QuoteResolution = StandardQuoteResolution | RequiresCustomQuoteResolution;

export interface ResolveStandardQuoteInput {
  commercialMarket: string;
  currencyCode: string;
  targetDeviceLimit: number;
}

export interface QuotePort {
  /** PCA-ADD-PA-050's standard path: a PriceBook row lookup keyed by (market, currency, targetDeviceLimit). No row => REQUIRES_CUSTOM_QUOTE. */
  resolveStandardQuote(input: ResolveStandardQuoteInput): Promise<QuoteResolution>;
}

/**
 * Reference implementation for a repository with no PriceBook (PCA-BILL-1
 * not yet built): every standard-quantity lookup is treated as having no
 * published price, routing every managed-device increase request through
 * the custom-quote (PENDING_ADMIN_QUOTE) path until a real PriceBook-backed
 * adapter is wired in main.ts.
 */
export class NoPriceBookQuotePort implements QuotePort {
  async resolveStandardQuote(): Promise<QuoteResolution> {
    return { kind: 'REQUIRES_CUSTOM_QUOTE' };
  }
}
