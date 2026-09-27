import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PcaApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';
import Login from '../../src/pages/auth/Login';

const signInMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  getApiClients: () => ({ serviceAuth: { getSession: vi.fn().mockResolvedValue(null), signIn: signInMock }, isFixtureBacked: false }) as unknown as PcaApiClients,
}));

describe('Parent login factors', () => {
  const assignMock = vi.fn();

  beforeEach(() => {
    signInMock.mockReset();
    assignMock.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: assignMock } });
  });

  it('signs in directly after email and password when the account has no authenticator', async () => {
    signInMock.mockResolvedValueOnce({ status: 'AUTHENTICATED', session: {} });
    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(assignMock).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
  });

  it('requires the authenticator code only when the server reports an active factor', async () => {
    signInMock.mockResolvedValueOnce({ status: 'MFA_REQUIRED' }).mockResolvedValueOnce({ status: 'AUTHENTICATED', session: {} });
    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText('6-digit authenticator code');
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(signInMock).toHaveBeenNthCalledWith(2, 'parent@example.test', 'correct-horse-battery', '123456');
    expect(assignMock).toHaveBeenCalledWith('/dashboard');
  });
});
