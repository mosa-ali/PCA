// GET /platform-admin/admin-users now accepts name/email search params
// (backend/src/http/routes/platformadmin/adminUserRoutes.ts), and the
// mfaStatus column used to render the raw untranslated enum. This proves
// the search form sends both params and that mfaStatus (including the
// null "never started MFA setup" case) renders as a translated badge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import AdminUsers from '../../src/pages/AdminUsers';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';
import type { AdminUserSummary } from '../../src/domain/adminUsers';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ADMINS: AdminUserSummary[] = [
  {
    adminId: 'admin-active',
    displayName: 'Active Admin',
    status: 'ACTIVE',
    roles: ['SUPPORT_ADMIN'],
    mfaStatus: 'ACTIVE',
    createdAt: null,
    disabledAt: null,
  },
  {
    adminId: 'admin-no-mfa',
    displayName: 'No MFA Admin',
    status: 'ACTIVE',
    roles: ['SUPPORT_ADMIN'],
    mfaStatus: null,
    createdAt: null,
    disabledAt: null,
  },
];

function mockFetchFor(adminUserCalls: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/admin-users')) {
      adminUserCalls.push(url);
      return Promise.resolve(jsonResponse(200, { items: ADMINS, total: ADMINS.length }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(adminUserCalls: string[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(adminUserCalls));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/admin-users']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <AdminUsers />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Admin users mfaStatus badge and name/email search', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('renders a translated badge for a set mfaStatus and for the null (never started) case', async () => {
    renderPage([]);

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(await screen.findByText('Not started')).toBeInTheDocument();
  });

  it('sends name/email in the query string once the search form is submitted', async () => {
    const adminUserCalls: string[] = [];
    renderPage(adminUserCalls);

    const nameInput = await screen.findByLabelText('Search by name');
    const emailInput = screen.getByLabelText('Search by email');
    await userEvent.type(nameInput, 'Jane');
    await userEvent.type(emailInput, 'jane@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    const lastCall = adminUserCalls[adminUserCalls.length - 1];
    expect(lastCall).toContain('name=Jane');
    expect(lastCall).toContain(`email=${encodeURIComponent('jane@example.com')}`);
  });
});
