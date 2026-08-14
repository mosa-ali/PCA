/**
 * PCA-BILL-2A -- family-facing checkout-session creation and status
 * lookup. Orchestrates (never re-implements) PCA-BILL-1's PaymentService
 * and PCA-PA-2's ChangeRequestService: this file contains no pricing logic
 * and no payment-state-machine logic of its own.
 *
 * PCA-BILL-2A-R1 CORRECTION (checkout split-state fix): the original
 * version of this file could durably create a PaymentAttempt, successfully
 * call the provider, and then fail to move the change-request to
 * PAYMENT_PENDING -- leaving a PaymentAttempt with no corresponding
 * request-state transition, and no safe way to retry (a naive retry would
 * create a SECOND orphaned PaymentAttempt).
 *
 * INVARIANT (now enforced): a checkout session is only ever returned to the
 * client once local state (PaymentAttempt + provider checkout ref + request
 * PAYMENT_PENDING transition) is durably consistent. No half-success is
 * ever visible to the client, and retrying `createCheckoutSession` for the
 * SAME requestId is always safe.
 *
 * IDEMPOTENCY ANCHOR: `requestId` (the entitlement change-request id) is
 * this lane's idempotency anchor for "this request's checkout attempt". A
 * request can only be in one checkout flow at a time -- ChangeRequestService's
 * own state machine only allows QUOTED -> PAYMENT_PENDING once, and this
 * lane never re-quotes a request that already has a live PaymentAttempt --
 * so `requestId` is a stable, caller-independent key a retry naturally
 * carries (the client re-POSTs the same requestId, not a client-invented
 * token). This is ALSO the idempotency key handed to the provider adapter
 * (`CreateCheckoutInput.idempotencyKey`, providerContract.ts) so a retried
 * provider call is idempotent at that layer too, independent of this
 * lane's own DB-level attempt-reuse.
 *
 * ORCHESTRATION SEQUENCE:
 *   1. Look up an existing, not-yet-terminal (CREATED/PENDING) PaymentAttempt
 *      for this requestId (shared/paymentAttemptLookup.ts) -- BEFORE ever
 *      calling PaymentService.createAttemptFromSnapshot or the provider.
 *   2. If none exists, create one transactionally (PaymentService.createAttemptFromSnapshot).
 *   3. Call provider.createCheckout with the requestId-derived idempotency
 *      key -- ALWAYS (even on a reused attempt): a provider that honors the
 *      key returns the SAME providerCheckoutRef/redirectUrl without minting
 *      new provider-side state, which is what lets this step be safely
 *      re-run on every retry (this also means a retry never needs a second,
 *      adapter-specific "did this already happen" query -- the adapter's
 *      own idempotency guarantee covers it).
 *   4. Durably persist the provider checkout ref onto the PaymentAttempt
 *      (PaymentRepository.transitionStatus, an existing accepted-file
 *      method this lane composes, not edits).
 *   5. Call ChangeRequestService.moveToPaymentPending. If the request is
 *      ALREADY PAYMENT_PENDING (the retry case: a prior attempt reached
 *      step 4 but died before/during step 5), this is treated as success,
 *      not as a fresh failure -- moveToPaymentPending's own guard clause
 *      only ever transitions FROM QUOTED, so a second literal call on an
 *      already-PAYMENT_PENDING request would otherwise throw INVALID_STATE
 *      even though the target state was already correctly reached.
 *   6. ONLY THEN return checkout details to the client.
 *
 * If step 5 fails (a genuine anomaly, not a "someone already succeeded"
 * race), this method throws CheckoutError('LIFECYCLE_TRANSITION_FAILED')
 * exactly as before -- the PaymentAttempt/provider ref already durably
 * exist, so the NEXT retry re-enters at step 1, finds them, skips step 2/3's
 * "create" halves, and goes straight back through step 3 (idempotent
 * provider replay) -> 4 (idempotent transition, already PENDING) -> 5
 * again. No step here can ever create a second PaymentAttempt or cause the
 * provider to mint a second distinct checkout object for the same
 * requestId.
 */
import { runInTransaction } from '../../db/pool.js';
import type { PaymentRepository, PaymentService } from '../payment.js';
import type { ChangeRequestRepository } from '../../entitlements/requests/ChangeRequestRepository.js';
import { ChangeRequestError, ChangeRequestService } from '../../entitlements/requests/ChangeRequestService.js';
import type { PaymentProviderRegistry } from '../provider/providerRegistry.js';
import { bridgeEntitlementQuoteToPriceSnapshot, UnbridgeableQuoteError } from './quoteBridge.js';
import { findActivePaymentAttemptByIncreaseRequestRef } from '../shared/paymentAttemptLookup.js';

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

