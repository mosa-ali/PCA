// PCA-NFR-041/045: platform-admin-web previously had zero real axe-core
// coverage beyond tests/unit/accessibility.test.tsx's Login/ComingSoon/
// step-up-dialog spot checks. This file mirrors parent-web's
// tests/accessibility/axe.test.tsx convention (a dedicated axe.test.tsx
// under tests/accessibility/) and extends real coverage across the app's
// routed pages: Dashboard, AccountsList, AccountDetail, Entitlements,
// EntitlementRequests, ComplimentaryCapacity, FreeAccessPolicy, the five
// billing pages, the three settlement pages, AdminUsers, Audit, Settings,
// NotPermitted, and NotFound -- every real routed page in src/App.tsx
// except Login (already covered) and the ComingSoon placeholder (already
// covered).
//
// Every page in this app fetches through the shared platformAdminApi
// client (see src/api/platformAdminApiClient.ts), so a single generic
// fetch mock -- keyed on URL substrings, closest/most-specific match first
// -- stands in for the backend. Pages are rendered with a full provider
// stack (I18nextProvider > MemoryRouter > ToastProvider > AuthProvider >
// StepUpProvider), matching the established pattern in
// tests/unit/FreeAccessPolicy.test.tsx, and with an APP_OWNER session so
// every RBAC-gated form/control actually renders (a hidden control can't
// be axe-checked).
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

import Dashboard from '../../src/pages/Dashboard';
import AccountsList from '../../src/pages/accounts/AccountsList';
import AccountDetail from '../../src/pages/accounts/AccountDetail';
import Entitlements from '../../src/pages/entitlements/Entitlements';
import EntitlementRequests from '../../src/pages/entitlements/EntitlementRequests';
import ComplimentaryCapacity from '../../src/pages/entitlements/ComplimentaryCapacity';
import FreeAccessPolicy from '../../src/pages/entitlements/FreeAccessPolicy';
import BillingPlans from '../../src/pages/billing/BillingPlans';
import BillingPricing from '../../src/pages/billing/BillingPricing';
import BillingQuotes from '../../src/pages/billing/BillingQuotes';
import BillingInvoices from '../../src/pages/billing/BillingInvoices';
import BillingPayments from '../../src/pages/billing/BillingPayments';
import SettlementAccounts from '../../src/pages/billing/SettlementAccounts';
import SettlementBatches from '../../src/pages/billing/SettlementBatches';
import SettlementReconciliation from '../../src/pages/billing/SettlementReconciliation';
import AdminUsers from '../../src/pages/AdminUsers';
import Audit from '../../src/pages/Audit';
import Settings from '../../src/pages/Settings';
import NotPermitted from '../../src/pages/NotPermitted';
import NotFound from '../../src/pages/NotFound';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EMPTY_PAGED = { items: [], total: 0, limit: 20, offset: 0 };
const EMPTY_ITEMS = { items: [] };

const DASHBOARD_SNAPSHOT = {
  generatedAt: '2026-08-01T00:00:00.000Z',
  accountsTotal: { capability: 'AVAILABLE', value: 0 },
  accountsActiveSuspended: { capability: 'UNAVAILABLE', reason: 'test-unavailable' },
  parentMemberEntitlementUtilization: { capability: 'AVAILABLE', used: 0, limit: 0 },
  managedDeviceEntitlementUtilization: { capability: 'AVAILABLE', used: 0, limit: 0 },
  managedDeviceActive: { capability: 'AVAILABLE', value: 0 },
  managedDeviceReserved: { capability: 'AVAILABLE', value: 0 },
  pendingEntitlementRequests: { capability: 'AVAILABLE', value: 0 },
  entitlementRequestsByState: { capability: 'AVAILABLE', byKey: {} },
  subscriptionsByStatus: { capability: 'AVAILABLE', byKey: {} },
  quotesByStatus: { capability: 'AVAILABLE', byKey: {} },
  invoicesByStatusAndCurrency: { capability: 'AVAILABLE', rows: [] },
  paymentAttemptsByStatusAndCurrency: { capability: 'AVAILABLE', rows: [] },
  refundsByCurrency: { capability: 'AVAILABLE', rows: [] },
  openDisputes: { capability: 'AVAILABLE', value: 0 },
  settlementSummary: { capability: 'UNAVAILABLE', summary: null },
  serviceHealth: { capability: 'UNAVAILABLE', openReconciliationExceptions: null, mostRecentBatchStatusByAccount: null },
};

const ACCOUNT_SUMMARY = {
  familyId: 'fam-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  statusCapability: 'AVAILABLE',
  status: 'ACTIVE',
  suspendedAt: null,
  suspensionReason: null,
  entitlement: null,
  latestSubscription: null,
};

