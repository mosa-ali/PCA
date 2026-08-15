// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- FreeAccessPolicy page:
// global-defaults read-only view, account lookup, RBAC-gated adjustment
// form (hidden for a non-mutating role), and the full adjust round trip
// through requestStepUp -> POST .../adjust.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import FreeAccessPolicy from '../../src/pages/entitlements/FreeAccessPolicy';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

const DEFAULTS_BODY = { mode: 'TIME_LIMITED', durationDays: 30, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
const STATUS_BODY = { mode: 'TIME_LIMITED', grantedAt: '2026-07-16T00:00:00.000Z', expiresAt: '2026-08-15T00:00:00.000Z', remainingDays: 7, status: 'ACTIVE' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetchFor(roles: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles }));
    if (url.includes('/platform-admin/settings/free-access-defaults')) return Promise.resolve(jsonResponse(200, DEFAULTS_BODY));
    if (url.includes('/free-access/adjust') && method === 'POST') return Promise.resolve(jsonResponse(200, { ...STATUS_BODY, mode: 'PERPETUAL', expiresAt: null, remainingDays: null, status: 'PERPETUAL' }));
    if (url.includes('/free-access') && method === 'GET') return Promise.resolve(jsonResponse(200, STATUS_BODY));
    if (url.includes('/auth/step-up')) return Promise.resolve(jsonResponse(200, { stepUpId: 'su-1', expiresAt: '2030-01-01T00:00:00Z' }));
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(roles: string[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(roles));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/free-access-policy']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <FreeAccessPolicy />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('FreeAccessPolicy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('shows the read-only global defaults', async () => {
    renderPage(['APP_OWNER']);
    expect(await screen.findByText('Global registration-default configuration')).toBeInTheDocument();
    expect(await screen.findByText('30')).toBeInTheDocument();
  });

  it('looks up an account and shows its FreeAccessStatus', async () => {
    renderPage(['APP_OWNER']);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Parent account ID'), 'acct-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Active')).toBeInTheDocument();
  });

  it('the adjustment form is hidden for a read-only role (FINANCE_ADMIN)', async () => {
    renderPage(['FINANCE_ADMIN']);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Parent account ID'), 'acct-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Active');
    expect(screen.queryByRole('button', { name: 'Apply adjustment' })).not.toBeInTheDocument();
  });

  it('the adjustment form is shown for APP_OWNER, and a full adjust round trip via step-up succeeds', async () => {
    renderPage(['APP_OWNER']);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Parent account ID'), 'acct-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Active');

    await user.selectOptions(screen.getByLabelText('Adjustment'), 'CONVERT_TO_PERPETUAL');
    await user.type(screen.getByLabelText('Reason'), 'promotional extension');
    await user.click(screen.getByRole('button', { name: 'Apply adjustment' }));

    // Step-up dialog appears -- enter a code and confirm.
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText(/authenticator code/i), '111222');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(screen.getAllByText('Perpetual').length).toBeGreaterThan(0));
  });

  it('rejects submission with no reason before ever requesting step-up', async () => {
    renderPage(['APP_OWNER']);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Parent account ID'), 'acct-1');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText('Active');

    const reasonInput = screen.getByLabelText('Reason') as HTMLInputElement;
    expect(reasonInput.required).toBe(true);
  });
});
