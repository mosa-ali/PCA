/**
 * PCA-MYKIDS-BILL-2 -- wire-safe DTOs for the family-commercial read/request
 * surface. Mirrors the frozen Agent46 parent-web contract
 * (parent-web/src/domain/billing.ts, PCA-MYKIDS-BILL-1) field-for-field:
 * money crosses as {amountMinor: string, currencyCode}, dates as ISO 8601
 * UTC strings, never a raw bigint/Date/number-money. See this lane's final
 * report's AGENT46_CONTRACT_MATCH table for the exact method/shape mapping.
 */
import type { Money } from '../billing/money.js';
import { moneyToJson } from '../billing/money.js';
import type { MoneyJson } from '../billing/money.js';
import type {
  EntitlementChangeRequestRecord,
  EntitlementReadModel,
  QuoteSnapshot,
} from '../entitlements/types.js';
import type { SubscriptionRow } from '../billing/subscription.js';
import type { PaymentMethodRow } from '../billing/paymentMethod.js';
import type { FamilyInvoiceRow, FamilyInvoiceLineRow } from './FamilyInvoiceReadRepository.js';

export type { MoneyJson };

export interface QuoteSnapshotJson {
  readonly quoteKind: 'STANDARD' | 'CUSTOM';
  readonly quoteRef: string;
  readonly price: MoneyJson;
  readonly priceBookVersion: number | null;
  readonly quotedAtUtc: string;
  readonly expiresAtUtc: string | null;
}

export function quoteSnapshotToJson(quote: QuoteSnapshot): QuoteSnapshotJson {
  return {
    quoteKind: quote.quoteKind,
    quoteRef: quote.quoteRef,
    price: moneyToJson({ amountMinor: quote.amountMinor, currencyCode: quote.currencyCode as Money['currencyCode'] }),
    priceBookVersion: quote.priceBookVersion,
    quotedAtUtc: quote.quotedAt.toISOString(),
    expiresAtUtc: quote.expiresAt ? quote.expiresAt.toISOString() : null,
  };
}

export interface PendingRequestSummaryJson {
  readonly requestId: string;
  readonly limitType: 'PARENT_MEMBER_LIMIT' | 'MANAGED_DEVICE_LIMIT';
  readonly state: EntitlementReadModel['pendingRequestSummary'][number]['state'];
  readonly targetLimit: number;
  readonly awaitingAdminQuote: boolean;
}

export interface EntitlementSnapshotJson {
  readonly tier: string;
  readonly parentMemberLimit: number;
  readonly parentMemberUsed: number;
  readonly managedDeviceLimit: number;
  readonly managedDeviceActive: number;
  readonly managedDeviceReserved: number;
  readonly availableDeviceSlots: number;
  readonly overLimitParentMember: boolean;
  readonly overLimitManagedDevice: boolean;
  readonly openRequests: readonly PendingRequestSummaryJson[];
}

export function entitlementReadModelToJson(model: EntitlementReadModel): EntitlementSnapshotJson {
  return {
    tier: model.planRef,
    parentMemberLimit: model.parentMemberLimit,
    parentMemberUsed: model.parentMemberUsed,
    managedDeviceLimit: model.managedDeviceLimit,
    managedDeviceActive: model.managedDeviceActive,
    managedDeviceReserved: model.managedDeviceReserved,
    availableDeviceSlots: model.availableDeviceSlots,
    overLimitParentMember: model.overLimitParentMember,
    overLimitManagedDevice: model.overLimitManagedDevice,
    openRequests: model.pendingRequestSummary.map((r) => ({
      requestId: r.requestId,
      limitType: r.limitType,
      state: r.state,
      targetLimit: r.targetLimit,
      awaitingAdminQuote: r.awaitingAdminQuote,
    })),
  };
}

export interface EntitlementChangeRequestJson {
  readonly requestId: string;
  readonly limitType: 'PARENT_MEMBER_LIMIT' | 'MANAGED_DEVICE_LIMIT';
  readonly currentLimitAtRequest: number;
  readonly targetLimit: number;
  readonly state: EntitlementChangeRequestRecord['state'];
  readonly awaitingAdminQuote: boolean;
  readonly quote: QuoteSnapshotJson | null;
  readonly noChargeOverride: boolean;
  readonly denialReason: string | null;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
}

