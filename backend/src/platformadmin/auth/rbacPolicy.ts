import type { PlatformAdminRole } from './types.js';

/**
 * Closed set of operations Platform Administration RBAC governs, named
 * per Section 3's Permitted/Prohibited language and the Section 3.7
 * permission matrix table. This lane (PCA-PA-1) implements no HTTP surface
 * for most of these operations yet -- they exist so
 * PlatformAdminAccountService/future workstreams have a single, reviewed
 * authorization vocabulary to grow into, exactly as
 * backend/src/authz/types.ts's ServiceOperation does for the family plane.
 */
export type PlatformAdminOperation =
  | 'MANAGE_ADMIN_ACCOUNTS'
  | 'ASSIGN_ADMIN_ROLE'
  | 'VIEW_ADMIN_ACCOUNTS'
  | 'SUSPEND_FAMILY_ACCOUNT'
  | 'REACTIVATE_FAMILY_ACCOUNT'
  | 'ADMINISTER_ENTITLEMENT_QUANTITY'
  | 'ADMINISTER_BILLING'
  | 'ISSUE_REFUND'
  | 'ADMINISTER_SETTLEMENT'
  | 'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS'
  | 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS'
  | 'VIEW_PLATFORM_DASHBOARD'
  | 'VIEW_AUDIT_LOG_FULL'
  | 'VIEW_AUDIT_LOG_OWN'
  | 'VIEW_SUPPORT_ACCOUNT_METADATA'
  | 'PERFORM_SUPPORT_ACTION'
  // PCA-ADD-COMP-014: complimentary-grant create/revoke/renew, bounded
  // delegation to APP_OWNER + PLATFORM_ADMIN (FINANCE_ADMIN/SUPPORT_ADMIN/
  // AUDITOR_READ_ONLY remain read-only via VIEW_SUPPORT_ACCOUNT_METADATA,
  // already ALLOW for all five roles).
  | 'ADMINISTER_COMPLIMENTARY_GRANT'
  // PCA-ADD-COMP-014: permanent/lifetime (no expiresAt) complimentary
  // grants remain APP_OWNER-only by default -- a SEPARATE operation row,
  // never a parameterized branch inside ADMINISTER_COMPLIMENTARY_GRANT,
  // so the closed-matrix/no-default-case discipline this file already
  // documents extends cleanly to the permanent-grant restriction too.
  | 'ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT';

export type PlatformAdminAuthorizationVerdict = 'ALLOW' | 'DENY';

/**
 * Section 3.7's matrix, transcribed cell-for-cell, one row per operation,
 * every (operation, role) cell explicit -- there is NO fallback/default
 * row for a role. A lookup for an operation not present in this map is a
 * programming error and throws (see authorizePlatformAdminOperation),
 * exactly mirroring backend/src/authz/policy.ts's resolveRequirements
 * no-default-case discipline; unlike backend/src/familyrbac/policy.ts's
 * resolveOperationAuthorization, which default-denies an unrecognized
 * operation, this matrix treats an unrecognized OPERATION as a bug to fix,
 * not a runtime condition to route around -- because every operation this
 * plane will ever authorize is enumerated in the closed union above, a
 * missing matrix row can only mean the matrix itself is out of date.
 *
 * PCA-ADD-PA-008: AUDITOR_READ_ONLY is DENY on every mutating operation
 * and ALLOW only on VIEW_* operations -- asserted directly by a unit test
 * that iterates this matrix (backend/test/platformadmin/rbacPolicy.test.mjs),
 * not merely by eyeballing the table below.
 */
const OPERATION_MATRIX: Record<PlatformAdminOperation, Record<PlatformAdminRole, PlatformAdminAuthorizationVerdict>> = {
  MANAGE_ADMIN_ACCOUNTS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ASSIGN_ADMIN_ROLE: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  VIEW_ADMIN_ACCOUNTS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  SUSPEND_FAMILY_ACCOUNT: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  REACTIVATE_FAMILY_ACCOUNT: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_ENTITLEMENT_QUANTITY: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_BILLING: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ISSUE_REFUND: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_SETTLEMENT: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_SENSITIVE_PLATFORM_SETTINGS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  VIEW_PLATFORM_DASHBOARD: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'ALLOW',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  VIEW_AUDIT_LOG_FULL: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  VIEW_AUDIT_LOG_OWN: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'ALLOW',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  VIEW_SUPPORT_ACCOUNT_METADATA: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'ALLOW',
    SUPPORT_ADMIN: 'ALLOW',
    AUDITOR_READ_ONLY: 'ALLOW',
  },
  PERFORM_SUPPORT_ACTION: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'ALLOW',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_COMPLIMENTARY_GRANT: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'ALLOW',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
  ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT: {
    APP_OWNER: 'ALLOW',
    PLATFORM_ADMIN: 'DENY',
    FINANCE_ADMIN: 'DENY',
    SUPPORT_ADMIN: 'DENY',
    AUDITOR_READ_ONLY: 'DENY',
  },
};

/** Every operation this matrix declares -- used by tests to iterate the whole table without hand-maintaining a duplicate list. */
export const PLATFORM_ADMIN_OPERATIONS = Object.keys(OPERATION_MATRIX) as PlatformAdminOperation[];

/**
 * ALLOW if any of the admin's currently-active roles maps to ALLOW for
 * this operation; DENY otherwise (including when `roles` is empty -- an
 * admin with zero active roles, e.g. immediately after their last role was
 * revoked, is authorized for nothing).
 */
export function authorizePlatformAdminOperation(
  roles: readonly PlatformAdminRole[],
  operation: PlatformAdminOperation,
): PlatformAdminAuthorizationVerdict {
  const row = OPERATION_MATRIX[operation];
  if (!row) throw new Error(`No Platform Administration authorization row registered for operation: ${operation}`);
  return roles.some((role) => row[role] === 'ALLOW') ? 'ALLOW' : 'DENY';
}
