// /entitlement-requests had zero test coverage anywhere, and its Approve
// action could never succeed.
//
// platformAdminApiClient.post() always sends Content-Type: application/json
// but used to send `body: undefined` when a call site passed no body --
// which EntitlementRequests.onApprove does for
// POST /platform-admin/entitlement-requests/:id/approve-parent-member.
// Fastify's default JSON parser rejects a declared-JSON request with an
// empty body (FST_ERR_CTP_EMPTY_JSON_BODY, statusCode 400) BEFORE the
// route's preHandler chain runs, and backend/src/http/buildServer.ts's
// error handler rewrites it to {error:'invalid_request'} -- so the operator
// saw a hard failure on every approval.
//
// Both tests below assert on what actually goes over the wire (a
// syntactically valid JSON document), which is the property the backend
// parser cares about -- not merely that a request was made.
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
import { platformAdminApi } from '../../src/api/platformAdminApiClient';

/** GET /platform-admin/entitlement-requests -- the FLAT list-item wire shape. */
const PENDING_REQUEST = {
  requestId: 'req-1',
  familyId: 'fam-1',
  limitType: 'PARENT_MEMBER_LIMIT',
  currentLimitAtRequest: 2,
  targetLimit: 3,
  state: 'PENDING',
  awaitingAdminQuote: false,
  noChargeOverride: false,
  quoteAmountMinor: null,
  quoteCurrencyCode: null,
  quoteExpiresAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** POST .../approve-parent-member -- requestToDto, the NESTED detail shape. */
const APPROVED_REQUEST = {
  requestId: 'req-1',
  familyId: 'fam-1',
  limitType: 'PARENT_MEMBER_LIMIT',
  currentLimitAtRequest: 2,
  targetLimit: 3,
  state: 'APPROVED',
  awaitingAdminQuote: false,
  noChargeOverride: false,
  quote: null,
  decidedByAdminId: 'admin-1',
  decisionReason: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(approveCalls: RequestInit[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
      if (url.includes('/approve-parent-member')) {
        approveCalls.push(init ?? {});
        return Promise.resolve(jsonResponse(200, APPROVED_REQUEST));
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

describe('EntitlementRequests approve round-trip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('approves a pending parent-member request with a parseable JSON body, and reflects the new state', async () => {
    const approveCalls: RequestInit[] = [];
    renderPage(approveCalls);

    expect(await screen.findByText('req-1')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(approveCalls.length).toBe(1));

    const sent = approveCalls[0];
    expect(sent.method).toBe('POST');
    // The header says JSON, so the body must BE JSON -- an absent/empty body
    // is what Fastify rejected with FST_ERR_CTP_EMPTY_JSON_BODY -> 400.
    expect((sent.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(typeof sent.body).toBe('string');
    expect(() => JSON.parse(sent.body as string)).not.toThrow();

    // Scoped to the table cell: the state filter <select> also contains an
    // "Approved" option, which is not evidence of anything.
    expect(await screen.findByRole('cell', { name: 'Approved' })).toBeInTheDocument();
    expect(screen.getByText('Request approved.')).toBeInTheDocument();
  });

  it('post() with no body argument still sends a valid empty JSON document', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await platformAdminApi.post('/platform-admin/entitlement-requests/req-1/approve-parent-member');

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.body).toBe('{}');
    expect(JSON.parse(init.body as string)).toEqual({});
  });
});
