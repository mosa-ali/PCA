// Client-side mirror of backend/src/billing/rbac.ts's BILLING_OPERATION_MATRIX.
// Same "usability hint only, server is authority" caveat as domain/roles.ts --
// a UI bug here can make a control visible that the server correctly
// rejects, but it can never grant real access. Kept as a SEPARATE matrix
// from domain/roles.ts's PlatformAdminOperation on purpose: billing/rbac.ts
// is its own vocabulary in the backend (finer-grained than
// platformadmin/auth/rbacPolicy.ts's coarse ADMINISTER_BILLING), and this
// file must not silently collapse that distinction back together.
import type { PlatformAdminRole } from './roles';

export type BillingOperation =
  | 'VIEW_PRICE_BOOK'
  | 'MUTATE_PRICE_BOOK'
  | 'ISSUE_QUOTE'
  | 'VIEW_BILLING_RECORDS'
  | 'ADMINISTER_BILLING_RECORDS'
  | 'VIEW_PAYMENT_INSTRUMENTS'
  | 'ISSUE_REFUND'
  | 'ADMINISTER_DISPUTE';

type Verdict = 'ALLOW' | 'DENY';

const BILLING_OPERATION_MATRIX: Record<BillingOperation, Record<PlatformAdminRole, Verdict>> = {
  VIEW_PRICE_BOOK: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'ALLOW', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  MUTATE_PRICE_BOOK: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  ISSUE_QUOTE: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  VIEW_BILLING_RECORDS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  ADMINISTER_BILLING_RECORDS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  VIEW_PAYMENT_INSTRUMENTS: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'ALLOW' },
  ISSUE_REFUND: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
  ADMINISTER_DISPUTE: { APP_OWNER: 'ALLOW', PLATFORM_ADMIN: 'DENY', FINANCE_ADMIN: 'ALLOW', SUPPORT_ADMIN: 'DENY', AUDITOR_READ_ONLY: 'DENY' },
};

export function isBillingPermitted(roles: readonly PlatformAdminRole[], operation: BillingOperation): boolean {
  const row = BILLING_OPERATION_MATRIX[operation];
  return roles.some((role) => row[role] === 'ALLOW');
}
