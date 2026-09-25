// B103/B105: GET /platform-admin/accounts had rows but no way to search or
// sort them (docs/product-completion/PCA_P1_P2_BEHAVIOR_LEDGER.csv). This
// proves the search form sends `parentEmail`, and that clicking a sortable
// column header sends `sortBy`/`sortDir` and toggles direction on a second
// click -- mirrors AdminUsersMfaAndSearch.test.tsx's "assert on the query
// string actually sent" convention.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import AccountsList from '../../src/pages/accounts/AccountsList';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

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

function mockFetchFor(accountsCalls: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/accounts/resolve-parent-email')) {
      accountsCalls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
      return Promise.resolve(jsonResponse(200, {
        outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: ['fam-1'],
        account: {
          status: 'VERIFIED', createdAt: '2026-01-01T00:00:00.000Z', verifiedAt: '2026-01-01T00:00:00.000Z',
          disabledAt: null, accountType: 'PARENT_GUARDIAN', estimatedChildCount: null, freeAccessMode: null,
          freeAccessStartedAt: null, freeAccessExpiresAt: null, defaultParentMemberLimit: null, defaultManagedDeviceLimit: null,
        },
        families: [{ familyId: 'fam-1', status: 'ACTIVE', deletedAt: null }],
      }));
    }
    if (url.includes('/platform-admin/accounts')) {
      accountsCalls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
      return Promise.resolve(jsonResponse(200, { items: [ACCOUNT], total: 1, limit: 20, offset: 0 }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(accountsCalls: string[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(accountsCalls));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/accounts']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <AccountsList />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('AccountsList search and sort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('sends the default sort (createdAt desc) on initial load', async () => {
    const calls: string[] = [];
    renderPage(calls);
    expect(await screen.findByText('fam-1')).toBeInTheDocument();
    expect(calls[calls.length - 1]).toContain('sortBy=createdAt');
    expect(calls[calls.length - 1]).toContain('sortDir=desc');
  });

  it('resolves Parent Email first, then uses the family account read model', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findAllByText('fam-1');

    const input = screen.getByLabelText('Search by Parent Email');
    await userEvent.type(input, ' parent@example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findAllByText('fam-1');
    expect(calls.some((call) => call.includes('/resolve-parent-email') && call.includes('"email":"parent@example.com"'))).toBe(true);
    expect(calls.some((call) => call.includes('/accounts/search') && call.includes('"parentEmail":"parent@example.com"'))).toBe(true);
  });

  it('shows invalid email feedback without issuing an email resolution request', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findByText('fam-1');
    const previousCount = calls.length;
    await userEvent.type(screen.getByLabelText('Search by Parent Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid Parent email address.');
    expect(calls).toHaveLength(previousCount);
  });

  it('sorts by Family ID (descending) on first click, and reverses to ascending on a second click', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findByText('fam-1');

    // Re-query the header on each click rather than reusing one reference:
    // the table (loading && ...) unmounts/remounts around every load(), so a
    // reference captured before a click can point at an already-detached
    // node by the time the next click needs it.
    await userEvent.click(screen.getByRole('button', { name: /Family ID/ }));
    let last = calls[calls.length - 1];
    expect(last).toContain('sortBy=familyId');
    expect(last).toContain('sortDir=desc');

    await userEvent.click(screen.getByRole('button', { name: /Family ID/ }));
    last = calls[calls.length - 1];
    expect(last).toContain('sortBy=familyId');
    expect(last).toContain('sortDir=asc');
  });

  it('marks the active sort column with aria-sort for assistive technology', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findByText('fam-1');

    const createdHeader = screen.getByRole('columnheader', { name: /Created/ });
    expect(createdHeader).toHaveAttribute('aria-sort', 'descending');

    const familyIdHeader = screen.getByRole('columnheader', { name: 'Family ID' });
    expect(familyIdHeader).toHaveAttribute('aria-sort', 'none');
  });
});
