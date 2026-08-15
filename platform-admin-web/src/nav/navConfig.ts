import type { PlatformAdminOperation } from '../domain/roles';
import type { BillingOperation } from '../domain/billingRbac';

export interface NavItem {
  path: string;
  labelKey: string;
  /** Item is hidden from the nav (not merely styled differently) when the current admin has none of these operations. Route-level enforcement still happens independently via RouteGuard/RBAC on the page itself. Exactly one of `operation`/`billingOperation` is set per item -- billing views use the finer-grained billing/rbac.ts vocabulary (backend/src/billing/rbac.ts), everything else uses platformadmin/auth/rbacPolicy.ts's coarser vocabulary. */
  operation?: PlatformAdminOperation;
  billingOperation?: BillingOperation;
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
      { path: '/complimentary-capacity', labelKey: 'nav.complimentaryCapacity', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
    ],
  },
  {
    titleKey: 'nav.billing',
    items: [
      { path: '/billing/plans', labelKey: 'nav.billingPlans', billingOperation: 'VIEW_BILLING_RECORDS' },
      { path: '/billing/pricing', labelKey: 'nav.billingPricing', billingOperation: 'VIEW_PRICE_BOOK' },
      { path: '/billing/quotes', labelKey: 'nav.billingQuotes', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
      { path: '/billing/invoices', labelKey: 'nav.billingInvoices', billingOperation: 'VIEW_BILLING_RECORDS' },
      { path: '/billing/payments', labelKey: 'nav.billingPayments', billingOperation: 'VIEW_BILLING_RECORDS' },
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
