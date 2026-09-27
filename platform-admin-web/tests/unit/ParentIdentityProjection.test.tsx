import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import AccountDetail from '../../src/pages/accounts/AccountDetail';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

const ACCOUNT = {
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderAccountDetail() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/accounts/fam-1']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Routes>
                <Route path="/accounts/:id" element={<AccountDetail />} />
              </Routes>
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('family-scoped Parent identity projection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('renders only name, email, and phone from the selected family identity endpoint', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['PLATFORM_ADMIN'] }));
      if (url.endsWith('/platform-admin/accounts/fam-1/identity')) {
        return Promise.resolve(jsonResponse(200, {
          firstName: 'Mina',
          lastName: 'Hassan',
          email: 'mina@example.test',
          phoneNumber: null,
          accountId: 'must-not-display',
          familyMemberships: [{ familyId: 'other-family', role: 'ADMINISTRATOR' }],
          emailVerified: true,
          passwordHash: 'must-not-display',
        }));
      }
      if (url.endsWith('/platform-admin/accounts/fam-1')) return Promise.resolve(jsonResponse(200, ACCOUNT));
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAccountDetail();

    expect(await screen.findByText('Mina')).toBeInTheDocument();
    expect(screen.getByText('Hassan')).toBeInTheDocument();
    expect(screen.getByText('mina@example.test')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('must-not-display')).not.toBeInTheDocument();
    expect(screen.queryByText('other-family')).not.toBeInTheDocument();
    expect(screen.queryByText('true')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/platform-admin/accounts/fam-1/identity'))).toBe(true);
  });

  it('shows a generic unavailable state when family identity is ambiguous or unauthorized', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['PLATFORM_ADMIN'] }));
        if (url.endsWith('/platform-admin/accounts/fam-1/identity')) return Promise.resolve(jsonResponse(409, { error: 'identity_unavailable' }));
        if (url.endsWith('/platform-admin/accounts/fam-1')) return Promise.resolve(jsonResponse(200, ACCOUNT));
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );

    renderAccountDetail();

    expect(await screen.findByText('Parent identity is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('identity_unavailable')).not.toBeInTheDocument();
  });

  it('does not request or render Parent identity for a role denied by the client RBAC mirror', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['FINANCE_ADMIN'] }));
      if (url.endsWith('/platform-admin/accounts/fam-1')) return Promise.resolve(jsonResponse(200, ACCOUNT));
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAccountDetail();

    expect(await screen.findByText('Account status actions')).toBeInTheDocument();
    expect(screen.queryByText('Parent identity')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/platform-admin/accounts/fam-1/identity'))).toBe(false);
  });
});
