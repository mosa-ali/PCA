import type { PlatformAdminOperation } from '../domain/roles';
import type { BillingOperation } from '../domain/billingRbac';
import type { SettlementOperation } from '../domain/settlement';

export interface NavItem {
  path: string;
  labelKey: string;
  /** Item is hidden from the nav (not merely styled differently) when the current admin has none of these operations. Route-level enforcement still happens independently via RouteGuard/RBAC on the page itself. Exactly one of `operation`/`billingOperation`/`settlementOperation` is set per item -- billing/settlement views use their own finer-grained vocabularies (backend/src/billing/rbac.ts, backend/src/platformadmin/auth/rbacPolicy.ts's VIEW_SETTLEMENT_RECORDS family), everything else uses platformadmin/auth/rbacPolicy.ts's coarser vocabulary. */
  operation?: PlatformAdminOperation;
  billingOperation?: BillingOperation;
  settlementOperation?: SettlementOperation;
  /** Show the item when any one of these independently-scoped operations is allowed. */
  anyOf?: Array<
    | { operation: PlatformAdminOperation }
    | { billingOperation: BillingOperation }
    | { settlementOperation: SettlementOperation }
  >;
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
      { path: '/enrollment-management', labelKey: 'nav.enrollmentManagement', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
    ],
  },
  {
    titleKey: 'nav.billing',
    items: [
      { path: '/commercial-pricing', labelKey: 'nav.commercialPricing', anyOf: [
        { operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
        { billingOperation: 'VIEW_BILLING_RECORDS' },
        { billingOperation: 'VIEW_PRICE_BOOK' },
      ] },
      { path: '/billing/invoices', labelKey: 'nav.billingInvoices', billingOperation: 'VIEW_BILLING_RECORDS' },
      { path: '/billing/payments', labelKey: 'nav.billingPayments', billingOperation: 'VIEW_BILLING_RECORDS' },
      { path: '/settlement/accounts', labelKey: 'nav.settlementAccounts', settlementOperation: 'VIEW_SETTLEMENT_RECORDS' },
      { path: '/settlement/batches', labelKey: 'nav.settlementBatches', settlementOperation: 'VIEW_SETTLEMENT_RECORDS' },
      { path: '/settlement/reconciliation', labelKey: 'nav.settlementReconciliation', settlementOperation: 'VIEW_SETTLEMENT_RECORDS' },
    ],
  },
  {
    items: [
      { path: '/admin-users', labelKey: 'nav.adminUsers', operation: 'VIEW_ADMIN_ACCOUNTS' },
      { path: '/audit', labelKey: 'nav.audit', operation: 'VIEW_AUDIT_LOG_OWN' },
      // VIEW_SUPPORT_ACCOUNT_METADATA, not ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS:
      // the page's reads are gated backend-side by VIEW_SUPPORT_ACCOUNT_METADATA
      // (ALLOW for every role -- see App.tsx's /settings route guard), so
      // hiding the nav link behind the stricter mutate-only operation would
      // leave the fixed route guard undiscoverable for the roles it now lets
      // through.
      { path: '/settings', labelKey: 'nav.settings', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
    ],
  },
];
