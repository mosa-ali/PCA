/**
 * PCA Billing Core -- payment provider abstraction contract
 * (`PCA-ADD-BILL-027`/028). This file defines ONLY the interface boundary --
 * there is no concrete implementation anywhere in this lane, and this
 * module imports zero payment-provider SDK (no Stripe/PayPal/Mastercard/
 * bank-gateway package is a dependency of this repository at all -- see
 * backend/package.json, unchanged by this lane).
 *
 * Every Billing domain component that would eventually collect a payment,
 * verify a webhook, query authoritative payment status, or issue a refund
 * interacts with a payment provider ONLY through this interface -- never
 * through a provider-SDK call scattered directly in business logic
 * (`PCA-NFR-050`'s adapter-separation principle, restated for Billing).
 *
 * `PAYMENT_PROVIDER_SELECTION` (which concrete provider(s) PCA integrates
 * with) is an explicit external commercial gate (Section 19.2) this lane
 * does not, and must not, close -- see this mission's final report's
 * PAYMENT_PROVIDER_IMPLEMENTED/PAYMENT_PROVIDER_SELECTION fields.
 */

export interface CreateCheckoutInput {
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly accountRef: string;
  readonly paymentAttemptId: string;
  readonly returnUrl?: string;
}

export interface CreateCheckoutResult {
  readonly providerCheckoutRef: string;
  readonly redirectUrl: string;
}

export interface VerifyWebhookInput {
  readonly rawPayload: Buffer;
  readonly signatureHeader: string;
}

export interface VerifyWebhookResult {
  readonly verified: boolean;
  readonly providerEventId?: string;
  readonly eventKind?: string;
}

export interface QueryPaymentResult {
  readonly providerPaymentRef: string;
  readonly status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  readonly amountMinor: bigint;
  readonly currencyCode: string;
}

export interface RefundResult {
  readonly providerRefundRef: string;
  readonly status: 'PENDING' | 'CONFIRMED' | 'FAILED';
}

/**
 * A payment provider adapter. No implementation of this interface exists in
 * this lane -- PCA-BILL-2 (blocked externally on `PAYMENT_PROVIDER_SELECTION`)
 * is where a concrete adapter (e.g. Stripe, a regional gateway) would be
 * written against this same interface.
 */
export interface PaymentProvider {
  readonly providerName: string;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult>;
  queryPayment(providerPaymentRef: string): Promise<QueryPaymentResult>;
  refund(providerPaymentRef: string, amountMinor: bigint, reason: string): Promise<RefundResult>;
}
