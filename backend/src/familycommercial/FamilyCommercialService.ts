/**
 * PCA-MYKIDS-BILL-2 -- the family-commercial application service. Composes
 * (never duplicates) PCA-PA-2's EntitlementService/ChangeRequestService,
 * PCA-BILL-1's SubscriptionRepository/PaymentMethodRepository, and this
 * lane's own FamilyInvoiceReadRepository, applying strict family-scoping at
 * every read/write. Every billing-core repository is used at the
 * REPOSITORY layer, not the RBAC-gated Service layer (see
 * PriceBookQuotePort.ts's header for why: those services require a
 * PlatformAdminRole this caller never legitimately holds, and this mission
 * forbids faking one).
 *
 * FAMILY SCOPING: the HTTP layer (familyCommercialRoutes.ts) has already
 * proven the caller holds an ACTIVE family-scope row for `familyId` before
 * any method here runs (createRequireFamilyCommercialAuthorization). Every
 * method below additionally re-checks familyId against the record actually
 * read/written (never trusts a foreign-family record merely because its id
 * was guessable) -- the IDOR defense-in-depth this mission requires.
 */
import { runInTransaction } from '../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';
import { EntitlementService } from '../entitlements/EntitlementService.js';
import type { ChangeRequestRepository } from '../entitlements/requests/ChangeRequestRepository.js';
import { ChangeRequestError, ChangeRequestService } from '../entitlements/requests/ChangeRequestService.js';
import type { EntitlementReadModel, LimitType, EntitlementChangeRequestRecord } from '../entitlements/types.js';
import type { SubscriptionRepository, SubscriptionRow } from '../billing/subscription.js';
import type { PaymentMethodRepository, PaymentMethodRow } from '../billing/paymentMethod.js';
import { isCommercialMarket, MARKET_DEFAULT_CURRENCY } from '../billing/market.js';
import type { CommercialMarket } from '../billing/market.js';
import { isSupportedCurrency } from '../billing/currency.js';
import type { CurrencyCode } from '../billing/currency.js';
import { FreeAccessEnforcementError } from '../parentaccount/freeaccess/types.js';
import { FamilyInvoiceReadRepository } from './FamilyInvoiceReadRepository.js';
import type { FamilyInvoiceLineRow, FamilyInvoiceRow } from './FamilyInvoiceReadRepository.js';

export type FamilyCommercialErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TARGET'
  | 'INVALID_STATE'
  | 'CROSS_FAMILY'
  | 'INVALID_MARKET'
  | 'INVALID_CURRENCY'
  | 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED';

export class FamilyCommercialError extends Error {
  readonly code: FamilyCommercialErrorCode;
  constructor(code: FamilyCommercialErrorCode) {
    super(`Family commercial error: ${code}`);
    this.name = 'FamilyCommercialError';
    this.code = code;
  }
}

export interface CreateIncreaseRequestInput {
  readonly familyId: string;
  readonly limitType: LimitType;
  readonly targetLimit: number;
  /** Optional client-declared market/currency (e.g. the family's known billing region). Defaults to GLOBAL_OTHER/its default currency -- resolveCommercialMarket's own documented fallback (market.ts), never an invented price. */
  readonly commercialMarket?: string;
  readonly currencyCode?: string;
}

function resolveMarketAndCurrency(input: CreateIncreaseRequestInput): { market: CommercialMarket; currencyCode: CurrencyCode } {
  let market: CommercialMarket = 'GLOBAL_OTHER';
  if (input.commercialMarket !== undefined) {
    if (!isCommercialMarket(input.commercialMarket)) throw new FamilyCommercialError('INVALID_MARKET');
    market = input.commercialMarket;
  }
  let currencyCode: CurrencyCode = MARKET_DEFAULT_CURRENCY[market];
  if (input.currencyCode !== undefined) {
    if (!isSupportedCurrency(input.currencyCode)) throw new FamilyCommercialError('INVALID_CURRENCY');
    currencyCode = input.currencyCode;
  }
  return { market, currencyCode };
}

export type TransactionRunner = <T>(fn: (conn: PoolConnection) => Promise<T>) => Promise<T>;

export class FamilyCommercialService {
  constructor(
    private readonly entitlementService: EntitlementService,
    private readonly changeRequestRepository: ChangeRequestRepository,
    private readonly changeRequestService: ChangeRequestService,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly paymentMethodRepository: PaymentMethodRepository,
    private readonly invoiceReadRepository: FamilyInvoiceReadRepository = new FamilyInvoiceReadRepository(),
    private readonly now: () => Date = () => new Date(),
    // Injectable seam (defaults to the real db/pool.js runInTransaction in
    // production) -- see entitlements/quote/PriceBookQuotePort.ts's
    // identical pattern/rationale: lets a unit test exercise this
    // service's own family-scoping/delegation logic against fake
    // SubscriptionRepository/PaymentMethodRepository objects with no real
    // MySQL connection.
    private readonly runQuery: TransactionRunner = runInTransaction,
  ) {}

  // -- A. Entitlement read -------------------------------------------------
  async getEntitlement(familyId: string): Promise<EntitlementReadModel> {
    return this.entitlementService.buildReadModel(familyId, this.now());
  }

