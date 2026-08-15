// PCA-BILL-3 (Writer62, Round6): client-side DTO types + RBAC mirror for
// Settlement / Reconciliation (SETTLEMENT_RECONCILIATION_V1). Mirrors
// domain/billingRbac.ts's pattern exactly -- a SEPARATE operation
// vocabulary from domain/roles.ts's coarse PlatformAdminOperation
// (rbacPolicy.ts's ADMINISTER_SETTLEMENT stays reserved/unused; this lane's
// four granular operations are their own thing, same split billing/rbac.ts
// already established relative to ADMINISTER_BILLING). Same "usability hint
// only, server is authority" caveat as every other client-side RBAC mirror
// in this app -- a UI bug here can make a control visible that the server
// correctly rejects, but it can never grant real access.
import type { PlatformAdminRole } from './roles';
import type { MoneyAmount } from '../money/money';

export type SettlementOperation = 'VIEW_SETTLEMENT_RECORDS' | 'MUTATE_SETTLEMENT_ACCOUNT' | 'CREATE_SETTLEMENT_BATCH' | 'RESOLVE_RECONCILIATION';

type Verdict = 'ALLOW' | 'DENY';

const SETTLEMENT_OPERATION_MATRIX: Record<SettlementOperation, Record<PlatformAdminRole, Verdict>> = {
  VIEW_SETTLEMENT_RECORDS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  MUTATE_SETTLEMENT_ACCOUNT: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  CREATE_SETTLEMENT_BATCH: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  RESOLVE_RECONCILIATION: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
};

export function isSettlementPermitted(roles: readonly PlatformAdminRole[], operation: SettlementOperation): boolean {
  const row = SETTLEMENT_OPERATION_MATRIX[operation];
  return roles.some((role) => row[role] === 'ALLOW');
}

export type SettlementAccountStatus = 'ACTIVE' | 'INACTIVE';
export type ReconciliationStatus = 'MATCHED' | 'UNDER_INVESTIGATION' | 'RESOLVED';

/** Masked account view -- there is deliberately no `providerRef` field anywhere in this type; the backend never sends one (PlatformAdminSettlementService's masked-view boundary). */
export interface SettlementAccountDto {
  settlementAccountId: string;
  displayLabel: string;
  settlementCurrency: string;
  status: SettlementAccountStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SettlementBatchDto {
  settlementBatchId: string;
  settlementAccountRef: string;
  settlementCurrency: string;
  periodStart: string | null;
  periodEnd: string | null;
  expectedGross: MoneyAmount;
  fees: MoneyAmount;
  net: MoneyAmount;
  received: MoneyAmount;
  differenceMinor: string;
  status: ReconciliationStatus;
  providerRef: string;
  resolutionReason: string | null;
  resolvedByAdminId: string | null;
  resolvedAt: string | null;
  createdByAdminId: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SettlementBatchItemDto {
  settlementBatchItemId: string;
  settlementBatchId: string;
  paymentTransactionId: string;
  amount: MoneyAmount;
  createdAt: string | null;
}
