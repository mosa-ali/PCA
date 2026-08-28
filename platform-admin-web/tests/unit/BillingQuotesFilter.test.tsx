// Mirrors AuditDateRangeFilter.test.tsx: GET /platform-admin/quotes/pending
// now accepts familyId/since/until query params (backend/src/http/routes/
// platformadmin/billingReadRoutes.ts), but the UI never exposed a way to
// set them. This proves the filter form actually sends them.
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

function mockFetchFor(quoteCalls: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/quotes/pending')) {
      quoteCalls.push(url);
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(quoteCalls: string[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(quoteCalls));
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

  it('sends familyId/since/until in the query string once the filter form is submitted', async () => {
    const quoteCalls: string[] = [];
    renderPage(quoteCalls);

    const familyInput = await screen.findByLabelText('Family ID');
    const sinceInput = screen.getByLabelText('From date');
    const untilInput = screen.getByLabelText('To date');
    await userEvent.type(familyInput, 'fam-123');
    await userEvent.type(sinceInput, '2026-01-01');
    await userEvent.type(untilInput, '2026-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    const lastCall = quoteCalls[quoteCalls.length - 1];
    expect(lastCall).toContain('familyId=fam-123');
    expect(lastCall).toContain('since=2026-01-01');
    expect(lastCall).toContain('until=2026-01-31');
  });
});
