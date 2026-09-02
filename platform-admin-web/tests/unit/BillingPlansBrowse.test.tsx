// Before this change, BillingPlans.tsx could only look up plans by an exact
// plan code (GET /platform-admin/billing/plans/:planCode) -- there was no
// way to discover a plan code without already knowing one. This proves the
// new "browse all plans" table (backed by the new bare
// GET /platform-admin/billing/plans route) actually paginates and filters,
// and that the pre-existing exact-code search still works unchanged
// alongside it (BillingQuotesFilter.test.tsx/AuditDateRangeFilter.test.tsx's
// mock-fetch pattern).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingPlans from '../../src/pages/billing/BillingPlans';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const SAMPLE_PLAN = {
  planId: 'plan-1',
  planCode: 'FAMILY_STANDARD',
  planVersion: 3,
  status: 'ACTIVE',
  billingCadence: 'MONTHLY',
  defaultParentMemberLimit: 4,
  defaultManagedDeviceLimit: 10,
  priceBookId: 'pb-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function mockFetchFor(browseCalls: string[], searchCalls: string[], total = 1) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    // Exact-code route: .../billing/plans/:planCode -- has an extra path
    // segment past "plans", so check it BEFORE the bare-list check below.
    if (/\/platform-admin\/billing\/plans\/[^/?]+/.test(url)) {
      searchCalls.push(url);
      return Promise.resolve(jsonResponse(200, { items: [SAMPLE_PLAN] }));
    }
    if (url.includes('/platform-admin/billing/plans')) {
      browseCalls.push(url);
      return Promise.resolve(jsonResponse(200, { items: [SAMPLE_PLAN], total, limit: 20, offset: new URL(url).searchParams.get('offset') ?? 0 }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(browseCalls: string[], searchCalls: string[], total = 1) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(browseCalls, searchCalls, total));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/billing/plans']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <BillingPlans />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Billing plans browse-all table', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('loads the bare browse-all list on mount without requiring a plan code first', async () => {
    const browseCalls: string[] = [];
    const searchCalls: string[] = [];
    renderPage(browseCalls, searchCalls);

    expect(await screen.findByText('FAMILY_STANDARD')).toBeInTheDocument();
    expect(browseCalls.length).toBeGreaterThan(0);
    expect(new URL(browseCalls[0]).pathname).toBe('/platform-admin/billing/plans');
    expect(searchCalls.length).toBe(0);
  });

  it('sends status/billingCadence filters in the query string once "Apply filters" is clicked', async () => {
    const browseCalls: string[] = [];
    const searchCalls: string[] = [];
    renderPage(browseCalls, searchCalls);
    await screen.findByText('FAMILY_STANDARD');

    await userEvent.selectOptions(screen.getByLabelText('Status', { selector: '#browse-plan-status' }), 'ACTIVE');
    await userEvent.selectOptions(screen.getByLabelText('Billing cadence', { selector: '#browse-plan-cadence' }), 'MONTHLY');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    const lastCall = new URL(browseCalls[browseCalls.length - 1]);
    expect(lastCall.searchParams.get('status')).toBe('ACTIVE');
    expect(lastCall.searchParams.get('billingCadence')).toBe('MONTHLY');
    expect(lastCall.searchParams.get('offset')).toBe('0');
  });

  it('paginates: Next advances the offset by the page size and re-fetches, Previous is disabled at offset 0', async () => {
    const browseCalls: string[] = [];
    const searchCalls: string[] = [];
    renderPage(browseCalls, searchCalls, 50);
    await screen.findByText('FAMILY_STANDARD');

    const prevButtons = screen.getAllByRole('button', { name: 'Previous' });
    expect(prevButtons[0]).toBeDisabled();

    const nextButtons = screen.getAllByRole('button', { name: 'Next' });
    await userEvent.click(nextButtons[0]);

    const lastCall = new URL(browseCalls[browseCalls.length - 1]);
    expect(lastCall.searchParams.get('offset')).toBe('20');
  });

  it('keeps the pre-existing exact-plan-code search working as a separate shortcut', async () => {
    const browseCalls: string[] = [];
    const searchCalls: string[] = [];
    renderPage(browseCalls, searchCalls);
    await screen.findByText('FAMILY_STANDARD');

    const codeInput = screen.getByLabelText('Plan code', { selector: '#plan-code-search' });
    await userEvent.type(codeInput, 'FAMILY_STANDARD');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Search by exact plan code')).toBeInTheDocument();
    const lastSearchCall = searchCalls[searchCalls.length - 1];
    expect(lastSearchCall).toContain('/platform-admin/billing/plans/FAMILY_STANDARD');
  });

  it('renders both the browse table and the exact-code-search table headings distinctly', async () => {
    const browseCalls: string[] = [];
    const searchCalls: string[] = [];
    renderPage(browseCalls, searchCalls);
    await screen.findByText('FAMILY_STANDARD');

    expect(screen.getByText('All plans')).toBeInTheDocument();
    expect(screen.getByText('Search by exact plan code')).toBeInTheDocument();
  });
});
