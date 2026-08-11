import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { setDevRole } from '../../src/api/dev/devState';
import type { FamilyRole } from '../../src/domain/roles';

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', role = 'OWNER' }: { route?: string; role?: FamilyRole } = {},
) {
  setDevRole(role);
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <StepUpProvider>{ui}</StepUpProvider>
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}
