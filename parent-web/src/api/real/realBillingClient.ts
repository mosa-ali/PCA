// PCA-MYKIDS-BILL-3: real, HTTP-backed BillingClient against
// MYKIDS_COMMERCIAL_API_V1 (backend/src/http/routes/familyCommercialRoutes.ts,
// billingCheckoutRoutes.ts). Genuine networking code -- verified route
// paths/methods/bodies/status-code mappings against the live backend source
// under this same worktree, not against the round's frozen contract doc
// alone (see this lane's final report's BACKEND_REALITY field for any
// discrepancy found).
//
// SESSION MODEL: identical gap to ../real/realDeviceEnrollmentClient.ts --
// these routes sit behind `requireServiceSession`, which parses ONLY
// `Authorization: Bearer <opaque-token>`, a structurally different session
// transport than RealServiceAuthClient's HttpOnly-cookie model. No
// browser-reachable flow in this repository slice issues one of these
// bearer tokens yet. Rather than silently omitting the header (indistinguishable
// from "the server rejected a real token"), every method here takes an
// explicit `getBearerToken` accessor and fails fast with a distinct
// SERVICE_SESSION_UNAVAILABLE error before ever calling fetch. The HTTP
// plumbing itself is genuine and will work end-to-end the moment a real
// token accessor (and a real familyId/actorDeviceId accessor) are wired in
// -- see ../client.ts's construction of this class for the current
// placeholder wiring.
//
// FAMILY-OWNER AUTHORITY: every mutation route (create request, cancel
// request, checkout-CREATE) is gated server-side by
// FamilyCommercialAuthorityResolver, stubbed in production to
// UnavailableFamilyCommercialAuthorityResolver -- ALWAYS AUTHORITY_UNAVAILABLE
// today. This client treats ANY 403 on these routes identically ("cannot
// proceed") regardless of whether the body carries a `code` -- per the
// contract's asymmetric error-code shape, presence/absence of `code` must
// never be used to infer which denial reason occurred (ROLE_DENIED vs.
// AUTHORITY_UNAVAILABLE vs. STALE_OR_REVOKED vs. INVALID_PROOF all collapse
// to the same client-visible outcome here).
import type { BillingClient } from '../interfaces';
import type {
  CheckoutSession,
  CheckoutStatus,
  EntitlementChangeRequest,
  EntitlementSnapshot,
  Invoice,
  InvoiceLine,
  LimitType,
  PaymentMethodSummary,
  QuoteSnapshot,
  SubscriptionSnapshot,
} from '../../domain/billing';
import { toMoneyJson } from '../../domain/billing';

export type BillingApiErrorCode =
  | 'SERVICE_SESSION_UNAVAILABLE'
  | 'FAMILY_CONTEXT_UNAVAILABLE'
  | 'DEVICE_IDENTITY_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED_CURRENCY'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

/**
 * Typed error for every BillingClient failure mode. `code` is this client's
 * OWN classification (never re-derived from an ambiguous wire `code` field
 * in a way that would let a caller infer role/authority state -- see file
 * header). `serverCode`, when present, is the raw wire `code` value verbatim
 * (e.g. a FamilyCommercialError code, or
 * 'FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE'), kept only as non-authoritative
 * diagnostic metadata -- UI must never branch on it to distinguish "denied
 * because not Owner" from "denied because unavailable".
 */
export class BillingApiError extends Error {
  readonly code: BillingApiErrorCode;
  readonly httpStatus: number | null;
  readonly serverCode: string | null;

  constructor(code: BillingApiErrorCode, message: string, httpStatus: number | null = null, serverCode: string | null = null) {
    super(message);
    this.name = 'BillingApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.serverCode = serverCode;
  }
}

/** No browser-reachable flow issues this backend's family-commercial bearer token yet -- see file header. */
export async function noServiceBearerTokenAvailable(): Promise<string | null> {
  return null;
}

/** No browser-reachable flow resolves the caller's own familyId against this backend's family-commercial session yet -- see file header. */
export async function noFamilyContextAvailable(): Promise<string | null> {
  return null;
}

