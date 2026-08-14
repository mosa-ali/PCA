import { describe, expect, it } from 'vitest';
import { isPermitted, PLATFORM_ADMIN_ROLES, type PlatformAdminOperation, type PlatformAdminRole } from '../../src/domain/roles';

const ALL_OPERATIONS: PlatformAdminOperation[] = [
  'MANAGE_ADMIN_ACCOUNTS',
  'ASSIGN_ADMIN_ROLE',
  'VIEW_ADMIN_ACCOUNTS',
  'SUSPEND_FAMILY_ACCOUNT',
  'REACTIVATE_FAMILY_ACCOUNT',
  'ADMINISTER_ENTITLEMENT_QUANTITY',
  'ADMINISTER_BILLING',
  'ISSUE_REFUND',
  'ADMINISTER_SETTLEMENT',
  'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS',
  'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS',
  'VIEW_PLATFORM_DASHBOARD',
  'VIEW_AUDIT_LOG_FULL',
  'VIEW_AUDIT_LOG_OWN',
  'VIEW_SUPPORT_ACCOUNT_METADATA',
  'PERFORM_SUPPORT_ACTION',
];

const MUTATING_OPERATIONS: PlatformAdminOperation[] = [
  'MANAGE_ADMIN_ACCOUNTS',
  'ASSIGN_ADMIN_ROLE',
  'SUSPEND_FAMILY_ACCOUNT',
  'REACTIVATE_FAMILY_ACCOUNT',
  'ADMINISTER_ENTITLEMENT_QUANTITY',
  'ADMINISTER_BILLING',
  'ISSUE_REFUND',
  'ADMINISTER_SETTLEMENT',
  'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS',
  'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS',
  'PERFORM_SUPPORT_ACTION',
];

describe('client-side RBAC hint (mirrors backend/src/platformadmin/auth/rbacPolicy.ts)', () => {
  it('denies every operation for an admin with zero active roles', () => {
    for (const operation of ALL_OPERATIONS) {
      expect(isPermitted([], operation)).toBe(false);
    }
  });

  it('PCA-ADD-PA-008: AUDITOR_READ_ONLY is denied on every mutating operation', () => {
    for (const operation of MUTATING_OPERATIONS) {
      expect(isPermitted(['AUDITOR_READ_ONLY'], operation)).toBe(false);
    }
  });

  it('AUDITOR_READ_ONLY is allowed on the view-only operations', () => {
    expect(isPermitted(['AUDITOR_READ_ONLY'], 'VIEW_PLATFORM_DASHBOARD')).toBe(true);
    expect(isPermitted(['AUDITOR_READ_ONLY'], 'VIEW_AUDIT_LOG_FULL')).toBe(true);
    expect(isPermitted(['AUDITOR_READ_ONLY'], 'VIEW_ADMIN_ACCOUNTS')).toBe(true);
  });

  it('APP_OWNER is allowed on every operation', () => {
    for (const operation of ALL_OPERATIONS) {
      expect(isPermitted(['APP_OWNER'], operation)).toBe(true);
    }
  });

  it('SUPPORT_ADMIN cannot access finance operations', () => {
    expect(isPermitted(['SUPPORT_ADMIN'], 'ADMINISTER_BILLING')).toBe(false);
    expect(isPermitted(['SUPPORT_ADMIN'], 'ISSUE_REFUND')).toBe(false);
    expect(isPermitted(['SUPPORT_ADMIN'], 'ADMINISTER_SETTLEMENT')).toBe(false);
  });

  it('FINANCE_ADMIN cannot administer admin-user roles or entitlement quantities', () => {
    expect(isPermitted(['FINANCE_ADMIN'], 'MANAGE_ADMIN_ACCOUNTS')).toBe(false);
    expect(isPermitted(['FINANCE_ADMIN'], 'ASSIGN_ADMIN_ROLE')).toBe(false);
    expect(isPermitted(['FINANCE_ADMIN'], 'ADMINISTER_ENTITLEMENT_QUANTITY')).toBe(false);
  });

  it('PLATFORM_ADMIN cannot administer settlement/refunds or sensitive settings', () => {
    expect(isPermitted(['PLATFORM_ADMIN'], 'ADMINISTER_SETTLEMENT')).toBe(false);
    expect(isPermitted(['PLATFORM_ADMIN'], 'ISSUE_REFUND')).toBe(false);
    expect(isPermitted(['PLATFORM_ADMIN'], 'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS')).toBe(false);
  });

  it('exactly 5 roles are recognized', () => {
    expect(PLATFORM_ADMIN_ROLES).toHaveLength(5);
  });

  it('a role granting ALLOW anywhere in a multi-role set is sufficient', () => {
    const roles: PlatformAdminRole[] = ['SUPPORT_ADMIN', 'FINANCE_ADMIN'];
    expect(isPermitted(roles, 'ADMINISTER_BILLING')).toBe(true); // via FINANCE_ADMIN
    expect(isPermitted(roles, 'PERFORM_SUPPORT_ACTION')).toBe(true); // via SUPPORT_ADMIN
  });
});
