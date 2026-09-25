import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../src/i18n';
import MfaRecover from '../../src/pages/auth/MfaRecover';

const { requestMfaRecovery, completeMfaRecovery } = vi.hoisted(() => ({
  requestMfaRecovery: vi.fn(),
  completeMfaRecovery: vi.fn(),
}));

vi.mock('../../src/api/client', () => ({
  getApiClients: () => ({
    serviceAuth: { requestMfaRecovery, completeMfaRecovery },
    isFixtureBacked: false,
  }),
}));

function renderRecovery() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/mfa/recover']}>
        <Routes>
          <Route path="/mfa/recover" element={<MfaRecover />} />
          <Route path="*" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function Destination() {
  const location = useLocation();
  return <p data-testid="destination">{location.pathname}</p>;
}

describe('Parent MFA recovery hold UI', () => {
  beforeEach(async () => {
    requestMfaRecovery.mockReset();
    completeMfaRecovery.mockReset();
    await i18n.changeLanguage('en');
  });

  it('shows the server hold deadline and does not navigate to setup while recovery is pending', async () => {
    requestMfaRecovery.mockResolvedValue(undefined);
    completeMfaRecovery.mockResolvedValue({
      status: 'MFA_RECOVERY_PENDING',
      recoveryAvailableAt: '2026-09-26T12:00:00.000Z',
    });
    const user = userEvent.setup();
    renderRecovery();

    await user.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Email me a recovery code' }));
    expect(await screen.findByText(/we've emailed a recovery code/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Recovery code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm recovery code' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/security hold until/i);
    expect(screen.getByRole('button', { name: 'Continue to recovery' })).toBeInTheDocument();
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument();
    expect(completeMfaRecovery).toHaveBeenCalledWith('parent@example.test', 'correct horse battery staple', '123456');
  });

  it('navigates to new setup only when the server returns MFA_SETUP_REQUIRED', async () => {
    requestMfaRecovery.mockResolvedValue(undefined);
    completeMfaRecovery.mockResolvedValue({ status: 'MFA_SETUP_REQUIRED' });
    const user = userEvent.setup();
    renderRecovery();

    await user.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Email me a recovery code' }));
    await user.type(await screen.findByLabelText('Recovery code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm recovery code' }));

    expect(await screen.findByTestId('destination')).toHaveTextContent('/mfa/setup');
  });
});
