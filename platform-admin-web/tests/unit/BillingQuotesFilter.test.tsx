// Mirrors AuditDateRangeFilter.test.tsx: GET /platform-admin/quotes/pending
// uses one list-first filter form for exact Parent email and calendar range.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingQuotes from '../../src/pages/billing/BillingQuotes';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetchFor(quoteCalls: string[], quoteStatus = 200) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/quotes/pending')) {
      quoteCalls.push(url);
      return Promise.resolve(jsonResponse(quoteStatus, quoteStatus >= 500 ? { error: 'server_error' } : { items: [], total: 0 }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(quoteCalls: string[], quoteStatus?: number) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(quoteCalls, quoteStatus));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/billing/quotes']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <BillingQuotes />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Billing quotes family/date filter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('submits Parent email and both date filters together in one server-side request', async () => {
    const quoteCalls: string[] = [];
    renderPage(quoteCalls);

    await screen.findByText('No requests are awaiting a custom admin quote.');
    const emailInput = screen.getByLabelText('Parent email (exact)');
    const sinceInput = screen.getByLabelText('From date');
    const untilInput = screen.getByLabelText('To date');
    await userEvent.type(emailInput, ' parent@example.com ');
    await userEvent.type(sinceInput, '2026-01-01');
    await userEvent.type(untilInput, '2026-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    const lastCall = quoteCalls[quoteCalls.length - 1];
    expect(lastCall).toContain('parentEmail=parent%40example.com');
    expect(lastCall).toContain('since=2026-01-01');
    expect(lastCall).toContain('until=2026-01-31');
    expect(screen.getAllByRole('button', { name: 'Apply filters' })).toHaveLength(1);
  });

  it('distinguishes an empty unfiltered queue from an empty filter result', async () => {
    const quoteCalls: string[] = [];
    renderPage(quoteCalls);
    await screen.findByText('No requests are awaiting a custom admin quote.');
    await userEvent.type(screen.getByLabelText('Parent email (exact)'), 'parent@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('No pending quote requests match these filters.')).toBeInTheDocument();
  });

  it('renders the API error state for a failed custom quotes request and retries the request', async () => {
    const quoteCalls: string[] = [];
    renderPage(quoteCalls, 503);

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.queryByText('No requests are awaiting a custom admin quote.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(quoteCalls).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(quoteCalls).toHaveLength(2);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
  });
});
