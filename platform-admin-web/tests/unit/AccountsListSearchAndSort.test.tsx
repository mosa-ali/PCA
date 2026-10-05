// Directory loads without a lookup and applies server-side email/date filters.
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

function mockFetchFor(accountsCalls: string[], total = 1) {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/accounts')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      const requestUrl = new URL(url, 'http://localhost');
      accountsCalls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
      const offset = Number(requestUrl.searchParams.get('offset') ?? body.offset ?? 0);
      const limit = Number(requestUrl.searchParams.get('limit') ?? body.limit ?? 20);
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({
        ...ACCOUNT,
        familyId: `fam-${offset + index + 1}`,
      }));
      return Promise.resolve(jsonResponse(200, { items, total, limit, offset }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(accountsCalls: string[], total = 1) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(accountsCalls, total));
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

  it('shows the directory automatically and filters by exact Parent email and date range server-side', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findAllByText('fam-1');

    expect(calls.some((call) => call.includes('/platform-admin/accounts?'))).toBe(true);
    await userEvent.type(screen.getByLabelText('Email'), ' parent@example.com ');
    await userEvent.type(screen.getByLabelText('Created from'), '2026-01-01');
    await userEvent.type(screen.getByLabelText('Created to'), '2026-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await screen.findAllByText('fam-1');
    expect(calls.some((call) => call.includes('/accounts/search') && call.includes('"parentEmail":"parent@example.com"') && call.includes('"createdFrom":"2026-01-01"') && call.includes('"createdTo":"2026-01-31"'))).toBe(true);
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

  it('pages server results and resets the offset when filters are applied or cleared', async () => {
    const calls: string[] = [];
    renderPage(calls, 41);

    expect(await screen.findByText('fam-1')).toBeInTheDocument();
    expect(screen.getByText('1–20 of 41')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('fam-21')).toBeInTheDocument();
    expect(screen.getByText('21–40 of 41')).toBeInTheDocument();
    expect(calls.some((call) => call.includes('offset=20'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('fam-1')).toBeInTheDocument();
    expect(screen.getByText('1–20 of 41')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('fam-21')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), ' parent@example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('1–20 of 41')).toBeInTheDocument();
    expect(calls.some((call) => call.includes('"offset":0') && call.includes('"parentEmail":"parent@example.com"'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('fam-21')).toBeInTheDocument();
    const beforeClear = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('1–20 of 41')).toBeInTheDocument();
    expect(calls.slice(beforeClear).some((call) => call.includes('offset=0'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('21–40 of 41')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('fam-41')).toBeInTheDocument();
    expect(screen.getByText('41–41 of 41')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    const finalPageCallCount = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(calls).toHaveLength(finalPageCallCount);
  });
});
