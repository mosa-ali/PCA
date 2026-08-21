// Dedicated component test for src/rbac/RouteGuard.tsx.
//
// No test file exercising RouteGuard.tsx in isolation existed prior to this
// file (only the indirect, full-App integration coverage in
// App.routeSecurity.test.tsx). This mirrors parent-web's
// tests/route/RouteGuard.test.tsx pattern: a minimal local TestApp wires the
// real RouteGuard component to real routes, using real roles/operations from
// src/domain/roles.ts, and asserts the permitted case renders the protected
// content while the denied case redirects to /not-permitted instead.
//
// useCurrentRoles() reads from the real AuthContext, which populates roles
// asynchronously (a real whoami round trip) rather than synchronously like
// parent-web's dev-role fallback. RouteGuard itself does not wait for that
// load to finish -- production only ever mounts it nested inside
// RequireSession, which withholds the guarded route until the session is
// confirmed SIGNED_IN, and Login bounces back to the originally-requested
// path (`location.state.from`) once that happens. This TestApp reproduces
// that exact real wiring (not a hand-rolled substitute) so the guard is
// exercised the same way App.tsx actually exercises it, avoiding a false
// "denied" reading from the transient pre-load render that a bare
// RouteGuard-with-no-RequireSession harness would produce.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { RouteGuard } from '../../src/rbac/RouteGuard';
import { RequireSession } from '../../src/rbac/RequireSession';
import Login from '../../src/pages/Login';
import NotPermitted from '../../src/pages/NotPermitted';
import { AuthProvider } from '../../src/state/AuthContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function AdminAccountsScreen() {
  return <div>Admin accounts content</div>;
}

function TestApp() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireSession><Outlet /></RequireSession>}>
        <Route
          path="/admin-users"
          element={
            <RouteGuard operation="VIEW_ADMIN_ACCOUNTS">
              <AdminAccountsScreen />
            </RouteGuard>
          }
        />
      </Route>
      <Route path="/not-permitted" element={<NotPermitted />} />
    </Routes>
  );
}

function renderAt(path: string, roles: string[]) {
  secureSession.set('tok-test', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { adminId: 'admin-1', roles })));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <TestApp />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('RouteGuard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('lets a permitted role (APP_OWNER, VIEW_ADMIN_ACCOUNTS: ALLOW) reach the guarded route', async () => {
    renderAt('/admin-users', ['APP_OWNER']);
    expect(await screen.findByText('Admin accounts content')).toBeInTheDocument();
  });

  it('blocks a denied role (SUPPORT_ADMIN, VIEW_ADMIN_ACCOUNTS: DENY), redirecting to /not-permitted', async () => {
    renderAt('/admin-users', ['SUPPORT_ADMIN']);
    expect(await screen.findByRole('heading', { name: /not permitted/i })).toBeInTheDocument();
    expect(screen.queryByText('Admin accounts content')).not.toBeInTheDocument();
  });
});
