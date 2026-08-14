import type { PlatformAdminOperation } from '../domain/roles';

export interface NavItem {
  path: string;
  labelKey: string;
  /** Item is hidden from the nav (not merely styled differently) when the current admin has none of these operations. Route-level enforcement still happens independently via RouteGuard/RBAC on the page itself. */
  operation: PlatformAdminOperation;
}

export interface NavSection {
  titleKey?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ path: '/dashboard', labelKey: 'nav.dashboard', operation: 'VIEW_PLATFORM_DASHBOARD' }],
  },
  {
    items: [
      { path: '/accounts', labelKey: 'nav.accounts', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
      { path: '/entitlements', labelKey: 'nav.entitlements', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
      { path: '/entitlement-requests', labelKey: 'nav.entitlementRequests', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
    ],
  },
  {
    titleKey: 'nav.billing',
    items: [
      { path: '/billing/plans', labelKey: 'nav.billingPlans', operation: 'ADMINISTER_BILLING' },
      { path: '/billing/pricing', labelKey: 'nav.billingPricing', operation: 'ADMINISTER_BILLING' },
      { path: '/billing/quotes', labelKey: 'nav.billingQuotes', operation: 'ADMINISTER_BILLING' },
      { path: '/billing/invoices', labelKey: 'nav.billingInvoices', operation: 'ADMINISTER_BILLING' },
      { path: '/billing/payments', labelKey: 'nav.billingPayments', operation: 'ADMINISTER_BILLING' },
    ],
  },
  {
    items: [
      { path: '/admin-users', labelKey: 'nav.adminUsers', operation: 'VIEW_ADMIN_ACCOUNTS' },
      { path: '/audit', labelKey: 'nav.audit', operation: 'VIEW_AUDIT_LOG_OWN' },
      { path: '/settings', labelKey: 'nav.settings', operation: 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS' },
    ],
  },
];
