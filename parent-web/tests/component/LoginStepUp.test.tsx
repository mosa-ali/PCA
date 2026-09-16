import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PcaApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';
import Login from '../../src/pages/auth/Login';
import { ServiceAuthError } from '../../src/api/real/realServiceAuthClient';

// PCA-DW-W3-J: the backend's risk-based first-login email step-up
// (ParentAccountService.login() returning STEP_UP_REQUIRED) shipped with no
// corresponding UI at all -- a real user hitting it would submit their
// password and see nothing happen (the client used to silently
// mis-parse the STEP_UP_REQUIRED response body as a successful session).
// This file exercises the fix end to end at the component level. The dev
// ServiceAuth fixture used by every other Login test never returns
// STEP_UP_REQUIRED (see devServiceAuthClient.ts), so getApiClients() is
// mocked wholesale here, the same technique AuthContext.test.tsx uses for
// its own otherwise-unreachable failure mode.
const signInMock = vi.fn();
const completeLoginStepUpMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  getApiClients: () =>
    ({
      serviceAuth: {
        getSession: vi.fn().mockResolvedValue(null),
        signIn: signInMock,
        completeLoginStepUp: completeLoginStepUpMock,
      },
      isFixtureBacked: false,
    }) as unknown as PcaApiClients,
}));

describe('Login step-up flow', () => {
  const assignMock = vi.fn();

  beforeEach(() => {
    signInMock.mockReset();
    completeLoginStepUpMock.mockReset();
    assignMock.mockReset();
    // jsdom's `window.location.assign` cannot be spied on directly
    // (non-configurable) -- replace the whole `location` object instead,
    // the standard jsdom workaround for asserting on navigation calls.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  it('switches to the step-up code form when signIn reports STEP_UP_REQUIRED, without navigating away or fabricating a session', async () => {
    signInMock.mockResolvedValueOnce({ status: 'STEP_UP_REQUIRED' });
    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: "Confirm it's you" })).toBeInTheDocument();
    expect(screen.getByText(/parent@example\.test/)).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
    // The old password form is gone, not just hidden alongside the new one.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('completing the step-up code calls completeLoginStepUp with the same email and navigates on success', async () => {
    signInMock.mockResolvedValueOnce({ status: 'STEP_UP_REQUIRED' });
    completeLoginStepUpMock.mockResolvedValueOnce({
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: 'fam-1',
      memberId: 'acc-1',
      role: 'VIEWER',
      serviceAuthenticated: true,
    });
    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: "Confirm it's you" });

    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    expect(completeLoginStepUpMock).toHaveBeenCalledWith('parent@example.test', '123456');
    expect(assignMock).toHaveBeenCalledWith('/dashboard');
  });

  it('an incorrect step-up code shows the same invalid-code message as email verification, and marks only the code field invalid', async () => {
    signInMock.mockResolvedValueOnce({ status: 'STEP_UP_REQUIRED' });
    completeLoginStepUpMock.mockRejectedValueOnce(new ServiceAuthError('INVALID_CREDENTIALS', 'bad code'));
    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: "Confirm it's you" });

    await userEvent.type(screen.getByLabelText('Verification code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('That verification code is incorrect or has expired.');
    expect(screen.getByLabelText('Verification code')).toHaveAttribute('aria-invalid', 'true');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('an ordinary AUTHENTICATED sign-in never shows the step-up form', async () => {
    signInMock.mockResolvedValueOnce({
      status: 'AUTHENTICATED',
      session: { accountId: 'acc-1', displayName: 'acc-1', familyId: 'fam-1', memberId: 'acc-1', role: 'VIEWER', serviceAuthenticated: true },
    });
    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(assignMock).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByRole('heading', { name: "Confirm it's you" })).not.toBeInTheDocument();
  });
});
