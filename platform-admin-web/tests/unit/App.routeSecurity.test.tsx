import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/App';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';
import { AppearanceProvider } from '../../src/state/AppearanceContext';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Answers every request the Settings page issues on mount (whoami plus the
 * five independent reads: free-starter defaults, currencies, market
 * mapping, and each named settings category), not just whoami -- a bare
 * `mockResolvedValue(whoamiBody)` would make every one of those additional
 * GETs resolve with the whoami shape instead, which Settings.tsx can't
 * parse and would surface as a page-level error state, not the redirect-vs-
 * render outcome these tests actually care about.
 */
function settingsFetchMock(roles: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles }));
    if (url.includes('/platform-admin/settings/category/')) return Promise.resolve(jsonResponse(200, { items: [] }));
    if (url.includes('/platform-admin/settings/free-starter-defaults')) {
      return Promise.resolve(
        jsonResponse(200, { tier: 'FREE_STARTER', parentMemberLimit: 2, managedDeviceLimit: 3, updatedAt: '2026-01-01T00:00:00.000Z', updatedByAdminId: 'admin-1' }),
      );
    }
    if (url.includes('/platform-admin/settings/currencies')) return Promise.resolve(jsonResponse(200, { items: [] }));
    if (url.includes('/platform-admin/settings/market-mapping')) return Promise.resolve(jsonResponse(200, { items: [] }));
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>
          <StepUpProvider>
            <AppearanceProvider><App /></AppearanceProvider>
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

    it('AUDITOR_READ_ONLY CAN view billing/plans (VIEW_BILLING_RECORDS ALLOW per billing/rbac.ts) but is not redirected', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'auditor-1', roles: ['AUDITOR_READ_ONLY'] })),
      );
      renderAppAt('/billing/plans');
      await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
      // Legacy plan URLs now open the Plans tab inside Commercial & Pricing.
      expect(await screen.findByRole('heading', { name: /commercial & pricing/i, level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^plans$/i })).toHaveAttribute('aria-current', 'page');
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

    describe('the /settings route (APP_OWNER/PLATFORM_ADMIN only)', () => {
      it.each([
        ['AUDITOR_READ_ONLY'],
        ['FINANCE_ADMIN'],
        ['SUPPORT_ADMIN'],
      ])('%s is redirected from /settings (ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS DENY)', async (role) => {
        vi.stubGlobal('fetch', settingsFetchMock([role]));
        renderAppAt('/settings');

        expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
      });

      it('PLATFORM_ADMIN reaches /settings and sees non-sensitive write controls', async () => {
        vi.stubGlobal('fetch', settingsFetchMock(['PLATFORM_ADMIN']));
        renderAppAt('/settings');

        await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
        expect(await screen.findByRole('heading', { name: /settings/i, level: 1 })).toBeInTheDocument();
        expect((await screen.findAllByLabelText('Setting key')).length).toBeGreaterThan(0);
      });

      it('an admin with no active platform-admin roles is redirected away from /settings', async () => {
        vi.stubGlobal('fetch', settingsFetchMock([]));
        renderAppAt('/settings');
        expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
      });
    });
  });
});