export function changeRequestToJson(record: EntitlementChangeRequestRecord): EntitlementChangeRequestJson {
  return {
    requestId: record.requestId,
    limitType: record.limitType,
    currentLimitAtRequest: record.currentLimitAtRequest,
    targetLimit: record.targetLimit,
    state: record.state,
    awaitingAdminQuote: record.awaitingAdminQuote,
    quote: record.quote ? quoteSnapshotToJson(record.quote) : null,
    noChargeOverride: record.noChargeOverride,
    denialReason: record.decisionReason,
    createdAtUtc: record.createdAt.toISOString(),
    updatedAtUtc: record.updatedAt.toISOString(),
  };
}

export interface SubscriptionSnapshotJson {
  readonly status: 'FREE_STARTER' | SubscriptionRow['status'];
  readonly planId: string | null;
  readonly currentPeriodEndUtc: string | null;
  readonly autoRenew: boolean;
}

/** No active subscription row => the family is on the (unbilled, no-subscription-row) FREE_STARTER posture -- never fabricated as if a real billing_subscriptions row existed. FREE_STARTER has nothing to auto-renew, so autoRenew is honestly false here, never the (always-1) column default. */
export function subscriptionToJson(subscription: SubscriptionRow | null): SubscriptionSnapshotJson {
  if (!subscription) {
    return { status: 'FREE_STARTER', planId: null, currentPeriodEndUtc: null, autoRenew: false };
  }
  return {
    status: subscription.status,
    planId: subscription.planId,
    currentPeriodEndUtc: subscription.currentPeriodEnd.toISOString(),
    // migrations/0031_billing_subscription_auto_renew.sql: the real
    // per-subscription column, mapped verbatim -- no longer hardcoded.
    autoRenew: subscription.autoRenew,
  };
}

export interface InvoiceLineJson {
  readonly description: string;
  readonly lineType: FamilyInvoiceLineRow['lineType'];
  readonly amount: MoneyJson;
  readonly quantity: number;
}

export interface InvoiceJson {
  readonly invoiceId: string;
  readonly status: FamilyInvoiceRow['status'];
  readonly total: MoneyJson;
  readonly createdAtUtc: string;
  readonly periodStartUtc: string | null;
  readonly periodEndUtc: string | null;
  readonly lines: readonly InvoiceLineJson[];
}

export function invoiceToJson(invoice: FamilyInvoiceRow, lines: readonly FamilyInvoiceLineRow[]): InvoiceJson {
  return {
    invoiceId: invoice.invoiceId,
    status: invoice.status,
    total: moneyToJson(invoice.total),
    createdAtUtc: invoice.createdAt.toISOString(),
    periodStartUtc: invoice.periodStart ? invoice.periodStart.toISOString() : null,
    periodEndUtc: invoice.periodEnd ? invoice.periodEnd.toISOString() : null,
    lines: lines.map((line) => ({
      description: line.description,
      lineType: line.lineType,
      amount: moneyToJson(line.amount),
      quantity: line.quantity,
    })),
  };
}

export interface PaymentMethodSummaryJson {
  readonly paymentMethodId: string;
  readonly brand: string | null;
  readonly last4: string | null;
  readonly expiryMonth: number | null;
  readonly expiryYear: number | null;
  readonly displayLabel: string;
}

/**
 * PRIVACY: only ever reads/forwards provider-safe metadata columns
 * (brand/last4/expiry/displayLabel) off `PaymentMethodRow`
 * (billing/paymentMethod.ts) -- that row type itself has no PAN/CVV/secret
 * field to leak (see that file's own schema-privacy header), and this
 * mapper is an additional, explicit allowlist rather than a spread, so a
 * future field added to PaymentMethodRow can never silently start crossing
 * the wire here.
 */
export function paymentMethodToJson(row: PaymentMethodRow): PaymentMethodSummaryJson {
  return {
    paymentMethodId: row.paymentMethodId,
    brand: row.brand,
    last4: row.last4,
    expiryMonth: row.expiryMonth,
    expiryYear: row.expiryYear,
    displayLabel: row.displayLabel,
  };
}
