// B117: Deny used to fire on a single click of a type="submit" button --
// unlike Approve, which already got a ConfirmButton gate (see
// EntitlementRequestsApprove.test.tsx). This proves Deny now requires the
// same two-click confirm, and that a first click alone never calls the
// backend.
//
// B118: the request list showed only the target limit, never what it was a
// change FROM, so "what exactly is being approved/denied" wasn't clear.
// This proves the new "Current limit" and "Requested at" (createdAt)
// columns render the missing context.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import EntitlementRequests from '../../src/pages/entitlements/EntitlementRequests';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

/** GET /platform-admin/entitlement-requests -- the FLAT list-item wire shape. */
const PENDING_REQUEST = {
  requestId: 'req-1',
  familyId: 'fam-1',
  limitType: 'MANAGED_DEVICE_LIMIT',
  currentLimitAtRequest: 3,
  targetLimit: 9,
  state: 'PENDING',
  awaitingAdminQuote: false,
  noChargeOverride: false,
  quoteAmountMinor: null,
  quoteCurrencyCode: null,
  quoteExpiresAt: null,
  createdAt: '2026-08-15T12:00:00.000Z',
  updatedAt: '2026-08-15T12:00:00.000Z',
};

const DENIED_REQUEST = {
  ...PENDING_REQUEST,
  state: 'DENIED',
  quote: null,
  decidedByAdminId: 'admin-1',
  decisionReason: 'Not eligible',
  updatedAt: '2026-08-16T00:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(denyCalls: RequestInit[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
      if (url.includes('/deny')) {
        denyCalls.push(init ?? {});
        return Promise.resolve(jsonResponse(200, DENIED_REQUEST));
      }
      if (url.includes('/platform-admin/entitlement-requests')) {
        return Promise.resolve(jsonResponse(200, { items: [PENDING_REQUEST], total: 1, limit: 20, offset: 0 }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    }),
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/entitlement-requests']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <EntitlementRequests />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('EntitlementRequests deny confirmation and request context', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('renders the current limit and requested-at date alongside the target limit', async () => {
    const denyCalls: RequestInit[] = [];
    renderPage(denyCalls);

    expect(await screen.findByText('req-1')).toBeInTheDocument();
    // Current limit (3) and target limit (9) both on screen -- the "from"
    // half of the change is no longer missing.
    expect(await screen.findByRole('cell', { name: '3' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: '9' })).toBeInTheDocument();
    expect(screen.getByText(new Date(PENDING_REQUEST.createdAt).toLocaleString())).toBeInTheDocument();
  });

  it('requires a reason AND a second Confirm click before denying -- a single click never calls the backend', async () => {
    const denyCalls: RequestInit[] = [];
    renderPage(denyCalls);
    await screen.findByText('req-1');

    await userEvent.type(screen.getByLabelText('Denial reason'), 'Not eligible');
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

    // First click only arms ConfirmButton -- no request fired yet.
    expect(denyCalls.length).toBe(0);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(denyCalls.length).toBe(1));

    const sent = denyCalls[0];
    expect(sent.method).toBe('POST');
    expect(JSON.parse(sent.body as string)).toEqual({ reason: 'Not eligible' });
    expect(await screen.findByText('Request denied.')).toBeInTheDocument();
  });
});
