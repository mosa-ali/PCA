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

    it('AUDITOR_READ_ONLY CAN view billing/plans (VIEW_BILLING_RECORDS ALLOW per billing/rbac.ts) but is not redirected', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'auditor-1', roles: ['AUDITOR_READ_ONLY'] })),
      );
      renderAppAt('/billing/plans');
      await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
      // level: 1 disambiguates the page's own <h1> from the "All plans"
      // browse-table <h2> BillingPlans.tsx also renders (both match /plans/i).
      expect(await screen.findByRole('heading', { name: /plans/i, level: 1 })).toBeInTheDocument();
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

    // B159: the /settings route guard used to require
    // ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS (APP_OWNER/PLATFORM_ADMIN
    // only), stricter than the backend's actual read gate on every GET this
    // page issues -- VIEW_SUPPORT_ACCOUNT_METADATA, ALLOW for all five roles
    // (backend/src/http/routes/platformadmin/settingsRoutes.ts's
    // requireView, PlatformAdminSettingsService.requireRead). The route
    // guard now uses VIEW_SUPPORT_ACCOUNT_METADATA too. These tests pin both
    // sides of that boundary: every role the backend serves reads to must
    // reach the page (and see no write controls it isn't entitled to), and
    // a role the backend would still reject must stay blocked.
    describe('the /settings route (B159: route guard aligned with the backend read gate)', () => {
      it.each([
        ['AUDITOR_READ_ONLY'],
        ['FINANCE_ADMIN'],
        ['SUPPORT_ADMIN'],
      ])('%s reaches /settings (VIEW_SUPPORT_ACCOUNT_METADATA ALLOW) but sees no write controls (ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS DENY)', async (role) => {
        vi.stubGlobal('fetch', settingsFetchMock([role]));
        renderAppAt('/settings');

        await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
        expect(await screen.findByRole('heading', { name: /settings/i, level: 1 })).toBeInTheDocument();

        // The mutation gate is unchanged and must still hide every write
        // form -- the fix widens read access only, never write access.
        expect(screen.queryByLabelText('Setting key')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      });

      it('PLATFORM_ADMIN still reaches /settings and still sees write controls (ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS ALLOW, unchanged by the fix)', async () => {
        vi.stubGlobal('fetch', settingsFetchMock(['PLATFORM_ADMIN']));
        renderAppAt('/settings');

        await waitFor(() => expect(screen.queryByRole('heading', { name: /not permitted/i })).not.toBeInTheDocument());
        expect(await screen.findByRole('heading', { name: /settings/i, level: 1 })).toBeInTheDocument();
        expect((await screen.findAllByLabelText('Setting key')).length).toBeGreaterThan(0);
      });

      it('an admin with no active platform-admin roles is still redirected away from /settings (VIEW_SUPPORT_ACCOUNT_METADATA DENY on an empty role set, matching the backend)', async () => {
        vi.stubGlobal('fetch', settingsFetchMock([]));
        renderAppAt('/settings');
        expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
      });
    });
  });
});
