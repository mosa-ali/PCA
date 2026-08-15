import type { MoneyAmount } from '../money/money';

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export const PLAN_STATUSES: PlanStatus[] = ['DRAFT', 'ACTIVE', 'RETIRED'];
export type BillingCadence = 'MONTHLY' | 'ANNUAL' | 'ONE_TIME' | 'FREE';
export const BILLING_CADENCES: BillingCadence[] = ['MONTHLY', 'ANNUAL', 'ONE_TIME', 'FREE'];

export interface PlanDto {
  planId: string;
  planCode: string;
  planVersion: number;
  status: PlanStatus;
  billingCadence: BillingCadence;
  defaultParentMemberLimit: number;
  defaultManagedDeviceLimit: number;
  priceBookId: string | null;
  createdAt: string | null;
}

export type PriceBookStatus = string;

export interface PriceBookDto {
  priceBookId: string;
  commercialMarket: string;
  currencyCode: string;
  targetDeviceLimit: number;
  price: MoneyAmount | null;
  priceBookVersion: number;
  status: PriceBookStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdByAdminId: string | null;
  createdAt: string | null;
}

export interface PendingQuoteRequest {
  requestId: string;
  familyId: string;
  limitType: string;
  targetLimit: number;
  currentLimitAtRequest: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SubscriptionDto {
  subscriptionId: string;
  accountRef: string;
  planId: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  createdAt: string | null;
  canceledAt: string | null;
}

export interface InvoiceDto {
  invoiceId: string;
  accountRef: string;
  subscriptionId: string | null;
  status: string;
  total: MoneyAmount | null;
  createdAt: string | null;
  dueAt: string | null;
}

export interface PaymentAttemptDto {
  paymentAttemptId: string;
  accountRef: string;
  invoiceId: string | null;
  increaseRequestRef: string | null;
  amount: MoneyAmount | null;
  status: string;
  provider: string;
  providerReference: string | null;
  createdAt: string | null;
}

export interface PaymentTransactionDto {
  paymentTransactionId: string;
  paymentAttemptId: string;
  accountRef: string;
  amount: MoneyAmount | null;
  provider: string;
  providerTransactionRef: string | null;
  confirmedAt: string | null;
}

export interface RefundDto {
  refundId: string;
  paymentTransactionId: string;
  amount: MoneyAmount | null;
  reasonCode: string;
  status: string;
  entitlementTreatment: string;
  initiatedByAdminId: string | null;
  createdAt: string | null;
}

export interface DisputeDto {
  disputeId: string;
  paymentTransactionId: string;
  status: string;
  evidenceDueAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
