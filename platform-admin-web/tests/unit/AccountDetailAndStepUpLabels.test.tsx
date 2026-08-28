// Two raw-value leaks into the operator UI:
//
// 1. AccountDetail.tsx printed `latestSubscription.status` as the bare wire
//    enum ("PAST_DUE"), even though this app already carries translated
//    labels for that exact union in both locales.
// 2. The step-up dialog renders t(`stepUp.scopes.${scope}`). The
//    COMPLIMENTARY_GRANT_MUTATION scope -- the one ComplimentaryCapacity.tsx
//    requests for create/revoke/renew -- had no entry in either locale, so
//    i18next fell back to echoing the key path and the dialog asked the
//    operator to confirm "stepUp.scopes.COMPLIMENTARY_GRANT_MUTATION".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import AccountDetail from '../../src/pages/accounts/AccountDetail';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';
import { PLATFORM_ADMIN_STEP_UP_SCOPES } from '../../src/domain/stepUpScopes';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

const ACCOUNT = {
  familyId: 'fam-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  statusCapability: 'AVAILABLE',
  status: 'ACTIVE',
  suspendedAt: null,
  suspensionReason: null,
  entitlement: null,
  latestSubscription: {
    subscriptionId: 'sub-1',
    planId: 'plan-1',
    status: 'PAST_DUE',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('operator-facing labels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('renders the subscription status as a translated label, not the raw wire enum', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
        if (url.includes('/platform-admin/accounts/fam-1')) return Promise.resolve(jsonResponse(200, ACCOUNT));
        return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
      }),
    );

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/accounts/fam-1']}>
          <ToastProvider>
            <AuthProvider>
              <StepUpProvider>
                <Routes>
                  <Route path="/accounts/:id" element={<AccountDetail />} />
                </Routes>
              </StepUpProvider>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(await screen.findByText('Past due')).toBeInTheDocument();
    expect(screen.queryByText('PAST_DUE')).not.toBeInTheDocument();
  });

  it('has a real label in BOTH locales for every step-up scope the app can request', () => {
    for (const scope of PLATFORM_ADMIN_STEP_UP_SCOPES) {
      const enLabel = (en.stepUp.scopes as Record<string, string | undefined>)[scope];
      const arLabel = (ar.stepUp.scopes as Record<string, string | undefined>)[scope];
      expect(enLabel, `missing EN label for step-up scope ${scope}`).toBeTruthy();
      expect(arLabel, `missing AR label for step-up scope ${scope}`).toBeTruthy();
      // A label that merely echoes the scope constant is exactly the defect.
      expect(enLabel).not.toBe(scope);
      expect(arLabel).not.toBe(scope);
    }
  });
});