  // -- B. Requests -----------------------------------------------------------
  async listRequests(familyId: string): Promise<EntitlementChangeRequestRecord[]> {
    return this.changeRequestRepository.listForFamily(familyId);
  }

  async getRequest(familyId: string, requestId: string): Promise<EntitlementChangeRequestRecord> {
    const record = await this.changeRequestRepository.getById(requestId);
    // Same-code discipline as CheckoutService.createCheckoutSession: "not
    // found" and "belongs to a different family" are indistinguishable to
    // the caller.
    if (!record || record.familyId !== familyId) throw new FamilyCommercialError('NOT_FOUND');
    return record;
  }

  /** MANAGED_DEVICE_LIMIT: a billable request for a TARGET TOTAL, validated by ChangeRequestService (integer, > current limit) -- never a hardcoded allowed-target set. Resolves a standard PriceBook quote or falls to PENDING_ADMIN_QUOTE. */
  async createDeviceIncreaseRequest(input: CreateIncreaseRequestInput): Promise<EntitlementChangeRequestRecord> {
    const { market, currencyCode } = resolveMarketAndCurrency(input);
    try {
      return await this.changeRequestService.createRequest(input.familyId, 'MANAGED_DEVICE_LIMIT', input.targetLimit, market, currencyCode);
    } catch (error) {
      if (error instanceof ChangeRequestError && error.code === 'INVALID_TARGET') throw new FamilyCommercialError('INVALID_TARGET');
      if (error instanceof FreeAccessEnforcementError) throw new FamilyCommercialError('FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
      throw error;
    }
  }

  /**
   * PARENT_MEMBER_LIMIT: NON-BILLABLE (PCA-ADD-PA-054). Calls the exact SAME
   * `ChangeRequestService.createRequest` as the device path, but that
   * method's own code only ever invokes `QuotePort.resolveStandardQuote`
   * when `limitType === 'MANAGED_DEVICE_LIMIT'` (ChangeRequestService.ts:85
   * `if (limitType !== 'MANAGED_DEVICE_LIMIT') return created;`) -- a
   * PARENT_MEMBER_LIMIT request therefore structurally never reaches
   * PriceBook/Quote/checkout/invoice/payment code at all. market/currency
   * are still threaded through the shared signature but are provably unused
   * for this limitType.
   */
  async createParentMemberIncreaseRequest(input: CreateIncreaseRequestInput): Promise<EntitlementChangeRequestRecord> {
    const { market, currencyCode } = resolveMarketAndCurrency(input);
    try {
      return await this.changeRequestService.createRequest(input.familyId, 'PARENT_MEMBER_LIMIT', input.targetLimit, market, currencyCode);
    } catch (error) {
      if (error instanceof ChangeRequestError && error.code === 'INVALID_TARGET') throw new FamilyCommercialError('INVALID_TARGET');
      if (error instanceof FreeAccessEnforcementError) throw new FamilyCommercialError('FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
      throw error;
    }
  }

  /** Parent-initiated withdrawal, PENDING/QUOTED only (ChangeRequestService.cancel's own guard). Family-scope re-checked before delegating. */
  async cancelRequest(familyId: string, requestId: string): Promise<EntitlementChangeRequestRecord> {
    const record = await this.changeRequestRepository.getById(requestId);
    if (!record || record.familyId !== familyId) throw new FamilyCommercialError('NOT_FOUND');
    try {
      return await this.changeRequestService.cancel(requestId);
    } catch (error) {
      if (error instanceof ChangeRequestError && error.code === 'INVALID_STATE') throw new FamilyCommercialError('INVALID_STATE');
      throw error;
    }
  }

  // -- F. Subscription read ---------------------------------------------------
  async getSubscription(familyId: string): Promise<SubscriptionRow | null> {
    return this.runQuery((conn) => this.subscriptionRepository.findActiveForAccount(conn, familyId));
  }

  // -- G. Invoice read ---------------------------------------------------------
  async listInvoices(familyId: string): Promise<FamilyInvoiceRow[]> {
    return this.invoiceReadRepository.listForFamily(familyId);
  }

  /** Same family-scoped invoices, each paired with its own lines -- the shape the HTTP list route actually serializes. */
  async listInvoicesWithLines(familyId: string): Promise<Array<{ invoice: FamilyInvoiceRow; lines: FamilyInvoiceLineRow[] }>> {
    const invoices = await this.invoiceReadRepository.listForFamily(familyId);
    return Promise.all(
      invoices.map(async (invoice) => ({ invoice, lines: await this.invoiceReadRepository.listLines(invoice.invoiceId) })),
    );
  }

  async getInvoice(familyId: string, invoiceId: string): Promise<{ invoice: FamilyInvoiceRow; lines: FamilyInvoiceLineRow[] }> {
    const invoice = await this.invoiceReadRepository.findForFamily(familyId, invoiceId);
    if (!invoice) throw new FamilyCommercialError('NOT_FOUND');
    const lines = await this.invoiceReadRepository.listLines(invoiceId);
    return { invoice, lines };
  }

  // -- H. Payment method read (safe metadata only) ------------------------------
  async listPaymentMethods(familyId: string): Promise<PaymentMethodRow[]> {
    return this.runQuery((conn) => this.paymentMethodRepository.listForAccount(conn, familyId));
  }
}