/** The requestId-derived idempotency key handed to the provider adapter -- see this file's header. */
function checkoutIdempotencyKey(requestId: string): string {
  return `checkout:${requestId}`;
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

    // Step 1: idempotent reuse -- look up an existing not-yet-terminal
    // attempt for this request BEFORE creating anything or calling the
    // provider. This is what makes a retried createCheckoutSession call
    // for the SAME requestId safe.
    let attempt = await findActivePaymentAttemptByIncreaseRequestRef(input.requestId);

    if (!attempt) {
      // Fresh attempt: the request must be freshly QUOTED (no attempt yet
      // means no checkout flow has reached step 2 for this request before).
      if (record.state !== 'QUOTED' || !record.quote) throw new CheckoutError('NOT_QUOTED');

      let snapshot;
      try {
        snapshot = bridgeEntitlementQuoteToPriceSnapshot(record);
      } catch (error) {
        if (error instanceof UnbridgeableQuoteError) throw new CheckoutError('UNSUPPORTED_CURRENCY', error.message);
        throw error;
      }

      const now = this.now();
      attempt = await this.paymentService.createAttemptFromSnapshot(
        { accountRef: input.familyId, invoiceId: null, increaseRequestRef: input.requestId, paymentMethodId: null },
        snapshot,
        now,
      );
    } else if (record.state !== 'QUOTED' && record.state !== 'PAYMENT_PENDING') {
      // A reused attempt should only ever be found while the request is
      // still QUOTED (attempt created, provider/transition steps not yet
      // finished) or already PAYMENT_PENDING (steps 1-4 finished, step 5
      // is what's being retried) -- any other state is a genuine anomaly.
      throw new CheckoutError('NOT_QUOTED');
    }

    // Resolve the provider: on a reused attempt, the attempt's OWN recorded
    // provider (once set) is authoritative -- never let a retry's
    // (potentially different/absent) `input.provider` silently redirect an
    // in-flight checkout to a different provider mid-flow.
    const providerName = attempt.provider ?? input.provider ?? 'TEST_SANDBOX';
    let provider;
    try {
      provider = this.providerRegistry.resolve(providerName);
    } catch {
      throw new CheckoutError('UNKNOWN_PROVIDER');
    }

    // Step 3: ALWAYS call the provider with the stable, requestId-derived
    // idempotency key -- a provider that honors it (TEST_SANDBOX does; see
    // sandboxProvider.ts) returns the same checkout object on every retry,
    // never minting a second one.
    let checkoutResult;
    try {
      checkoutResult = await provider.createCheckout({
        amountMinor: attempt.price.amountMinor,
        currencyCode: attempt.price.currencyCode,
        accountRef: attempt.accountRef,
        paymentAttemptId: attempt.paymentAttemptId,
        returnUrl: input.returnUrl,
        idempotencyKey: checkoutIdempotencyKey(input.requestId),
      });
    } catch (error) {
      // Never leave an attempt indefinitely CREATED if the provider call
      // itself failed -- mark it FAILED so it cannot later be confused
      // with an attempt still genuinely awaiting a provider redirect. Only
      // safe to do from CREATED/PENDING (transitionStatus's own guard), so
      // this is itself idempotent/safe to hit on a retry.
      await this.paymentService.markFailed(attempt.paymentAttemptId, this.now());
      throw new CheckoutError('PROVIDER_CHECKOUT_FAILED', error instanceof Error ? error.message : undefined);
    }

    // Step 4: durably persist the provider checkout ref. Guarded: only
    // transitions FROM CREATED, so on a retry where the attempt is already
    // PENDING with this same ref recorded, this is simply a no-op (0 rows
    // affected is expected and fine here, NOT an error) -- the attempt is
    // already in the correct durable state.
    if (attempt.status === 'CREATED') {
      const transitioned = await runInTransaction((conn) =>
        this.paymentRepository.transitionStatus(conn, attempt!.paymentAttemptId, ['CREATED'], 'PENDING', providerName, checkoutResult.providerCheckoutRef),
      );
      if (!transitioned) {
        // Lost a race with a concurrent call for the same request (should
        // be rare given ChangeRequestService's own state machine, but not
        // impossible under real concurrency) -- re-read the authoritative
        // row rather than assuming failure.
        const reread = await runInTransaction((conn) => this.paymentRepository.findAttemptById(conn, attempt!.paymentAttemptId));
        if (!reread || reread.status !== 'PENDING') throw new CheckoutError('PROVIDER_CHECKOUT_FAILED', 'attempt was not in CREATED status immediately after creation');
      }
    }

    // Step 5: move the request to PAYMENT_PENDING -- idempotent w.r.t. a
    // request that already reached PAYMENT_PENDING on a prior (partially
    // failed) attempt at this same sequence.
    if (record.state !== 'PAYMENT_PENDING') {
      try {
        await this.changeRequestService.moveToPaymentPending(input.requestId);
      } catch (error) {
        if (error instanceof ChangeRequestError && error.code === 'INVALID_STATE') {
          // Could be a genuine anomaly, OR a benign race: re-check the
          // authoritative request state before treating this as fatal.
          const recheck = await this.changeRequestRepository.getById(input.requestId);
          if (!recheck || recheck.state !== 'PAYMENT_PENDING') {
            throw new CheckoutError('LIFECYCLE_TRANSITION_FAILED', error.message);
          }
          // else: already PAYMENT_PENDING -- treat as success, fall through.
        } else {
          throw new CheckoutError('LIFECYCLE_TRANSITION_FAILED', error instanceof Error ? error.message : undefined);
        }
      }
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
