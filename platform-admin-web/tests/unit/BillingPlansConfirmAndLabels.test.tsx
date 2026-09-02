// B128/B129 (docs/product-completion/PCA_P1_P2_BEHAVIOR_LEDGER.csv,
// BillingPlans.tsx): B128 ("no confirmation before creating a new plan
// version") was already fixed by commit 211bc3f, which wired the shared
// two-click ConfirmButton (see ConfirmButton.tsx's doc comment) around the
// create-plan-version form's submit action. B129 ("raw status/cadence enum
// values") was already resolved by the same t(key, rawValue) fallback
// pattern this app uses elsewhere (see enumLabels.ts / commit b43a9f0),
// applied to both the browse-all table and the exact-plan-code-search
// table. Neither fix had a dedicated regression test that exercises the
// real BillingPlans component end to end -- ConfirmButton.test.tsx only
// covers the shared component in isolation, and the e2e-real spec requires
// a live backend -- so this file is that test, guarding against a future
// change silently reintroducing an unconfirmed mutation or a raw enum code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingPlans from '../../src/pages/billing/BillingPlans';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const RETIRED_ONE_TIME_PLAN = {
  planId: 'plan-retired',
  planCode: 'LEGACY_ONE_TIME',
  planVersion: 2,
  status: 'RETIRED',
  billingCadence: 'ONE_TIME',
  defaultParentMemberLimit: 1,
  defaultManagedDeviceLimit: 2,
  priceBookId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderPage() {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/billing/plans']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <BillingPlans />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('BillingPlans status/cadence labels (B129)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('renders translated status and billing-cadence labels in the browse-all table, never the raw enum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (url.includes('/platform-admin/billing/plans')) return Promise.resolve(jsonResponse(200, { items: [RETIRED_ONE_TIME_PLAN], total: 1, limit: 20, offset: 0 }));
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderPage();

    // Scope to the browse-all table itself: "Retired"/"One-time" also appear
    // as <option> text in the status/cadence filter and create-plan-version
    // selects on this same page, so an unscoped screen.findByText would see
    // multiple matches.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Retired')).toBeInTheDocument();
    expect(within(table).getByText('One-time')).toBeInTheDocument();
    expect(within(table).queryByText('RETIRED')).not.toBeInTheDocument();
    expect(within(table).queryByText('ONE_TIME')).not.toBeInTheDocument();
    // Distinct badge styling per status (not every non-ACTIVE status sharing
    // the same warning color) -- RETIRED renders as the danger badge.
    expect(within(table).getByText('Retired').closest('span')).toHaveClass('badge-danger');
  });

  it('renders translated status and billing-cadence labels in the exact-plan-code-search table, never the raw enum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (/\/platform-admin\/billing\/plans\/[^/?]+/.test(url)) return Promise.resolve(jsonResponse(200, { items: [RETIRED_ONE_TIME_PLAN] }));
        if (url.includes('/platform-admin/billing/plans')) return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderPage();
    await screen.findByText(i18n.t('common.empty'));

    await userEvent.type(screen.getByLabelText('Plan code', { selector: '#plan-code-search' }), 'LEGACY_ONE_TIME');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    // Browse-all is empty (renders the "empty" paragraph, no table), so the
    // search-result table is the only <table> on the page here.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Retired')).toBeInTheDocument();
    expect(within(table).getByText('One-time')).toBeInTheDocument();
    expect(within(table).queryByText('RETIRED')).not.toBeInTheDocument();
    expect(within(table).queryByText('ONE_TIME')).not.toBeInTheDocument();
  });
});

describe('BillingPlans create-plan-version confirmation gate (B128)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('does not POST on the first click of "Create plan version", only after an explicit Confirm click', async () => {
    const postCalls: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (init?.method === 'POST' && url.endsWith('/platform-admin/billing/plans')) {
          const body = JSON.parse(String(init.body)) as { planCode: string; status: string; billingCadence: string; defaultParentMemberLimit: number; defaultManagedDeviceLimit: number };
          postCalls.push(body);
          return Promise.resolve(
            jsonResponse(201, {
              planId: 'plan-new',
              planCode: body.planCode,
              planVersion: 1,
              status: body.status,
              billingCadence: body.billingCadence,
              defaultParentMemberLimit: body.defaultParentMemberLimit,
              defaultManagedDeviceLimit: body.defaultManagedDeviceLimit,
              priceBookId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            }),
          );
        }
        if (url.includes('/platform-admin/billing/plans')) return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderPage();
    await screen.findByText(i18n.t('common.empty'));

    await userEvent.type(screen.getByLabelText('Plan code', { selector: '#new-plan-code' }), 'NEW_PLAN_CODE');
    await userEvent.type(screen.getByLabelText(i18n.t('settings.parentMemberLimit')), '3');
    await userEvent.type(screen.getByLabelText(i18n.t('settings.managedDeviceLimit')), '5');

    await userEvent.click(screen.getByRole('button', { name: i18n.t('billing.createPlan') }));
    expect(postCalls).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: i18n.t('common.confirm') }));
    expect(postCalls).toHaveLength(1);
    expect(await screen.findByText(/created/i)).toBeInTheDocument();
  });

  it('never fires the create-plan POST when Cancel is clicked after arming', async () => {
    const postCalls: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (init?.method === 'POST' && url.endsWith('/platform-admin/billing/plans')) {
          postCalls.push(init.body);
          return Promise.resolve(jsonResponse(201, RETIRED_ONE_TIME_PLAN));
        }
        if (url.includes('/platform-admin/billing/plans')) return Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 20, offset: 0 }));
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );
    renderPage();
    await screen.findByText(i18n.t('common.empty'));

    await userEvent.type(screen.getByLabelText('Plan code', { selector: '#new-plan-code' }), 'NEW_PLAN_CODE');
    await userEvent.type(screen.getByLabelText(i18n.t('settings.parentMemberLimit')), '3');
    await userEvent.type(screen.getByLabelText(i18n.t('settings.managedDeviceLimit')), '5');

    await userEvent.click(screen.getByRole('button', { name: i18n.t('billing.createPlan') }));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }));

    expect(postCalls).toHaveLength(0);
    expect(screen.getByRole('button', { name: i18n.t('billing.createPlan') })).toBeInTheDocument();
  });
});
