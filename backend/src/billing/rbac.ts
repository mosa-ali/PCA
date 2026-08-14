/**
 * PCA Billing Core -- RBAC over the Billing domain, reusing Agent41's exact
 * role set (`PlatformAdminRole`, backend/src/platformadmin/auth/types.ts)
 * verbatim. This module does NOT modify anything under
 * backend/src/platformadmin/** -- it defines Billing's OWN operation
 * vocabulary (mission constraint: platformadmin's existing
 * `PlatformAdminOperation`/`OPERATION_MATRIX`, backend/src/platformadmin/auth/rbacPolicy.ts,
 * already covers `ADMINISTER_BILLING`/`ISSUE_REFUND` at a coarse grain, but
 * has no operation for "PLATFORM_ADMIN gets read-only price visibility
 * only" -- Section 3.7/`PCA-ADD-BILL-044`'s specific carve-out this lane
 * must enforce -- and this lane must not edit that accepted, un-modifiable
 * file to add one), following the identical closed-matrix,
 * every-cell-explicit, no-default-row style `rbacPolicy.ts` itself
 * establishes.
 *
 * Role matrix transcribed from Section 3.7 and `PCA-ADD-BILL-044`:
 *   - APP_OWNER / FINANCE_ADMIN: full billing mutation + read authority.
 *   - PLATFORM_ADMIN: read-only price visibility ONLY (VIEW_PRICE_BOOK) --
 *     no mutation, no payment-instrument visibility, no other billing read.
 *   - SUPPORT_ADMIN: no billing mutation, no payment-instrument visibility,
 *     no billing read of any kind (billing is FINANCE_ADMIN's domain,
 *     Section 3.4's SUPPORT_ADMIN permissions list stops at
 *     account/license/enrollment metadata).
 *   - AUDITOR_READ_ONLY: read-only across every billing view operation,
 *     write on none.
 */

import type { PlatformAdminRole } from '../platformadmin/auth/types.js';

export type BillingOperation =
  | 'VIEW_PRICE_BOOK'
  | 'MUTATE_PRICE_BOOK'
  | 'ISSUE_QUOTE'
  | 'VIEW_BILLING_RECORDS'
  | 'ADMINISTER_BILLING_RECORDS'
  | 'VIEW_PAYMENT_INSTRUMENTS'
  | 'ISSUE_REFUND'
  | 'ADMINISTER_DISPUTE';

export type BillingAuthorizationVerdict = 'ALLOW' | 'DENY';

const BILLING_OPERATION_MATRIX: Record<BillingOperation, Record<PlatformAdminRole, BillingAuthorizationVerdict>> = {
  VIEW_PRICE_BOOK: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  MUTATE_PRICE_BOOK: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ISSUE_QUOTE: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  VIEW_BILLING_RECORDS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  ADMINISTER_BILLING_RECORDS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  VIEW_PAYMENT_INSTRUMENTS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  ISSUE_REFUND: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_DISPUTE: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
};

export const BILLING_OPERATIONS = Object.keys(BILLING_OPERATION_MATRIX) as BillingOperation[];

/** ALLOW if any of the admin's currently-active roles maps to ALLOW for this operation; DENY otherwise, including for an empty role list. */
export function authorizeBillingOperation(roles: readonly PlatformAdminRole[], operation: BillingOperation): BillingAuthorizationVerdict {
  const row = BILLING_OPERATION_MATRIX[operation];
  if (!row) throw new Error(`No Billing authorization row registered for operation: ${operation}`);
  return roles.some((role) => row[role] === 'ALLOW') ? 'ALLOW' : 'DENY';
}

export class BillingAuthorizationError extends Error {
  readonly operation: BillingOperation;
  constructor(operation: BillingOperation) {
    super(`Not authorized to perform Billing operation: ${operation}`);
    this.name = 'BillingAuthorizationError';
    this.operation = operation;
  }
}

/** Throws BillingAuthorizationError if the roles are not authorized for the operation -- the standard guard every billing service method calls first. */
export function requireBillingOperation(roles: readonly PlatformAdminRole[], operation: BillingOperation): void {
  if (authorizeBillingOperation(roles, operation) !== 'ALLOW') throw new BillingAuthorizationError(operation);
}
