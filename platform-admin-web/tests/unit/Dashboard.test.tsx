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

    await waitFor(() => expect(rollupCalls.length).toBeGreaterThan(0));
    expect(await screen.findByText('$1,234.56')).toBeInTheDocument();
    expect(await screen.findByText('$1,200.00')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('never requests the rollup for a role without VIEW_SETTLEMENT_RECORDS, and shows no rollup section', async () => {
    const rollupCalls: string[] = [];
    renderPage(['PLATFORM_ADMIN'], rollupCalls);

    // Let the dashboard snapshot fetch (and any effect) settle.
    await screen.findByText('Service health / exception queue');
    expect(rollupCalls).toEqual([]);
    expect(screen.queryByText('USD-normalized cross-batch rollup')).not.toBeInTheDocument();
  });
});
