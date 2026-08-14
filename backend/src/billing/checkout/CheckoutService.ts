/**
 * PCA-BILL-2A -- family-facing checkout-session creation and status
 * lookup. Orchestrates (never re-implements) PCA-BILL-1's PaymentService
 * and PCA-PA-2's ChangeRequestService: this file contains no pricing logic
 * and no payment-state-machine logic of its own.
 */
import { runInTransaction } from '../../db/pool.js';
import type { PaymentRepository, PaymentService } from '../payment.js';
import type { ChangeRequestRepository } from '../../entitlements/requests/ChangeRequestRepository.js';
import { ChangeRequestService } from '../../entitlements/requests/ChangeRequestService.js';
import type { PaymentProviderRegistry } from '../provider/providerRegistry.js';
import { bridgeEntitlementQuoteToPriceSnapshot, UnbridgeableQuoteError } from './quoteBridge.js';

export type CheckoutErrorCode =
  | 'REQUEST_NOT_FOUND'
  | 'NOT_QUOTED'
  | 'UNSUPPORTED_CURRENCY'
  | 'UNKNOWN_PROVIDER'
  | 'PROVIDER_CHECKOUT_FAILED'
  | 'LIFECYCLE_TRANSITION_FAILED';

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;
  constructor(code: CheckoutErrorCode, message?: string) {
    super(message ?? `Checkout session could not be created: ${code}`);
    this.name = 'CheckoutError';
    this.code = code;
  }
}

export interface CreateCheckoutSessionInput {
  readonly familyId: string;
  readonly requestId: string;
  readonly provider?: string;
  readonly returnUrl?: string;
}

export interface CreateCheckoutSessionResult {
  readonly paymentAttemptId: string;
  readonly provider: string;
  readonly redirectUrl: string;
  readonly status: 'PENDING';
}

export interface CheckoutStatusResult {
  readonly paymentAttemptId: string;
  readonly status: string;
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly increaseRequestRef: string | null;
}

/**
 * DEVICE-INCREASE-CHECKOUT lifecycle: this service creates a PaymentAttempt
 * from an already-QUOTED entitlement change-request, asks the resolved
 * PaymentProvider to open a checkout session, and moves the change-request
 * to PAYMENT_PENDING -- but it NEVER confirms a payment or activates an
 * entitlement itself. Only the webhook pipeline (webhook/WebhookService.ts),
 * driven by an authoritative server-to-server provider event, can do that
 * (Section 7 of the mission this module implements: no client redirect can
 * ever mark anything paid).
 */
export class CheckoutService {
  constructor(
    private readonly changeRequestRepository: ChangeRequestRepository,
    private readonly changeRequestService: ChangeRequestService,
    private readonly paymentService: PaymentService,
    private readonly paymentRepository: PaymentRepository,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    const record = await this.changeRequestRepository.getById(input.requestId);
    // Deliberately the SAME error code for "not found" and "belongs to a
    // different family" -- mirrors authz/AuthzService.ts's single-code
    // discipline: a caller must never be able to distinguish "this request
    // doesn't exist" from "this request exists but isn't yours".
    if (!record || record.familyId !== input.familyId) throw new CheckoutError('REQUEST_NOT_FOUND');
    if (record.state !== 'QUOTED' || !record.quote) throw new CheckoutError('NOT_QUOTED');

    let snapshot;
    try {
      snapshot = bridgeEntitlementQuoteToPriceSnapshot(record);
    } catch (error) {
      if (error instanceof UnbridgeableQuoteError) throw new CheckoutError('UNSUPPORTED_CURRENCY', error.message);
      throw error;
    }

    const providerName = input.provider ?? 'TEST_SANDBOX';
    let provider;
    try {
      provider = this.providerRegistry.resolve(providerName);
    } catch {
      throw new CheckoutError('UNKNOWN_PROVIDER');
    }

    const now = this.now();
    const attempt = await this.paymentService.createAttemptFromSnapshot(
      { accountRef: input.familyId, invoiceId: null, increaseRequestRef: input.requestId, paymentMethodId: null },
      snapshot,
      now,
    );

    let checkoutResult;
    try {
      checkoutResult = await provider.createCheckout({
        amountMinor: attempt.price.amountMinor,
        currencyCode: attempt.price.currencyCode,
        accountRef: attempt.accountRef,
        paymentAttemptId: attempt.paymentAttemptId,
        returnUrl: input.returnUrl,
      });
    } catch (error) {
      // Never leave an attempt indefinitely CREATED if the provider call
      // itself failed -- mark it FAILED so it cannot later be confused
      // with an attempt still genuinely awaiting a provider redirect.
      await this.paymentService.markFailed(attempt.paymentAttemptId, now);
      throw new CheckoutError('PROVIDER_CHECKOUT_FAILED', error instanceof Error ? error.message : undefined);
    }

    const transitioned = await runInTransaction((conn) =>
      this.paymentRepository.transitionStatus(conn, attempt.paymentAttemptId, ['CREATED'], 'PENDING', providerName, checkoutResult.providerCheckoutRef),
    );
    if (!transitioned) throw new CheckoutError('PROVIDER_CHECKOUT_FAILED', 'attempt was not in CREATED status immediately after creation');

    try {
      await this.changeRequestService.moveToPaymentPending(input.requestId);
    } catch (error) {
      // The PaymentAttempt/checkout session DOES exist at this point --
      // this is a genuine cross-service anomaly (the request's own
      // lifecycle state could not follow), not a crash. Surfaced as a
      // clean, typed error rather than propagating ChangeRequestService's
      // internal error type; see this lane's final report's KNOWN_GAPS for
      // why this narrow window (attempt PENDING but request not yet
      // PAYMENT_PENDING) is accepted rather than eliminated.
      throw new CheckoutError('LIFECYCLE_TRANSITION_FAILED', error instanceof Error ? error.message : undefined);
    }

    return {
      paymentAttemptId: attempt.paymentAttemptId,
      provider: providerName,
      redirectUrl: checkoutResult.redirectUrl,
      status: 'PENDING',
    };
  }

  /** Family-facing, read-only. Never callable to mark a payment confirmed -- only reads state the webhook pipeline already wrote. */
  async getCheckoutStatus(familyId: string, paymentAttemptId: string): Promise<CheckoutStatusResult> {
    const attempt = await runInTransaction((conn) => this.paymentRepository.findAttemptById(conn, paymentAttemptId));
    if (!attempt || attempt.accountRef !== familyId) throw new CheckoutError('REQUEST_NOT_FOUND');
    return {
      paymentAttemptId: attempt.paymentAttemptId,
      status: attempt.status,
      amountMinor: attempt.price.amountMinor.toString(10),
      currencyCode: attempt.price.currencyCode,
      increaseRequestRef: attempt.increaseRequestRef,
    };
  }
}
