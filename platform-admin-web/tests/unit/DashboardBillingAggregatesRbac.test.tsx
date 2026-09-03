// PCA-BILLING-READ-SPLIT-1 (security fix, web side): GET
// /platform-admin/dashboard now OMITS `subscriptionsByStatus`,
// `subscriptionsByPlanAndStatus` and `quotesByStatus` from the wire
// response for a role without VIEW_BILLING_RECORDS -- PLATFORM_ADMIN and
// SUPPORT_ADMIN (backend/src/http/routes/platformadmin/dashboardRoutes.ts;
// billing/rbac.ts marks both DENY). They are aggregates over
// billing_subscriptions / billing_plans / billing_quotes, i.e. billing
// records, and the key is ABSENT rather than null because null already
// carries its own meaning ("no subscription"/"no quote").
//
// Dashboard.tsx rendered `snapshot.subscriptionsByStatus.byKey` and
// `snapshot.quotesByStatus.byKey` UNGUARDED, so those two roles would have
// hit `TypeError: Cannot read properties of undefined (reading 'byKey')`
// during render -- a hard crash of the whole page, not a missing section.
// The two tests below are the regression pair: the absence case must
// render the page without throwing and without the billing sections, and
// the positive control proves the sections are still there for a role that
// may see them (i.e. the fix hides data, it does not delete the feature).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import Dashboard from '../../src/pages/Dashboard';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

/** The operational/support subset every role receives. */
const OPERATIONAL_SUBSET = {
  generatedAt: '2026-08-01T00:00:00.000Z',
  accountsTotal: { capability: 'AVAILABLE', value: 0 },
  accountsActiveSuspended: { capability: 'UNAVAILABLE', reason: 'test-unavailable' },
  parentMemberEntitlementUtilization: { capability: 'AVAILABLE', used: 0, limit: 0 },
  managedDeviceEntitlementUtilization: { capability: 'AVAILABLE', used: 0, limit: 0 },
  managedDeviceActive: { capability: 'AVAILABLE', value: 0 },
  managedDeviceReserved: { capability: 'AVAILABLE', value: 0 },
  pendingEntitlementRequests: { capability: 'AVAILABLE', value: 0 },
  entitlementRequestsByState: { capability: 'AVAILABLE', byKey: {} },
};

/**
 * The billing-only fields, exactly as dashboardRoutes.ts re-adds them on
 * its `canViewBilling` branch. Deliberately NOT spread into
 * OPERATIONAL_SUBSET by default: the whole point of this file is that for a
 * denied role these keys do not exist on the parsed response object.
 */
const BILLING_ONLY_FIELDS = {
  subscriptionsByStatus: { capability: 'AVAILABLE', byKey: { ACTIVE: 4, CANCELED: 1 } },
  subscriptionsByPlanAndStatus: { capability: 'AVAILABLE', rows: [{ planCode: 'PLAN_A', status: 'ACTIVE', count: 4 }] },
  quotesByStatus: { capability: 'AVAILABLE', byKey: { ISSUED: 2 } },
  invoicesByStatusAndCurrency: { capability: 'AVAILABLE', rows: [] },
  paymentAttemptsByStatusAndCurrency: { capability: 'AVAILABLE', rows: [] },
  refundsByCurrency: { capability: 'AVAILABLE', rows: [] },
  openDisputes: { capability: 'AVAILABLE', value: 0 },
  // Dashboard.tsx:218 and :294 read these with a non-null assertion, and both
  // sit behind the billing gate -- so only the VIEW_BILLING_RECORDS: ALLOW roles
  // reach them. UNAVAILABLE is the honest shape here: it exercises the same
  // capability read while keeping this fixture about the billing aggregates.
  settlementSummary: { capability: 'UNAVAILABLE', reason: 'test-unavailable' },
  serviceHealth: { capability: 'UNAVAILABLE', reason: 'test-unavailable' },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderDashboardFor(roles: string[], snapshot: unknown) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles }));
      if (url.includes('/platform-admin/dashboard')) return Promise.resolve(jsonResponse(200, snapshot));
      // No settlement rollup here: none of these roles/tests exercise it,
      // and a 404 keeps the best-effort fetch from inventing figures.
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    }),
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Dashboard />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Dashboard subscription/quote aggregates are gated on VIEW_BILLING_RECORDS (PCA-BILLING-READ-SPLIT-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it.each([['SUPPORT_ADMIN'], ['PLATFORM_ADMIN']])(
    'renders without throwing for %s, whose wire response has no subscriptionsByStatus/quotesByStatus keys at all',
    async (role) => {
      // Assert the fixture really is the denied-role wire shape -- if a
      // future edit accidentally re-adds these keys the test would keep
      // passing against the very bug it guards.
      expect('subscriptionsByStatus' in OPERATIONAL_SUBSET).toBe(false);
      expect('quotesByStatus' in OPERATIONAL_SUBSET).toBe(false);

      renderDashboardFor([role], OPERATIONAL_SUBSET);

      // "Platform metrics" is the one KPI section every role sees, so it is
      // a safe synchronization anchor: reaching it proves the snapshot was
      // fetched and rendered rather than blowing up mid-render.
      expect(await screen.findByText('Platform metrics')).toBeInTheDocument();
      expect(screen.queryByText('Subscriptions by status')).not.toBeInTheDocument();
      expect(screen.queryByText('Quotes by status')).not.toBeInTheDocument();
      // The operational sections this role IS entitled to must survive the gate.
      expect(screen.getByText('Entitlement requests by state')).toBeInTheDocument();
    },
  );

  it.each([['APP_OWNER'], ['FINANCE_ADMIN'], ['AUDITOR_READ_ONLY']])(
    'still renders both sections, with their real counts, for %s (VIEW_BILLING_RECORDS: ALLOW)',
    async (role) => {
      renderDashboardFor([role], { ...OPERATIONAL_SUBSET, ...BILLING_ONLY_FIELDS });

      expect(await screen.findByText('Subscriptions by status')).toBeInTheDocument();
      expect(screen.getByText('Quotes by status')).toBeInTheDocument();
      // Real values, not just the headings -- a section rendered as the
      // "empty" placeholder would be an equally broken outcome.
      expect(screen.getByText('ACTIVE: 4')).toBeInTheDocument();
      expect(screen.getByText('CANCELED: 1')).toBeInTheDocument();
      expect(screen.getByText('ISSUED: 2')).toBeInTheDocument();
    },
  );
});
