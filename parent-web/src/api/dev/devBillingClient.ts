// DEVELOPMENT_ONLY fixture implementation of BillingClient (PCA-MYKIDS-BILL-1).
// Simulates the server-authoritative side of the Section 18.1 flow (quote
// resolution, payment confirmation, admin quote/decision) entirely in
// memory so the full request lifecycle (PENDING -> QUOTED/PENDING_ADMIN_QUOTE
// -> PAYMENT_PENDING -> APPROVED|DENIED|CANCELLED) can be exercised without
// a real backend. Every "what would normally be a separate authoritative
// actor" transition (payment-provider webhook confirmation, Platform
// Administration's custom-quote issuance / parent-member decision) is
// exposed as a separate `simulate*` export, never folded into the
// parent-facing mutation itself -- this mirrors PCA-ADD-BILL-035's
// invariant that a client action alone can never move a request to
// APPROVED, even in this fixture.
import type {
  BillingClient,
} from '../interfaces';
import type {
  CheckoutSession,
  CheckoutStatus,
  EntitlementChangeRequest,
  EntitlementSnapshot,
  Invoice,
  LimitType,
  MoneyJson,
  PaymentMethodSummary,
  QuoteSnapshot,
  SubscriptionSnapshot,
} from '../../domain/billing';
import { FREE_STARTER_TIER } from '../../domain/billing';

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * Illustrative DEV-fixture-only "price book" -- stands in for what a real
 * backend PriceBook lookup would return for these two standard managed-
 * device targets. Never read by, or shipped in, a non-demo-mode build (see
 * ../client.ts: this module is only ever constructed when config.demoMode
 * is true) -- NOT the "hardcoded upgrade price" the addendum's Section 6
 * forbids, which concerns the real application's pricing/display logic.
 */
const DEV_STANDARD_PRICES: Record<number, MoneyJson> = {
  2: { amountMinor: '499', currencyCode: 'USD' },
  3: { amountMinor: '899', currencyCode: 'USD' },
};

const DEV_CUSTOM_QUOTE_AMOUNT: MoneyJson = { amountMinor: '2499', currencyCode: 'USD' };

let entitlement = {
  tier: FREE_STARTER_TIER,
  parentMemberLimit: 1,
  parentMemberUsed: 1,
  managedDeviceLimit: 1,
  managedDeviceActive: 1,
  managedDeviceReserved: 0,
  overLimitParentMember: false,
  overLimitManagedDevice: false,
};

let subscription: SubscriptionSnapshot = {
  status: 'FREE_STARTER',
  planLabel: 'Free Starter',
  currentPeriodEndUtc: null,
  autoRenew: false,
};

let requests: EntitlementChangeRequest[] = [];
let invoices: Invoice[] = [];
let paymentMethods: PaymentMethodSummary[] = [];
let requestSeq = 0;
let invoiceSeq = 0;
/** DEV-only in-memory checkout-attempt state, keyed by paymentAttemptId -- stands in for what a real PaymentAttempt row + CheckoutService.getCheckoutStatus would return. */
const checkoutAttempts = new Map<string, CheckoutStatus>();
/**
 * DEV-only: every "simulated webhook" setTimeout handle scheduled by
 * beginCheckout below, so __resetDevBillingStateForTests can cancel any
 * still-pending ones. Without this, a timer scheduled by one test can still
 * fire mid-way through the NEXT test -- and since requestSeq is reset to 0
 * per test, request/paymentAttempt ids are reused across tests, so a stale
 * timer can land on (and prematurely confirm) an unrelated, identically-id'd
 * request created by the following test. This is a test-isolation-only
 * concern; production code never resets this module's state at all.
 */
const pendingWebhookTimers = new Set<ReturnType<typeof setTimeout>>();

function notify() {
  // No external subscribers today (unlike devState.ts's role-switcher,
  // nothing outside this module's own getters needs a push signal --
  // pages re-read via useAsync's reload()). Kept as a no-op seam so a
  // future reactive consumer doesn't require re-threading every mutation.
}

/** Test-only: resets all in-memory fixture state back to a fresh FREE_STARTER family. Not imported by any production file (see tests/unit/noDevOnlyImportsInProduction.test.ts) -- only test files under tests/** call this. */
export function __resetDevBillingStateForTests(): void {
  entitlement = {
    tier: FREE_STARTER_TIER,
    parentMemberLimit: 1,
    parentMemberUsed: 1,
    managedDeviceLimit: 1,
    managedDeviceActive: 1,
    managedDeviceReserved: 0,
    overLimitParentMember: false,
    overLimitManagedDevice: false,
  };
  subscription = { status: 'FREE_STARTER', planLabel: 'Free Starter', currentPeriodEndUtc: null, autoRenew: false };
  requests = [];
  invoices = [];
  paymentMethods = [];
  requestSeq = 0;
  invoiceSeq = 0;
  checkoutAttempts.clear();
  for (const timer of pendingWebhookTimers) clearTimeout(timer);
  pendingWebhookTimers.clear();
}