const FREE_ACCESS_DEFAULTS = { mode: 'TIME_LIMITED', durationDays: 30, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
const FREE_STARTER_DEFAULTS = { tier: 'FREE_STARTER', parentMemberLimit: 1, managedDeviceLimit: 1 };

/**
 * Generic mock for every platformAdminApi call any page makes on mount.
 * Ordered most-specific-first since several patterns are substrings of
 * others (e.g. "/settlement/batches" is a prefix of the per-batch
 * "/items" sub-resource).
 */
function mockFetch() {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'], sessionExpiresAt: undefined }));
    if (url.includes('/platform-admin/auth/step-up')) return Promise.resolve(jsonResponse(200, { stepUpId: 'su-1', expiresAt: '2030-01-01T00:00:00Z' }));

    if (url.includes('/platform-admin/dashboard')) return Promise.resolve(jsonResponse(200, DASHBOARD_SNAPSHOT));

    if (url.includes('/platform-admin/settings/free-access-defaults')) return Promise.resolve(jsonResponse(200, FREE_ACCESS_DEFAULTS));
    if (url.includes('/platform-admin/settings/free-starter-defaults')) return Promise.resolve(jsonResponse(200, FREE_STARTER_DEFAULTS));
    if (url.includes('/platform-admin/settings/currencies')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));
    if (url.includes('/platform-admin/settings/market-mapping')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));

    if (url.includes('/free-access') && method === 'GET') return Promise.resolve(jsonResponse(200, { mode: 'TIME_LIMITED', grantedAt: null, expiresAt: null, remainingDays: null, status: 'NONE' }));

    // Account detail (single id path) vs. accounts list -- list has no
    // further path segment after "/accounts".
    if (/\/platform-admin\/accounts\/[^/?]+/.test(url)) return Promise.resolve(jsonResponse(200, ACCOUNT_SUMMARY));
    if (url.includes('/platform-admin/accounts')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));

    if (url.includes('/complimentary-grants')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));
    if (url.includes('/entitlement'))
      return Promise.resolve(
        jsonResponse(200, {
          familyId: 'fam-1',
          planRef: null,
          parentMemberLimit: 1,
          parentMemberUsed: 0,
          managedDeviceLimit: 1,
          managedDeviceActive: 0,
          managedDeviceReserved: 0,
          availableDeviceSlots: 1,
          overLimitParentMember: false,
          overLimitManagedDevice: false,
          pendingRequestSummary: [],
        }),
      );
    if (url.includes('/platform-admin/entitlement-requests')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));

    if (url.includes('/platform-admin/quotes/pending')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));

    if (url.includes('/platform-admin/admin-users')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));
    if (url.includes('/platform-admin/audit')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));

    if (url.includes('/settlement/batches') && url.includes('/items')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));
    if (url.includes('/settlement/batches')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));
    if (url.includes('/settlement/accounts')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));

    if (url.includes('/billing/plans')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));
    if (url.includes('/billing/price-book')) return Promise.resolve(jsonResponse(200, EMPTY_ITEMS));
    if (url.includes('/billing/payment-attempts')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));
    if (url.includes('/billing/payment-transactions')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));
    if (url.includes('/billing/refunds')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));
    if (url.includes('/billing/disputes')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));
    if (url.includes('/billing/invoices')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));
    if (url.includes('/billing/subscriptions')) return Promise.resolve(jsonResponse(200, EMPTY_PAGED));

    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(ui: React.ReactElement, route = '/') {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetch());
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Routes>
                <Route path="/accounts/:id" element={ui} />
                <Route path="*" element={ui} />
              </Routes>
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const SETTLE_TIME = 250;

describe('platform-admin-web accessibility spot checks (axe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('Dashboard has no critical axe violations', async () => {
    const { container } = renderPage(<Dashboard />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AccountsList has no critical axe violations', async () => {
    const { container } = renderPage(<AccountsList />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AccountDetail has no critical axe violations', async () => {
    const { container } = renderPage(<AccountDetail />, '/accounts/fam-1');
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Entitlements (no family selected) has no critical axe violations', async () => {
    const { container } = renderPage(<Entitlements />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Entitlements (family selected via query) has no critical axe violations', async () => {
    const { container } = renderPage(<Entitlements />, '/entitlements?familyId=fam-1');
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('EntitlementRequests has no critical axe violations', async () => {
    const { container } = renderPage(<EntitlementRequests />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ComplimentaryCapacity (family selected) has no critical axe violations', async () => {
    const { container } = renderPage(<ComplimentaryCapacity />, '/complimentary-capacity?familyId=fam-1');
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('FreeAccessPolicy has no critical axe violations', async () => {
    const { container } = renderPage(<FreeAccessPolicy />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BillingPlans has no critical axe violations', async () => {
    const { container } = renderPage(<BillingPlans />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BillingPricing has no critical axe violations', async () => {
    const { container } = renderPage(<BillingPricing />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BillingQuotes has no critical axe violations', async () => {
    const { container } = renderPage(<BillingQuotes />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BillingInvoices has no critical axe violations', async () => {
    const { container } = renderPage(<BillingInvoices />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BillingPayments has no critical axe violations', async () => {
    const { container } = renderPage(<BillingPayments />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('SettlementAccounts has no critical axe violations', async () => {
    const { container } = renderPage(<SettlementAccounts />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('SettlementBatches has no critical axe violations', async () => {
    const { container } = renderPage(<SettlementBatches />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('SettlementReconciliation has no critical axe violations', async () => {
    const { container } = renderPage(<SettlementReconciliation />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AdminUsers has no critical axe violations', async () => {
    const { container } = renderPage(<AdminUsers />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Audit has no critical axe violations', async () => {
    const { container } = renderPage(<Audit />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Settings has no critical axe violations', async () => {
    const { container } = renderPage(<Settings />);
    await new Promise((r) => setTimeout(r, SETTLE_TIME));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('NotPermitted has no critical axe violations', async () => {
    const { container } = renderPage(<NotPermitted />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('NotFound has no critical axe violations', async () => {
    const { container } = renderPage(<NotFound />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
