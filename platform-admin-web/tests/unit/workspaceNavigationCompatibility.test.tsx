import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../../src/App';
import { NAV_SECTIONS } from '../../src/nav/navConfig';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { AppearanceProvider } from '../../src/state/AppearanceContext';
import { secureSession } from '../../src/security/secureSession';

const { mockRoles } = vi.hoisted(() => ({ mockRoles: { current: ['APP_OWNER'] as string[] } }));

vi.mock('../../src/state/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({
      status: 'SIGNED_IN',
      adminId: 'owner-1',
      displayName: 'Owner',
      roles: mockRoles.current,
      sessionExpiresAt: null,
      signOutReason: null,
      logout: vi.fn(),
      login: vi.fn(),
      revokeAllSessions: vi.fn(),
      refreshIdentity: vi.fn(),
    } as unknown as ReturnType<typeof actual.useAuth>),
    useCurrentRoles: () => mockRoles.current,
  };
});

vi.mock('../../src/pages/EnrollmentManagement', () => ({
  default: () => <p>Enrollment workspace reached</p>,
}));

vi.mock('../../src/pages/CommercialPricing', () => ({
  default: () => <p>Commercial workspace reached</p>,
}));

function CurrentLocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{location.pathname}{location.search}</output>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderAppAt(path: string) {
  secureSession.set('workspace-test-token', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) {
      return Promise.resolve(jsonResponse(200, { adminId: 'owner-1', roles: ['APP_OWNER'] }));
    }
    return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
  }));

  return render(
    <MemoryRouter initialEntries={[path]}>
      <CurrentLocationProbe />
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

describe('consolidated workspace navigation compatibility', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('exposes the two workspaces in the sidebar instead of their individual list pages', () => {
    const paths = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.path));
    expect(paths).toContain('/enrollment-management');
    expect(paths).toContain('/commercial-pricing');
    expect(paths).not.toContain('/accounts');
    expect(paths).not.toContain('/entitlements');
    expect(paths).not.toContain('/entitlement-requests');
    expect(paths).not.toContain('/complimentary-capacity');
    expect(paths).not.toContain('/free-access-policy');
    expect(paths).not.toContain('/billing/plans');
    expect(paths).not.toContain('/billing/pricing');
    expect(paths).not.toContain('/billing/quotes');
    expect(paths).toContain('/billing/invoices');
    expect(paths).toContain('/billing/payments');
    expect(paths).toContain('/settlement/accounts');
    expect(paths).toContain('/settlement/batches');
    expect(paths).toContain('/settlement/reconciliation');
  });

  it.each([
    ['/accounts', '/enrollment-management?tab=accounts'],
    ['/entitlements', '/enrollment-management?tab=entitlements'],
    ['/entitlement-requests', '/enrollment-management?tab=requests'],
    ['/complimentary-capacity', '/enrollment-management?tab=complimentary-capacity'],
  ])('keeps the bookmarked enrollment route %s usable', async (legacyPath, expectedLocation) => {
    renderAppAt(legacyPath);
    expect(await screen.findByText('Enrollment workspace reached')).toBeInTheDocument();
    expect(screen.getByLabelText('current location')).toHaveTextContent(expectedLocation);
  });

  it.each([
    ['/free-access-policy', '/commercial-pricing?tab=free-access-policy'],
    ['/billing/plans', '/commercial-pricing?tab=plans'],
    ['/billing/pricing', '/commercial-pricing?tab=price-book'],
    ['/billing/quotes', '/commercial-pricing?tab=custom-quotes'],
  ])('keeps the bookmarked commercial route %s usable', async (legacyPath, expectedLocation) => {
    renderAppAt(legacyPath);
    expect(await screen.findByText('Commercial workspace reached')).toBeInTheDocument();
    expect(screen.getByLabelText('current location')).toHaveTextContent(expectedLocation);
  });
});