/**
 * Default actorDeviceId source: this codebase's only existing device-identity
 * concept is TrustedBrowserProvider's `browserEndpointId` (assigned at
 * `requestPairing()`, PAIRING_PENDING+) -- reused here rather than inventing
 * a second, billing-specific device-id concept. Billing routes do not
 * themselves require E2EE trust; this accessor is deliberately swappable
 * (see ../client.ts) once/if a narrower billing-only device-identity source
 * exists.
 */
export type ActorDeviceIdAccessor = () => Promise<string | null>;

interface WireMoney {
  amountMinor: string;
  currencyCode: string;
}

interface WireQuote {
  quoteKind: 'STANDARD' | 'CUSTOM';
  quoteRef: string;
  price: WireMoney;
  priceBookVersion: number | null;
  quotedAtUtc: string;
  expiresAtUtc: string | null;
}

interface WireChangeRequest {
  requestId: string;
  limitType: LimitType;
  currentLimitAtRequest: number;
  targetLimit: number;
  state: EntitlementChangeRequest['state'];
  awaitingAdminQuote: boolean;
  quote: WireQuote | null;
  noChargeOverride: boolean;
  denialReason: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

interface WireEntitlement {
  tier: string;
  parentMemberLimit: number;
  parentMemberUsed: number;
  managedDeviceLimit: number;
  managedDeviceActive: number;
  managedDeviceReserved: number;
  availableDeviceSlots: number;
  overLimitParentMember: boolean;
  overLimitManagedDevice: boolean;
  openRequests: Array<{ requestId: string; limitType: LimitType; state: EntitlementChangeRequest['state']; targetLimit: number; awaitingAdminQuote: boolean }>;
}

interface WireInvoiceLine {
  description: string;
  lineType: InvoiceLine['lineType'];
  amount: WireMoney;
  quantity: number;
}

interface WireInvoice {
  invoiceId: string;
  status: Invoice['status'];
  total: WireMoney;
  createdAtUtc: string;
  periodStartUtc: string | null;
  periodEndUtc: string | null;
  lines: WireInvoiceLine[];
}

interface WirePaymentMethod {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  displayLabel: string;
}

interface WireSubscription {
  status: SubscriptionSnapshot['status'];
  planId: string | null;
  currentPeriodEndUtc: string | null;
  autoRenew: boolean;
}

function toQuoteSnapshot(wire: WireQuote): QuoteSnapshot {
  return {
    quoteKind: wire.quoteKind,
    quoteRef: wire.quoteRef,
    price: toMoneyJson(wire.price.amountMinor, wire.price.currencyCode),
    priceBookVersion: wire.priceBookVersion,
    quotedAtUtc: wire.quotedAtUtc,
    expiresAtUtc: wire.expiresAtUtc,
  };
}

function toChangeRequest(wire: WireChangeRequest): EntitlementChangeRequest {
  return {
    requestId: wire.requestId,
    limitType: wire.limitType,
    currentLimitAtRequest: wire.currentLimitAtRequest,
    targetLimit: wire.targetLimit,
    state: wire.state,
    awaitingAdminQuote: wire.awaitingAdminQuote,
    quote: wire.quote ? toQuoteSnapshot(wire.quote) : null,
    noChargeOverride: wire.noChargeOverride,
    denialReason: wire.denialReason,
    createdAtUtc: wire.createdAtUtc,
    updatedAtUtc: wire.updatedAtUtc,
  };
}

function toEntitlementSnapshot(wire: WireEntitlement): EntitlementSnapshot {
  return {
    tier: wire.tier,
    parentMemberLimit: wire.parentMemberLimit,
    parentMemberUsed: wire.parentMemberUsed,
    managedDeviceLimit: wire.managedDeviceLimit,
    managedDeviceActive: wire.managedDeviceActive,
    managedDeviceReserved: wire.managedDeviceReserved,
    availableDeviceSlots: wire.availableDeviceSlots,
    overLimitParentMember: wire.overLimitParentMember,
    overLimitManagedDevice: wire.overLimitManagedDevice,
    // The entitlement read model's openRequests entries are a narrower
    // projection than the full EntitlementChangeRequestJson (contract
    // section A) -- quote/denialReason/timestamps are not carried on this
    // shape server-side, so they are honestly filled with nulls/epoch
    // placeholders rather than fabricated. Callers needing the full record
    // must use getRequest(requestId).
    openRequests: wire.openRequests.map((r) => ({
      requestId: r.requestId,
      limitType: r.limitType,
      currentLimitAtRequest: 0,
      targetLimit: r.targetLimit,
      state: r.state,
      awaitingAdminQuote: r.awaitingAdminQuote,
      quote: null,
      noChargeOverride: false,
      denialReason: null,
      createdAtUtc: '',
      updatedAtUtc: '',
    })),
  };
}

function toInvoice(wire: WireInvoice): Invoice {
  return {
    invoiceId: wire.invoiceId,
    status: wire.status,
    total: toMoneyJson(wire.total.amountMinor, wire.total.currencyCode),
    createdAtUtc: wire.createdAtUtc,
    periodStartUtc: wire.periodStartUtc,
    periodEndUtc: wire.periodEndUtc,
    lines: wire.lines.map((l) => ({
      description: l.description,
      lineType: l.lineType,
      amount: toMoneyJson(l.amount.amountMinor, l.amount.currencyCode),
      quantity: l.quantity,
    })),
  };
}

function toPaymentMethod(wire: WirePaymentMethod): PaymentMethodSummary {
  // Explicit allowlist copy -- never spreads the wire object, so an
  // unexpected extra field (e.g. a future accidental PAN/CVV leak
  // server-side) can never silently reach the UI through this client.
  return {
    paymentMethodId: wire.paymentMethodId,
    brand: wire.brand,
    last4: wire.last4,
    expiryMonth: wire.expiryMonth,
    expiryYear: wire.expiryYear,
    displayLabel: wire.displayLabel,
  };
}

function toSubscription(wire: WireSubscription): SubscriptionSnapshot {
  return {
    status: wire.status,
    // The contract's subscription read returns `planId`, not a
    // human-readable label -- this client surfaces the id itself as the
    // label rather than fabricating plan copy the backend never sent.
    planLabel: wire.planId ?? 'FREE_STARTER',
    currentPeriodEndUtc: wire.currentPeriodEndUtc,
    // Hardcoded false server-side always -- never build cancel-renewal UI on
    // this (contract note). Passed through verbatim, not overridden.
    autoRenew: wire.autoRenew,
  };
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class RealBillingClient implements BillingClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getBearerToken: () => Promise<string | null> = noServiceBearerTokenAvailable,
    private readonly getFamilyId: () => Promise<string | null> = noFamilyContextAvailable,
    private readonly getActorDeviceId: ActorDeviceIdAccessor = async () => null,
  ) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** Checked FIRST in every public method, before familyId/actorDeviceId resolution -- "is this client even authenticated" is a more fundamental gap than "which family", so it must be the first honest error a caller sees. */
  private async ensureBearerToken(operation: string): Promise<void> {
    const token = await this.getBearerToken();
    if (!token) {
      throw new BillingApiError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service-session bearer token is available to authenticate this request. This is a genuine backend-integration gap (no browser-reachable token-issuance flow yet), not a network failure.`,
      );
    }
  }

  private async familyId(operation: string): Promise<string> {
    await this.ensureBearerToken(operation);
    const familyId = await this.getFamilyId();
    if (!familyId) {
      throw new BillingApiError(
        'FAMILY_CONTEXT_UNAVAILABLE',
        `${operation}: no family context is available to scope this request. This is a genuine backend-integration gap (no browser-reachable family-context resolution flow yet), not a network failure.`,
      );
    }
    return familyId;
  }

  private async actorDeviceId(operation: string): Promise<string> {
    const deviceId = await this.getActorDeviceId();
    if (!deviceId) {
      throw new BillingApiError(
        'DEVICE_IDENTITY_UNAVAILABLE',
        `${operation}: no actor device identity is available for this mutation. This endpoint requires actorDeviceId for the Family-Owner authority gate.`,
      );
    }
    return deviceId;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getBearerToken();
    if (!token) {
      throw new BillingApiError(
        'SERVICE_SESSION_UNAVAILABLE',
        `${operation}: no service-session bearer token is available to authenticate this request. This is a genuine backend-integration gap (no browser-reachable token-issuance flow yet), not a network failure.`,
      );
    }
    try {
      return await fetch(this.url(path), {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new BillingApiError('NETWORK_ERROR', `${operation}: could not reach the PCA billing service: ${message}`);
    }
  }

  /**
   * Maps a non-2xx response honestly -- never falls back to fixture-shaped
   * data. Every 403 on ANY route is mapped to the SAME 'FORBIDDEN' code
   * regardless of whether the body carries a `code` field (see file
   * header): this client deliberately does not expose that asymmetry to
   * callers as a distinguishing signal.
   */
  private async fail(operation: string, response: Response): Promise<never> {
    const status = response.status;
    if (status === 400) {
      const body = await parseJsonSafe<{ code?: string }>(response);
      throw new BillingApiError('INVALID_REQUEST', `${operation}: invalid request.`, 400, body?.code ?? null);
    }
    if (status === 401) {
      throw new BillingApiError('UNAUTHORIZED', `${operation}: your service session has expired or is invalid. Please sign in again.`, 401);
    }
    if (status === 403) {
      const body = await parseJsonSafe<{ code?: string }>(response);
      throw new BillingApiError(
        'FORBIDDEN',
        `${operation}: this action is not permitted for your account right now.`,
        403,
        body?.code ?? null,
      );
    }
    if (status === 404) {
      throw new BillingApiError('NOT_FOUND', `${operation}: not found.`, 404);
    }
    if (status === 409) {
      const body = await parseJsonSafe<{ code?: string }>(response);
      throw new BillingApiError('CONFLICT', `${operation}: this request conflicts with its current state.`, 409, body?.code ?? null);
    }
    if (status === 422) {
      throw new BillingApiError('UNSUPPORTED_CURRENCY', `${operation}: unsupported currency for checkout.`, 422);
    }
    if (status === 429) {
      throw new BillingApiError('RATE_LIMITED', `${operation}: too many requests -- please wait and retry.`, 429);
    }
    throw new BillingApiError('UNKNOWN', `${operation}: unexpected status ${status}.`, status);
  }

  async getEntitlement(): Promise<EntitlementSnapshot> {
    const operation = 'getEntitlement';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial/entitlement`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<WireEntitlement>(response);
    if (!body) throw new BillingApiError('UNKNOWN', `${operation}: empty response body.`);
    return toEntitlementSnapshot(body);
  }

  async getSubscription(): Promise<SubscriptionSnapshot> {
    const operation = 'getSubscription';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial/subscription`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<WireSubscription>(response);
    if (!body) throw new BillingApiError('UNKNOWN', `${operation}: empty response body.`);
    return toSubscription(body);
  }

  async listInvoices(): Promise<Invoice[]> {
    const operation = 'listInvoices';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial/invoices`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<{ invoices: WireInvoice[] }>(response);
    return (body?.invoices ?? []).map(toInvoice);
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    const operation = 'getInvoice';
    const familyId = await this.familyId(operation);
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/commercial/invoices/${encodeURIComponent(invoiceId)}`,
      { method: 'GET' },
    );
    if (response.status === 404) return null;
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<WireInvoice>(response);
    return body ? toInvoice(body) : null;
  }

  async listPaymentMethods(): Promise<PaymentMethodSummary[]> {
    const operation = 'listPaymentMethods';
    const familyId = await this.familyId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial/payment-methods`, { method: 'GET' });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<{ paymentMethods: WirePaymentMethod[] }>(response);
    return (body?.paymentMethods ?? []).map(toPaymentMethod);
  }

