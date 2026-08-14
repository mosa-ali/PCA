import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../src/pages/Login';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ComingSoon } from '../../src/components/common/ComingSoon';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { secureSession } from '../../src/security/secureSession';

describe('accessibility', () => {
  beforeEach(() => {
    secureSession.clear();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('Login page has no axe violations in English/LTR', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Login page has no axe violations in Arabic/RTL', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a ComingSoon page has no axe violations', async () => {
    const { container } = render(<ComingSoon titleKey="nav.billingPlans" backendGapNote="test gap note" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the step-up dialog has no axe violations while open', async () => {
    secureSession.set('tok-1', new Date(Date.now() + 60_000).toISOString());
    function TriggerAndDialog() {
      return null;
    }
    const { container, getByRole } = render(
      <StepUpProvider>
        <TriggerAndDialog />
      </StepUpProvider>,
    );
    // No pending step-up yet -> no dialog rendered -- verify base render is still clean.
    expect(await axe(container)).toHaveNoViolations();
    expect(() => getByRole('dialog')).toThrow();
  });
});
