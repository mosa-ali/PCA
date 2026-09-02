// B016 (product-completion ledger): /not-permitted told a parent WHY an
// action was denied but never WHAT TO DO about it. This proves the page now
// derives an honest, actionable "next step" line from the same structured
// DenialReasonCode evaluatePermission already returns (domain/roles.ts's
// nextStepKey), never fabricated copy -- and that it is correctly omitted
// when there is no structured denial to derive one from (a raw forwarded
// reason with no action to re-evaluate).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { setDevRole } from '../../src/api/dev/devState';
import NotPermitted from '../../src/pages/NotPermitted';
import en from '../../src/i18n/locales/en.json';
import type { FamilyRole } from '../../src/domain/roles';

function renderNotPermitted(
  state: { from?: string; reason?: string; action?: string } | null,
  role: FamilyRole = 'VIEWER',
) {
  setDevRole(role);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[{ pathname: '/not-permitted', state }]}>
        <AuthProvider>
          <StepUpProvider>
            <Routes>
              <Route path="/not-permitted" element={<NotPermitted />} />
            </Routes>
          </StepUpProvider>
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('/not-permitted shows actionable "what to do next" guidance (B016)', () => {
  it('an Owner-only denial (billing) tells a non-Owner to ask the Owner directly', () => {
    renderNotPermitted({ action: 'MANAGE_PAYMENT_METHOD', from: '/subscription' });
    expect(screen.getByText(en.rbac.nextStep.ownerOnly)).toBeInTheDocument();
  });

  it('a not-delegated denial (an Administrator the Owner has not delegated Viewer management to) explains that specifically', () => {
    renderNotPermitted({ action: 'ADD_VIEWER', from: '/family/members' }, 'ADMINISTRATOR');
    expect(screen.getByText(en.rbac.nextStep.notDelegated)).toBeInTheDocument();
  });

  it('a Viewer denied an edit action is told to ask a parent for help', () => {
    renderNotPermitted({ action: 'EDIT_CHILD_POLICY', from: '/children/child-1' });
    expect(screen.getByText(en.rbac.nextStep.askAParent)).toBeInTheDocument();
  });

  it('shows no next-step line when only a raw forwarded reason exists (no action to re-evaluate) -- never fabricated', () => {
    renderNotPermitted({ from: '/dashboard', reason: 'Some raw diagnostic string.' });
    for (const key of Object.keys(en.rbac.nextStep) as Array<keyof typeof en.rbac.nextStep>) {
      expect(screen.queryByText(en.rbac.nextStep[key])).not.toBeInTheDocument();
    }
  });
});
