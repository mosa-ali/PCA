// PCA-ADD-BILL-020: the platform dashboard's USD-normalized cross-batch
// settlement rollup (backend GET /platform-admin/settlement/usd-rollup,
// backend/src/billing/settlement/SettlementService.ts's usdRollup()) was
// fully implemented and tested on the backend but never rendered anywhere
// in platform-admin-web -- this file proves it is now genuinely wired: an
// APP_OWNER (permitted for VIEW_SETTLEMENT_RECORDS) sees the real fetched
// figures, and a role denied that permission (e.g. PLATFORM_ADMIN) never
// even requests them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import Dashboard from '../../src/pages/Dashboard';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

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

const USD_ROLLUP = {
  totalNetUsdMinor: '123456',
  totalReceivedUsdMinor: '120000',
  includedBatchCount: 7,
  excludedForMissingRateBatchCount: 2,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetchFor(roles: string[], rollupCalls: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles }));
    if (url.includes('/platform-admin/dashboard')) return Promise.resolve(jsonResponse(200, DASHBOARD_SNAPSHOT));
    if (url.includes('/platform-admin/settlement/usd-rollup')) {
      rollupCalls.push(url);
      return Promise.resolve(jsonResponse(200, USD_ROLLUP));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(roles: string[], rollupCalls: string[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(roles, rollupCalls));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Dashboard />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Dashboard USD-normalized settlement rollup (PCA-ADD-BILL-020)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('fetches and renders the real rollup figures for a role permitted to view settlement records', async () => {
    const rollupCalls: string[] = [];
    renderPage(['APP_OWNER'], rollupCalls);

    await waitFor(() => expect(rollupCalls.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(await screen.findByText('$1,234.56')).toBeInTheDocument();
    expect(await screen.findByText('$1,200.00')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  // The per-currency settlement rollup used to print bare wire values -- e.g.
  // "USD: net 100000, received 99500, diff -500" -- so $1,000.00 rendered as
  // "100000", with the labels hardcoded in English right in the JSX. Every
  // amount now goes through formatMoney with the row's own currency (the
  // signed difference included), and the labels come from both locales.
  it('formats the per-currency settlement rollup as money, never as raw minor units', async () => {
    const rollupCalls: string[] = [];
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (url.includes('/platform-admin/dashboard')) {
          return Promise.resolve(
            jsonResponse(200, {
              ...DASHBOARD_SNAPSHOT,
              settlementSummary: {
                capability: 'AVAILABLE',
                summary: {
                  matchedBatchCount: 1,
                  underInvestigationBatchCount: 0,
                  resolvedBatchCount: 0,
                  byCurrency: [
                    {
                      currencyCode: 'USD',
                      totalNet: { amountMinor: '100000', currencyCode: 'USD' },
                      totalReceived: { amountMinor: '99500', currencyCode: 'USD' },
                      totalDifferenceMinor: '-500',
                    },
                  ],
                },
              },
            }),
          );
        }
        if (url.includes('/platform-admin/settlement/usd-rollup')) {
          rollupCalls.push(url);
          return Promise.resolve(jsonResponse(200, USD_ROLLUP));
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <ToastProvider>
            <AuthProvider>
              <StepUpProvider>
                <Dashboard />
              </StepUpProvider>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(await screen.findByText(/USD: net \$1,000\.00, received \$995\.00, difference -\$5\.00/)).toBeInTheDocument();
    // The old raw-wire rendering must not survive anywhere on the page.
    expect(screen.queryByText(/100000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/, diff /)).not.toBeInTheDocument();
  });

  it('never requests the rollup for a role without VIEW_SETTLEMENT_RECORDS, and shows no rollup section', async () => {
    const rollupCalls: string[] = [];
    renderPage(['PLATFORM_ADMIN'], rollupCalls);

    // Let the dashboard snapshot fetch (and any effect) settle -- "Platform
    // metrics" is the one KPI section every role sees, so it's a safe
    // synchronization anchor regardless of billing/settlement permissions.
    await screen.findByText('Platform metrics');
    expect(rollupCalls).toEqual([]);
    expect(screen.queryByText('USD-normalized cross-batch rollup')).not.toBeInTheDocument();
    // Real regression coverage for the bug this fix closed: GET
    // /platform-admin/dashboard omits settlementSummary/serviceHealth
    // entirely for a role without VIEW_SETTLEMENT_RECORDS (dashboardRoutes.ts) --
    // Dashboard.tsx must not render (or dereference) those sections either.
    expect(screen.queryByText('Service health / exception queue')).not.toBeInTheDocument();
    expect(screen.queryByText('Settlement reconciliation summary')).not.toBeInTheDocument();
  });

  it('does not crash and hides billing/settlement-gated sections for a role the backend omits them for entirely (PCA regression: Dashboard.tsx used to dereference these fields unconditionally and crash to the error boundary for PLATFORM_ADMIN/SUPPORT_ADMIN)', async () => {
    const rollupCalls: string[] = [];
    const snapshotWithoutRestrictedFields = {
      generatedAt: DASHBOARD_SNAPSHOT.generatedAt,
      accountsTotal: DASHBOARD_SNAPSHOT.accountsTotal,
      accountsActiveSuspended: DASHBOARD_SNAPSHOT.accountsActiveSuspended,
      parentMemberEntitlementUtilization: DASHBOARD_SNAPSHOT.parentMemberEntitlementUtilization,
      managedDeviceEntitlementUtilization: DASHBOARD_SNAPSHOT.managedDeviceEntitlementUtilization,
      managedDeviceActive: DASHBOARD_SNAPSHOT.managedDeviceActive,
      managedDeviceReserved: DASHBOARD_SNAPSHOT.managedDeviceReserved,
      pendingEntitlementRequests: DASHBOARD_SNAPSHOT.pendingEntitlementRequests,
      entitlementRequestsByState: DASHBOARD_SNAPSHOT.entitlementRequestsByState,
      subscriptionsByStatus: DASHBOARD_SNAPSHOT.subscriptionsByStatus,
      quotesByStatus: DASHBOARD_SNAPSHOT.quotesByStatus,
      // openDisputes/invoicesByStatusAndCurrency/paymentAttemptsByStatusAndCurrency/
      // refundsByCurrency/settlementSummary/serviceHealth deliberately omitted --
      // this mirrors exactly what dashboardRoutes.ts sends over the wire for
      // SUPPORT_ADMIN/PLATFORM_ADMIN, not merely a null/unavailable placeholder.
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['SUPPORT_ADMIN'] }));
        if (url.includes('/platform-admin/dashboard')) return Promise.resolve(jsonResponse(200, snapshotWithoutRestrictedFields));
        if (url.includes('/platform-admin/settlement/usd-rollup')) {
          rollupCalls.push(url);
          return Promise.resolve(jsonResponse(200, USD_ROLLUP));
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <ToastProvider>
            <AuthProvider>
              <StepUpProvider>
                <Dashboard />
              </StepUpProvider>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    await screen.findByText('Platform metrics');
    expect(screen.queryByText('Open disputes')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoices by status and currency')).not.toBeInTheDocument();
    expect(screen.queryByText('Service health / exception queue')).not.toBeInTheDocument();
    expect(screen.queryByText('Settlement reconciliation summary')).not.toBeInTheDocument();
  });
});
