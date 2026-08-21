import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { renderWithProviders } from '../utils/renderWithProviders';
import * as AuthContextModule from '../../src/state/AuthContext';

// AppLayout's session gate (see its own doc comment) is the one place that
// stands between an unauthenticated visitor and every protected route. The
// real AuthProvider used by renderWithProviders always resolves a non-null
// dev-fixture session in this test environment (VITE_PCA_DEMO_MODE=true --
// see tests/setup.ts / vitest.config.ts), so it alone can only exercise the
// "authenticated" path. To exercise session===null and loading===true we
// mock useAuth directly, defaulting the mock to call through to the REAL
// useAuth implementation (so the authenticated-path test below still goes
// through the real AuthProvider/dev-fixture session, not a hand-rolled
// stub) and overriding it per-test with mockReturnValue where a specific
// session/loading combination is required.
const authContextHoisted = vi.hoisted(() => ({
  // Populated by the vi.mock factory below (which runs after this, but
  // before any test code) with the REAL, unmocked useAuth implementation,
  // so tests can restore call-through-to-real behaviour on demand instead
  // of hand-rolling a stub session for the authenticated-path test.
  realUseAuth: undefined as undefined | (() => unknown),
}));

vi.mock('../../src/state/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/AuthContext')>();
  authContextHoisted.realUseAuth = actual.useAuth;
  return {
    ...actual,
    useAuth: vi.fn(actual.useAuth),
  };
});

const mockedUseAuth = vi.mocked(AuthContextModule.useAuth);

function TestShell() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
      </Route>
      <Route path="/login" element={<div>Login page marker</div>} />
    </Routes>
  );
}

describe('AppLayout session gate', () => {
  beforeEach(() => {
    // Reset to a call-through-to-the-real-hook default before each test;
    // tests that need a specific session/loading combination override it
    // with mockReturnValue below.
    mockedUseAuth.mockReset();
    if (authContextHoisted.realUseAuth) {
      mockedUseAuth.mockImplementation(authContextHoisted.realUseAuth as typeof AuthContextModule.useAuth);
    }
  });

  it('redirects to /login when session is null and not loading, and never renders the protected shell', async () => {
    mockedUseAuth.mockReturnValue({
      session: null,
      loading: false,
      isFixtureBacked: true,
      setDemoRole: vi.fn(),
    });

    renderWithProviders(<TestShell />, { route: '/dashboard' });

    expect(await screen.findByText('Login page marker')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument();
  });

  it('renders nothing while loading (no shell chrome, no protected content)', () => {
    mockedUseAuth.mockReturnValue({
      session: null,
      loading: true,
      isFixtureBacked: true,
      setDemoRole: vi.fn(),
    });

    const { container } = renderWithProviders(<TestShell />, { route: '/dashboard' });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login page marker')).not.toBeInTheDocument();
  });

  it('renders the protected shell and routed content for an authenticated (non-null) session', async () => {
    // Uses the real AuthProvider's dev-fixture session (always non-null in
    // this test environment) via the mock's pass-through default.
    renderWithProviders(<TestShell />, { route: '/dashboard' });

    expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
    expect(screen.queryByText('Login page marker')).not.toBeInTheDocument();
  });
});
