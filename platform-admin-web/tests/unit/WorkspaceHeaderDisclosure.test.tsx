import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { Header } from '../../src/components/shell/Header';
import { AppearanceProvider } from '../../src/state/AppearanceContext';
import { ToastProvider } from '../../src/state/ToastContext';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    value: {
      status: 'SIGNED_IN',
      adminId: 'admin-uuid-should-stay-hidden',
      displayName: 'Platform Owner',
      roles: ['APP_OWNER'],
      sessionExpiresAt: '2026-09-26T12:00:00.000Z',
      signOutReason: null,
      logout: vi.fn(),
      login: vi.fn(),
      revokeAllSessions: vi.fn(),
      refreshIdentity: vi.fn(),
    },
  },
}));

vi.mock('../../src/state/AuthContext', () => ({ useAuth: () => mockAuth.value }));

describe('authenticated header account disclosure', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
    localStorage.clear();
    mockAuth.value.logout.mockClear();
  });

  it('keeps identity concise in the header and discloses session, role, appearance, and logout on activation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ToastProvider>
            <AppearanceProvider><Header onToggleDrawer={() => undefined} /></AppearanceProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(container.querySelector('.account-menu-trigger')).toHaveTextContent('Platform Owner');
    expect(screen.queryByText('admin-uuid-should-stay-hidden')).not.toBeInTheDocument();
    const disclosure = container.querySelector('summary.account-menu-trigger');
    expect(disclosure).toHaveAttribute('aria-label', 'Administrator account menu');
    await user.click(disclosure!);

    expect(screen.getByText('Roles')).toBeInTheDocument();
    expect(screen.getByText('App Owner')).toBeInTheDocument();
    expect(screen.getByText('Session expires')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});
