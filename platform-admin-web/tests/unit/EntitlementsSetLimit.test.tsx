// Regression coverage for the P0 crash on a SUCCESSFUL "Set limit".
//
// POST /platform-admin/families/:familyId/entitlement/limit answers with a
// FLAT usage record -- parentMemberUsedCount/managedDeviceActiveCount/
// managedDeviceReservedCount/revision/updatedAt, and NO pendingRequestSummary
// at all (backend/src/http/routes/platformadmin/entitlementRoutes.ts, the
// setEntitlementLimit route). Entitlements.tsx used to push that response
// straight into the page's FamilyEntitlement state via an unchecked
// post<FamilyEntitlement>() generic assertion, and the very next render read
// `entitlement.pendingRequestSummary.length` -- a TypeError that took the
// whole admin SPA down on a mutation that had actually SUCCEEDED. tsc cannot
// see it: post<T> is an assertion, not a validation.
//
// The fixture below is the real wire shape of that route, not a convenient
// stand-in, so this test genuinely fails against the old code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import Entitlements from '../../src/pages/entitlements/Entitlements';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

/** GET .../entitlement -- the read model the page actually renders from. */
const ENTITLEMENT_BEFORE = {
  familyId: 'fam-1',
  planRef: 'PLAN_A',
  parentMemberLimit: 2,
  parentMemberUsed: 1,
  managedDeviceLimit: 3,
  managedDeviceActive: 2,
  managedDeviceReserved: 0,
  availableDeviceSlots: 1,
  overLimitParentMember: false,
  overLimitManagedDevice: false,
  pendingRequestSummary: [],
};

const ENTITLEMENT_AFTER = { ...ENTITLEMENT_BEFORE, managedDeviceLimit: 9, availableDeviceSlots: 7 };

/** POST .../entitlement/limit -- the FLAT usage record the backend really sends back. */
const LIMIT_MUTATION_RESPONSE = {
  familyId: 'fam-1',
  planRef: 'PLAN_A',
  parentMemberLimit: 2,
  managedDeviceLimit: 9,
  parentMemberUsedCount: 1,
  managedDeviceActiveCount: 2,
  managedDeviceReservedCount: 0,
  overLimitParentMember: false,
  overLimitManagedDevice: false,
  revision: 4,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderPage(entitlementReads: string[], limitPosts: Array<{ url: string; body: unknown }>) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
      if (url.includes('/entitlement/limit')) {
        limitPosts.push({ url, body: init?.body });
        return Promise.resolve(jsonResponse(200, LIMIT_MUTATION_RESPONSE));
      }
      if (url.includes('/entitlement')) {
        entitlementReads.push(url);
        return Promise.resolve(jsonResponse(200, entitlementReads.length === 1 ? ENTITLEMENT_BEFORE : ENTITLEMENT_AFTER));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    }),
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/entitlements?familyId=fam-1']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Entitlements />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Entitlements "Set limit"', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('survives the real flat-usage mutation response and re-reads the entitlement instead of trusting it', async () => {
    const entitlementReads: string[] = [];
    const limitPosts: Array<{ url: string; body: unknown }> = [];
    renderPage(entitlementReads, limitPosts);

    // Initial read rendered: 2 of 3 devices active, 1 slot available.
    expect(await screen.findByText(/2\/3/)).toBeInTheDocument();

    const targetLimitInputs = await screen.findAllByLabelText('Target limit');
    await userEvent.type(targetLimitInputs[0], '9');
    await userEvent.click(screen.getByRole('button', { name: 'Set limit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(limitPosts.length).toBe(1));

    // The page must have re-read through GET .../entitlement rather than
    // adopting the mutation response's incompatible shape.
    await waitFor(() => expect(entitlementReads.length).toBe(2));

    // Refreshed figures are on screen...
    expect(await screen.findByText(/2\/9/)).toBeInTheDocument();
    // ...and the section that used to crash (pendingRequestSummary.length on
    // an undefined field) is still rendered, i.e. the SPA did not blow up.
    expect(screen.getByRole('heading', { name: 'Pending requests' })).toBeInTheDocument();
    expect(screen.getByText('Entitlement limit updated.')).toBeInTheDocument();
  });
});
