import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import Dashboard from '../../src/pages/Dashboard';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

describe('platform-admin-web Arabic RTL', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    secureSession.clear();
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the real Dashboard with Arabic direction and labels', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
    );

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
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

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(await screen.findByText('لوحة التحكم')).toBeInTheDocument();
  });
});