  /**
   * True only when this client can actually reach the real checkout route
   * (i.e. the known service-session/bearer-token gap above is resolved).
   * Never true merely because this class was constructed -- see class
   * header and ../client.ts's KNOWN_BACKEND_INTEGRATION_ACTION notes.
   */
  isPaymentProviderAvailable(): boolean {
    return this.getBearerToken !== noServiceBearerTokenAvailable;
  }

  async requestLimitIncrease(limitType: LimitType, targetLimit: number): Promise<EntitlementChangeRequest> {
    const operation = 'requestLimitIncrease';
    const familyId = await this.familyId(operation);
    const actorDeviceId = await this.actorDeviceId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/commercial/requests`, {
      method: 'POST',
      body: JSON.stringify({ limitType, targetLimit, actorDeviceId }),
    });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<WireChangeRequest>(response);
    if (!body) throw new BillingApiError('UNKNOWN', `${operation}: empty response body.`);
    return toChangeRequest(body);
  }

  async cancelRequest(requestId: string): Promise<EntitlementChangeRequest> {
    const operation = 'cancelRequest';
    const familyId = await this.familyId(operation);
    const actorDeviceId = await this.actorDeviceId(operation);
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/commercial/requests/${encodeURIComponent(requestId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ actorDeviceId }) },
    );
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<WireChangeRequest>(response);
    if (!body) throw new BillingApiError('UNKNOWN', `${operation}: empty response body.`);
    return toChangeRequest(body);
  }

  async beginCheckout(requestId: string, returnUrl: string): Promise<CheckoutSession> {
    const operation = 'beginCheckout';
    const familyId = await this.familyId(operation);
    const actorDeviceId = await this.actorDeviceId(operation);
    const response = await this.request(operation, `/v1/families/${encodeURIComponent(familyId)}/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ requestId, returnUrl, actorDeviceId }),
    });
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<CheckoutSession>(response);
    if (!body) throw new BillingApiError('UNKNOWN', `${operation}: empty response body.`);
    return body;
  }

  async getRequest(requestId: string): Promise<EntitlementChangeRequest | null> {
    const operation = 'getRequest';
    const familyId = await this.familyId(operation);
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/commercial/requests/${encodeURIComponent(requestId)}`,
      { method: 'GET' },
    );
    if (response.status === 404) return null;
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<WireChangeRequest>(response);
    return body ? toChangeRequest(body) : null;
  }

  async getCheckoutStatus(paymentAttemptId: string): Promise<CheckoutStatus | null> {
    const operation = 'getCheckoutStatus';
    const familyId = await this.familyId(operation);
    const response = await this.request(
      operation,
      `/v1/families/${encodeURIComponent(familyId)}/billing/checkout/${encodeURIComponent(paymentAttemptId)}`,
      { method: 'GET' },
    );
    if (response.status === 404) return null;
    if (!response.ok) return this.fail(operation, response);
    const body = await parseJsonSafe<{ paymentAttemptId: string; status: string; amountMinor: string; currencyCode: string; increaseRequestRef: string | null }>(response);
    if (!body) return null;
    return {
      paymentAttemptId: body.paymentAttemptId,
      status: body.status,
      amount: toMoneyJson(body.amountMinor, body.currencyCode),
      increaseRequestRef: body.increaseRequestRef,
    };
  }

  /**
   * PCA-ADD-BILL-024: no server route in this repository slice exists for
   * MyKids to itself initiate a tokenized payment-method entry flow (the
   * commercial API surface is read-only for payment methods -- see contract
   * section H). Honestly rejects rather than fabricating a method.
   */
  beginAddPaymentMethod(): Promise<PaymentMethodSummary> {
    return Promise.reject(
      new BillingApiError('NOT_FOUND', 'beginAddPaymentMethod: no payment-method entry route exists on MYKIDS_COMMERCIAL_API_V1 (read-only payment-method surface).'),
    );
  }

  /**
   * No route exists on MYKIDS_COMMERCIAL_API_V1 to cancel auto-renewal (the
   * subscription surface is read-only, and `autoRenew` is hardcoded `false`
   * server-side always -- contract section F). Honestly rejects.
   */
  cancelAutoRenew(): Promise<{ auditEventId: string }> {
    return Promise.reject(
      new BillingApiError('NOT_FOUND', 'cancelAutoRenew: no subscription-mutation route exists on MYKIDS_COMMERCIAL_API_V1 (read-only subscription surface).'),
    );
  }
}
