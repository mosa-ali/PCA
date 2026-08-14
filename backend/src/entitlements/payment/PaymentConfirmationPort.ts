/**
 * PCA-PA-2's trusted server-side entitlement-activation boundary
 * (PCA-ADD-PA-032/049, PCA-ADD-BILL-035/046). This is NOT a public
 * parent-write API: no HTTP route in this lane exposes it, and no client
 * redirect can invoke it. It exists so a future, trusted server-side
 * Billing/Payment integration (Agent44's webhook handler, running inside
 * PCA's own backend, never reachable from a browser) has a single,
 * reviewed activation entrypoint to call once it has ALREADY verified
 * payment server-side (Section 13) -- this port performs no payment
 * verification itself; it only applies an already-confirmed payment's
 * effect atomically and idempotently.
 */

export interface PaymentConfirmationInput {
  requestId: string;
  /** Derived from the payment/provider event id -- PCA-ADD-BILL-046: never from requestId alone. */
  idempotencyKey: string;
  targetDeviceLimit: number;
  amountMinor: bigint;
  currencyCode: string;
  quoteRef: string | null;
  priceBookVersion: string | null;
  /** Opaque reference to the settled payment; audit-only, never a raw provider secret. */
  paymentTransactionId: string;
}

export type PaymentConfirmationOutcome =
  | 'ACTIVATED'
  | 'ALREADY_ACTIVATED'
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_NOT_PAYMENT_PENDING'
  | 'AMOUNT_MISMATCH';

export interface PaymentConfirmationResult {
  outcome: PaymentConfirmationOutcome;
  appliedManagedDeviceLimit: number | null;
}

export interface PaymentConfirmationPort {
  confirmPayment(input: PaymentConfirmationInput): Promise<PaymentConfirmationResult>;
}
