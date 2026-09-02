// B132/B139/B146 (docs/product-completion/PCA_P1_P2_BEHAVIOR_LEDGER.csv):
// the ledger recorded BillingPricing/BillingInvoices as showing raw status
// enums and SettlementBatches as showing unformatted money. Both were
// already fixed by commit aeb967c ("status badges and real money formatting
// across billing/settlement"), predating this ledger pass, but neither fix
// had a dedicated regression test -- this file is that test, so a future
// change can't silently reintroduce a raw enum or an unformatted amount on
// these three pages.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingPricing from '../../src/pages/billing/BillingPricing';
import BillingInvoices from '../../src/pages/billing/BillingInvoices';
import SettlementBatches from '../../src/pages/billing/SettlementBatches';
import { AuthProvider, useCurrentRoles } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>{ui}</StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/**
 * SettlementBatches (like SettlementAccounts/SettlementReconciliation) gates
 * its OWN data fetch on `useCurrentRoles()` inside a mount-only
 * (`useEffect(..., [])`) effect. In the real app this never races because a
 * single AuthProvider instance persists across client-side route
 * navigation, so roles are already resolved by the time a user navigates to
 * this page. An isolated test that mounts a fresh AuthProvider and
 * SettlementBatches AT THE SAME TIME hits the race AuthProvider's own doc
 * comment calls out ("a test harness pre-seeding a token"): SettlementBatches'
 * effect fires (and gates on canRead=false) before AuthProvider's async
 * whoami() has populated roles, and never re-fires once it does. This
 * gate defers mounting SettlementBatches until roles are already known,
 * matching real in-app navigation -- not a workaround for a formatting bug,
 * and out of this change's scope to fix (shared by two other Settlement
 * pages, unrelated to B146).
 */
function WaitForRoles({ children }: { children: React.ReactElement }) {
  const roles = useCurrentRoles();
  return roles.length > 0 ? children : null;
}

describe('Billing/settlement status labels and money formatting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('BillingPricing renders a translated price-book status, never the raw enum', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (url.includes('/billing/price-book')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  priceBookId: 'pb-1',
                  priceBookVersion: 1,
                  commercialMarket: 'GLOBAL_OTHER',
                  targetDeviceLimit: 1,
                  price: { amountMinor: '1999', currencyCode: 'USD' },
                  status: 'ACTIVE',
                  effectiveFrom: '2026-01-01T00:00:00.000Z',
                  effectiveTo: null,
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderWithProviders(<BillingPricing />);

    // BillingPricing renders nothing until a search is submitted -- the
    // page's own default filter values (device limit 1, USD, GLOBAL_OTHER)
    // are already valid, so a plain submit is enough.
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
    // The exact-money display, not a raw minor-unit integer.
    expect(screen.getByText('$19.99')).toBeInTheDocument();
  });

  it('BillingInvoices renders translated invoice and subscription statuses, never the raw enum', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (url.includes('/billing/invoices')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  invoiceId: 'inv-1',
                  accountRef: 'fam-1',
                  subscriptionId: 'sub-1',
                  status: 'UNCOLLECTIBLE',
                  total: { amountMinor: '500', currencyCode: 'USD' },
                  createdAt: '2026-01-01T00:00:00.000Z',
                  dueAt: '2026-02-01T00:00:00.000Z',
                },
              ],
              total: 1,
              limit: 20,
              offset: 0,
            }),
          );
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderWithProviders(<BillingInvoices />);

    expect(await screen.findByText('Uncollectible')).toBeInTheDocument();
    expect(screen.queryByText('UNCOLLECTIBLE')).not.toBeInTheDocument();
  });

  it('SettlementBatches formats every money column (including the difference) via formatMoney, never a raw minor-unit integer', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (url.includes('/settlement/accounts')) return Promise.resolve(jsonResponse(200, { items: [] }));
        if (url.includes('/settlement/batches')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  settlementBatchId: 'batch-1',
                  settlementAccountRef: 'acct-1',
                  settlementCurrency: 'USD',
                  periodStart: '2026-01-01T00:00:00.000Z',
                  periodEnd: '2026-01-31T00:00:00.000Z',
                  expectedGross: { amountMinor: '10000', currencyCode: 'USD' },
                  fees: { amountMinor: '500', currencyCode: 'USD' },
                  net: { amountMinor: '9500', currencyCode: 'USD' },
                  received: { amountMinor: '9450', currencyCode: 'USD' },
                  differenceMinor: '-50',
                  status: 'UNDER_INVESTIGATION',
                  providerRef: 'prov-1',
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderWithProviders(
      <WaitForRoles>
        <SettlementBatches />
      </WaitForRoles>,
    );

    // net = $95.00, difference = -$0.50 -- both routed through formatMoney,
    // never rendered as the raw minor-unit integers 9500 / -50.
    expect(await screen.findByText('$95.00')).toBeInTheDocument();
    expect(screen.getByText('-$0.50')).toBeInTheDocument();
    expect(screen.queryByText('9500')).not.toBeInTheDocument();
    expect(screen.queryByText(/^-50$/)).not.toBeInTheDocument();
  });
});
