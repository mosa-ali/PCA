/**
 * PCA Billing Core -- the Billing <-> Entitlement output contract
 * (constraint 14). A provider-independent DTO/domain contract describing
 * what Billing Core can tell an entitlement-owning lane about a
 * device-limit-increase payment -- READ-ONLY output shape from Billing
 * Core's perspective. Billing Core never writes to any entitlement table
 * (none exists in this lane's schema -- see migration 0007's own header)
 * and this file has no dependency on, and is not imported by, any
 * entitlements module.
 *
 * `increaseRequestRef` is Billing Core's own bounded opaque identifier
 * (mission constraint 13) -- it is never resolved, dereferenced, or
 * validated against any entitlement-request table by this lane; that is
 * exclusively the concern of whichever lane owns entitlement-change
 * requests.
 */

import type { CurrencyCode } from './currency.js';

export interface BillingEntitlementSignal {
  /** Opaque identifier of the entitlement increase-request this payment corresponds to, if any (bounded VARCHAR, no FK -- see billing_quotes.increase_request_ref / billing_payment_attempts.increase_request_ref). */
  readonly increaseRequestRef: string | null;
  readonly targetDeviceLimit: number | null;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
  /** Identity of the quote/price this payment was snapshotted against (PCA-ADD-BILL-043). */
  readonly quoteId: string | null;
  readonly priceBookId: string | null;
  readonly priceBookVersion: number | null;
  readonly paymentAttemptId: string;
  /** Present only once the attempt has reached CONFIRMED. */
  readonly paymentTransactionId: string | null;
  /** Opaque provider/payment reference fields -- never a raw provider secret or payload. */
  readonly provider: string | null;
  readonly providerReference: string | null;
  readonly paymentAttemptStatus: 'CREATED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  readonly confirmedAt: string | null;
}
