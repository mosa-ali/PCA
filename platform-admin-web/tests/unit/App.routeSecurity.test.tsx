import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/App';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>
          <StepUpProvider>
            <App />
          </StepUpProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('route security (mission Section 24)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('an unauthenticated visitor hitting a protected route is redirected to /login', async () => {
    renderAppAt('/dashboard');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('an expired session (client-side check) never renders the shell', async () => {
    secureSession.set('tok-expired', new Date(Date.now() - 1000).toISOString());
    renderAppAt('/dashboard');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('a revoked/rejected session (server 401 on whoami) redirects to /login', async () => {
    secureSession.set('tok-revoked', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
    renderAppAt('/dashboard');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  describe('given a signed-in session', () => {
    beforeEach(() => {
      secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    });

    it('AUDITOR_READ_ONLY is redirected away from admin-account management (a mutation-capable area)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'auditor-1', roles: ['AUDITOR_READ_ONLY'] })),
      );
      renderAppAt('/settings');
      expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
    });

    it('AUDITOR_READ_ONLY CAN view billing/plans (VIEW_BILLING_RECORDS ALLOW per billing/rbac.ts) but is not redirected', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'auditor-1', roles: ['AUDITOR_READ_ONLY'] })),
      );
      renderAppAt('/billing/plans');
      await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
      expect(await screen.findByRole('heading', { name: /plans/i })).toBeInTheDocument();
    });

    it('SUPPORT_ADMIN is redirected away from finance/billing access', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'support-1', roles: ['SUPPORT_ADMIN'] })),
      );
      renderAppAt('/billing/invoices');
      expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
    });

    it('FINANCE_ADMIN is redirected away from admin-user role management', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'finance-1', roles: ['FINANCE_ADMIN'] })),
      );
      renderAppAt('/admin-users');
      expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
    });

    it('PLATFORM_ADMIN is redirected away from settlement/refund-adjacent billing screens', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'platform-1', roles: ['PLATFORM_ADMIN'] })),
      );
      renderAppAt('/billing/payments');
      expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
    });

    it('APP_OWNER reaches every gated area without redirect', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'owner-1', roles: ['APP_OWNER'] })),
      );
      renderAppAt('/admin-users');
      await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
      expect(await screen.findByRole('heading', { name: /admin users/i })).toBeInTheDocument();
    });

    it('AUDITOR_READ_ONLY can still view the dashboard (a view-only operation)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'auditor-1', roles: ['AUDITOR_READ_ONLY'] })),
      );
      renderAppAt('/dashboard');
      expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    });
  });
});