/**
 * Test-only: overrides the in-memory fixture subscription (e.g. to a
 * non-FREE_STARTER ACTIVE plan with a currentPeriodEndUtc/autoRenew
 * combination), so Subscription.tsx's plan/renewal/auto-renew branches --
 * otherwise unreachable from the FREE_STARTER-only default fixture -- can
 * be exercised in a component test. Not imported by any production file
 * (see tests/unit/noDevOnlyImportsInProduction.test.ts) -- only test files
 * under tests/** call this, same convention as
 * __resetDevBillingStateForTests above.
 */
export function __setDevSubscriptionForTests(overrides: Partial<SubscriptionSnapshot>): void {
  subscription = { ...subscription, ...overrides };
}

/**
 * Test-only counterpart to __setDevSubscriptionForTests: Subscription.tsx
 * branches on `entitlement.tier === FREE_STARTER_TIER`
 * (isFreeStarter), NOT on the subscription snapshot, so a test exercising
 * the non-FREE_STARTER plan/renewal/auto-renew UI must move the tier here
 * too, or the page stays on the FREE_STARTER branch regardless of what
 * __setDevSubscriptionForTests set. Same "test files under tests/** only"
 * convention as the other __*ForTests exports in this module.
 */
export function __setDevEntitlementTierForTests(tier: string): void {
  entitlement = { ...entitlement, tier };
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildSnapshot(): EntitlementSnapshot {
  const availableDeviceSlots = Math.max(entitlement.managedDeviceLimit - entitlement.managedDeviceActive - entitlement.managedDeviceReserved, 0);
  return {
    tier: entitlement.tier,
    parentMemberLimit: entitlement.parentMemberLimit,
    parentMemberUsed: entitlement.parentMemberUsed,
    managedDeviceLimit: entitlement.managedDeviceLimit,
    managedDeviceActive: entitlement.managedDeviceActive,
    managedDeviceReserved: entitlement.managedDeviceReserved,
    availableDeviceSlots,
    overLimitParentMember: entitlement.overLimitParentMember,
    overLimitManagedDevice: entitlement.overLimitManagedDevice,
    openRequests: requests.filter((r) => r.state === 'PENDING' || r.state === 'QUOTED' || r.state === 'PAYMENT_PENDING'),
  };
}

function currentLimitFor(limitType: LimitType): number {
  return limitType === 'MANAGED_DEVICE_LIMIT' ? entitlement.managedDeviceLimit : entitlement.parentMemberLimit;
}

function findRequestOrThrow(requestId: string): EntitlementChangeRequest {
  const request = requests.find((r) => r.requestId === requestId);
  if (!request) throw new Error(`Entitlement change request not found: ${requestId}`);
  return request;
}

function replaceRequest(updated: EntitlementChangeRequest): EntitlementChangeRequest {
  requests = requests.map((r) => (r.requestId === updated.requestId ? updated : r));
  notify();
  return updated;
}

/** DEV-only: simulates Platform Administration issuing a one-off custom Quote for a PENDING_ADMIN_QUOTE request (PCA-ADD-PA-050's custom path). Never callable from the real client -- not part of BillingClient. */
export async function simulateAdminIssueCustomQuote(requestId: string): Promise<EntitlementChangeRequest> {
  await delay();
  const request = findRequestOrThrow(requestId);
  if (request.state !== 'PENDING' || !request.awaitingAdminQuote) {
    throw new Error('Only a request awaiting admin quote can receive a custom quote.');
  }
  const quote: QuoteSnapshot = {
    quoteKind: 'CUSTOM',
    quoteRef: `dev-custom-quote-${requestId}`,
    price: DEV_CUSTOM_QUOTE_AMOUNT,
    priceBookVersion: null,
    quotedAtUtc: nowIso(),
    expiresAtUtc: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  return replaceRequest({ ...request, state: 'QUOTED', awaitingAdminQuote: false, quote, updatedAtUtc: nowIso() });
}

/** DEV-only: simulates Platform Administration approving a non-billable PARENT_MEMBER_LIMIT request at no charge (PCA-ADD-PA-054). */
export async function simulateAdminApproveParentMemberRequest(requestId: string): Promise<EntitlementChangeRequest> {
  await delay();
  const request = findRequestOrThrow(requestId);
  if (request.limitType !== 'PARENT_MEMBER_LIMIT' || request.state !== 'PENDING') {
    throw new Error('Only a PENDING parent-member request can be approved this way.');
  }
  entitlement = { ...entitlement, parentMemberLimit: request.targetLimit };
  notify();
  return replaceRequest({ ...request, state: 'APPROVED', updatedAtUtc: nowIso() });
}

/** DEV-only: simulates Platform Administration denying an open request. */
export async function simulateAdminDeny(requestId: string, reason: string): Promise<EntitlementChangeRequest> {
  await delay();
  const request = findRequestOrThrow(requestId);
  if (!['PENDING', 'QUOTED', 'PAYMENT_PENDING'].includes(request.state)) {
    throw new Error('Only an open request can be denied.');
  }
  return replaceRequest({ ...request, state: 'DENIED', denialReason: reason, updatedAtUtc: nowIso() });
}

/**
 * DEV-only: simulates the payment provider's authoritative server-to-server
 * confirmation (PCA-ADD-BILL-035) for a PAYMENT_PENDING device-limit
 * request. This is the ONLY path that raises managedDeviceLimit for a
 * billable request -- beginCheckout below never does this itself. Guarded
 * on state = PAYMENT_PENDING so a duplicate call (e.g. a second UI refresh)
 * is a safe no-op, mirroring PCA-ADD-BILL-046's idempotent-activation
 * discipline.
 */
export async function simulateServerPaymentConfirmation(requestId: string): Promise<EntitlementChangeRequest> {
  await delay(250);
  const request = findRequestOrThrow(requestId);
  if (request.state !== 'PAYMENT_PENDING' || !request.quote) {
    return request; // already applied or not yet at this stage -- idempotent no-op, not an error.
  }
  const quotedPrice = request.quote.price;
  entitlement = { ...entitlement, managedDeviceLimit: request.targetLimit };
  const approved = replaceRequest({ ...request, state: 'APPROVED', updatedAtUtc: nowIso() });
  for (const [paymentAttemptId, attempt] of checkoutAttempts) {
    if (attempt.increaseRequestRef === requestId) {
      checkoutAttempts.set(paymentAttemptId, { ...attempt, status: 'CONFIRMED' });
    }
  }
  invoiceSeq += 1;
  const invoice: Invoice = {
    invoiceId: `dev-invoice-${invoiceSeq}`,
    status: 'PAID',
    total: quotedPrice,
    createdAtUtc: nowIso(),
    periodStartUtc: null,
    periodEndUtc: null,
    lines: [
      {
        description: `Managed device allowance increase to ${request.targetLimit}`,
        lineType: 'DEVICE_LIMIT_INCREASE',
        amount: quotedPrice,
        quantity: 1,
      },
    ],
  };
  invoices = [invoice, ...invoices];
  notify();
  return approved;
}

export class DevBillingClient implements BillingClient {
  async getEntitlement(): Promise<EntitlementSnapshot> {
    await delay();
    return buildSnapshot();
  }

  async getSubscription(): Promise<SubscriptionSnapshot> {
    await delay();
    return subscription;
  }

  async listInvoices(): Promise<Invoice[]> {
    await delay();
    return invoices;
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    await delay();
    return invoices.find((i) => i.invoiceId === invoiceId) ?? null;
  }

  async listPaymentMethods(): Promise<PaymentMethodSummary[]> {
    await delay();
    return paymentMethods;
  }

  isPaymentProviderAvailable(): boolean {
    return true;
  }

  async requestLimitIncrease(limitType: LimitType, targetLimit: number): Promise<EntitlementChangeRequest> {
    if (!Number.isInteger(targetLimit) || targetLimit < 1) {
      throw new Error('Target quantity must be a positive whole number.');
    }
    await delay();
    const currentLimit = currentLimitFor(limitType);
    if (targetLimit <= currentLimit) {
      throw new Error(`Target must be greater than the current limit (${currentLimit}).`);
    }
    requestSeq += 1;
    const base: EntitlementChangeRequest = {
      requestId: `dev-request-${requestSeq}`,
      limitType,
      currentLimitAtRequest: currentLimit,
      targetLimit,
      state: 'PENDING',
      awaitingAdminQuote: false,
      quote: null,
      noChargeOverride: false,
      denialReason: null,
      createdAtUtc: nowIso(),
      updatedAtUtc: nowIso(),
    };

    if (limitType === 'PARENT_MEMBER_LIMIT') {
      // PCA-ADD-PA-054: never priced, stays PENDING for a direct admin decision.
      requests = [base, ...requests];
      notify();
      return base;
    }

    const standardPrice = DEV_STANDARD_PRICES[targetLimit];
    if (standardPrice) {
      const quote: QuoteSnapshot = {
        quoteKind: 'STANDARD',
        quoteRef: `dev-standard-quote-${targetLimit}`,
        price: standardPrice,
        priceBookVersion: 1,
        quotedAtUtc: nowIso(),
        expiresAtUtc: null,
      };
      const quoted: EntitlementChangeRequest = { ...base, state: 'QUOTED', quote, updatedAtUtc: nowIso() };
      requests = [quoted, ...requests];
      notify();
      return quoted;
    }

    const awaitingQuote: EntitlementChangeRequest = { ...base, awaitingAdminQuote: true };
    requests = [awaitingQuote, ...requests];
    notify();
    return awaitingQuote;
  }

  async cancelRequest(requestId: string): Promise<EntitlementChangeRequest> {
    await delay();
    const request = findRequestOrThrow(requestId);
    if (request.state !== 'PENDING' && request.state !== 'QUOTED') {
      throw new Error('Only a PENDING or QUOTED request can be cancelled.');
    }
    return replaceRequest({ ...request, state: 'CANCELLED', updatedAtUtc: nowIso() });
  }

  async beginCheckout(requestId: string, _returnUrl: string): Promise<CheckoutSession> {
    await delay();
    const request = findRequestOrThrow(requestId);
    if (request.state !== 'QUOTED' || !request.quote) {
      throw new Error('Only a QUOTED request can proceed to checkout.');
    }
    if (request.quote.expiresAtUtc !== null && request.quote.expiresAtUtc <= nowIso()) {
      throw new Error('This quote has expired -- request a new quote before paying.');
    }
    // PCA-ADD-BILL-035/PCA-ADD-PA-049: this handoff never itself approves the
    // request or raises managedDeviceLimit -- only
    // simulateServerPaymentConfirmation (standing in for an asynchronous,
    // authoritative provider webhook arriving later) does that. It is
    // scheduled here, not called synchronously, and not exposed to any page
    // (see noDevOnlyImportsInProduction.test.ts) -- a page discovers the
    // resulting APPROVED state only by re-reading getRequest/getEntitlement,
    // exactly as a real client would learn of a real webhook's effect.
    replaceRequest({ ...request, state: 'PAYMENT_PENDING', updatedAtUtc: nowIso() });
    requestSeq += 1;
    const paymentAttemptId = `dev-payment-attempt-${requestSeq}`;
    checkoutAttempts.set(paymentAttemptId, {
      paymentAttemptId,
      status: 'PENDING',
      amount: request.quote.price,
      increaseRequestRef: requestId,
    });
    const webhookTimer = setTimeout(() => {
      // Fire-and-forget, like a real webhook this module doesn't control the
      // timing of -- if the in-memory fixture state was reset in the
      // meantime (e.g. test teardown) the request simply no longer exists,
      // which is not a defect to surface as an unhandled rejection.
      pendingWebhookTimers.delete(webhookTimer);
      simulateServerPaymentConfirmation(requestId).catch(() => {});
    }, 900);
    pendingWebhookTimers.add(webhookTimer);
    // redirectUrl is a same-origin, in-app SPA path -- the DevBillingClient
    // fixture never leaves the SPA (no real payment provider exists in
    // demo/dev mode); see domain/billing.ts's isSameOriginRedirect, which
    // treats this as "navigate with the router", not "hard browser redirect".
    return {
      paymentAttemptId,
      provider: 'DEV_FIXTURE',
      redirectUrl: `/subscription/checkout-return?requestId=${requestId}`,
      status: 'PENDING',
    };
  }

  async getRequest(requestId: string): Promise<EntitlementChangeRequest | null> {
    await delay(60);
    return requests.find((r) => r.requestId === requestId) ?? null;
  }

  async getCheckoutStatus(paymentAttemptId: string): Promise<CheckoutStatus | null> {
    await delay(60);
    return checkoutAttempts.get(paymentAttemptId) ?? null;
  }

  async beginAddPaymentMethod(): Promise<PaymentMethodSummary> {
    await delay(300);
    const method: PaymentMethodSummary = {
      paymentMethodId: `dev-pm-${paymentMethods.length + 1}`,
      brand: 'Visa',
      last4: '4242',
      expiryMonth: 12,
      expiryYear: new Date().getFullYear() + 2,
      displayLabel: 'Visa •••• 4242',
    };
    paymentMethods = [...paymentMethods, method];
    notify();
    return method;
  }

  async cancelAutoRenew(): Promise<{ auditEventId: string }> {
    await delay();
    subscription = { ...subscription, autoRenew: false };
    notify();
    return { auditEventId: `dev-audit-${Date.now()}` };
  }

  async resumeAutoRenew(): Promise<{ auditEventId: string }> {
    await delay();
    subscription = { ...subscription, autoRenew: true };
    notify();
    return { auditEventId: `dev-audit-${Date.now()}` };
  }
}
